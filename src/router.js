const store = require('./vendorStore');
const logger = require('./logger');

function simulateVendorCall(vendor) {
  return new Promise((resolve) => {
    const [minLat, maxLat] = vendor.simulatedLatencyMs;
    const latency = vendor.forceDown ? maxLat : Math.round(minLat + Math.random() * (maxLat - minLat));
    const fails = vendor.forceDown || Math.random() < vendor.simulatedFailureRate;
    const timedOut = latency > vendor.timeoutMs;

    setTimeout(() => {
      if (fails || timedOut) {
        resolve({ success: false, latencyMs: latency, error: timedOut ? 'TIMEOUT' : 'VENDOR_ERROR' });
      } else {
        resolve({ success: true, latencyMs: latency, error: null });
      }
    }, Math.min(latency, 50));
  });
}

function getEligibleVendors(vendors, requirements = {}) {
  const excluded = [];
  const eligible = vendors.filter(v => {
    if (v.forceDown) {
      excluded.push({ name: v.name, reason: 'vendor is marked as down' });
      return false;
    }
    if (store.isRateLimited(v)) {
      excluded.push({ name: v.name, reason: 'rate limit reached' });
      return false;
    }
    if (!store.getMetrics(v.name).available) {
      excluded.push({ name: v.name, reason: 'unhealthy — error rate too high' });
      return false;
    }
    if (requirements.requiredFeature && !v.supportedFeatures.includes(requirements.requiredFeature)) {
      excluded.push({ name: v.name, reason: `does not support required feature: ${requirements.requiredFeature}` });
      return false;
    }
    if (requirements.maxLatencyMs) {
      const m = store.getMetrics(v.name);
      if (m.avgLatencyMs > 0 && m.avgLatencyMs > requirements.maxLatencyMs) {
        excluded.push({ name: v.name, reason: `crossed latency threshold (avg ${Math.round(m.avgLatencyMs)}ms > max ${requirements.maxLatencyMs}ms)` });
        return false;
      }
    }
    return true;
  });
  return { eligible, excluded };
}

function orderByStrategy(strategy, vendors, capability, requirements = {}) {
  const withMetrics = vendors.map(v => ({ vendor: v, metrics: store.getMetrics(v.name) }));

  switch (strategy) {
    case 'priority':
      return withMetrics.sort((a, b) => a.vendor.priority - b.vendor.priority).map(x => x.vendor);

    case 'lowest-latency':
      return withMetrics.sort((a, b) => a.metrics.avgLatencyMs - b.metrics.avgLatencyMs).map(x => x.vendor);

    case 'lowest-cost':
      if (requirements.preferLowCost === false) break;
      return withMetrics.sort((a, b) => a.vendor.costPerRequest - b.vendor.costPerRequest).map(x => x.vendor);

    case 'failover':
      return withMetrics.sort((a, b) => a.vendor.priority - b.vendor.priority).map(x => x.vendor);

    case 'round-robin': {
      store.rrCursor[capability] = store.rrCursor[capability] ?? 0;
      const n = vendors.length;
      const start = store.rrCursor[capability] % n;
      const ordered = [...vendors.slice(start), ...vendors.slice(0, start)];
      store.rrCursor[capability] = (store.rrCursor[capability] + 1) % n;
      return ordered;
    }

    case 'feature-based':
      return withMetrics.sort((a, b) => a.vendor.priority - b.vendor.priority).map(x => x.vendor);

    case 'health-based':
      return withMetrics
        .sort((a, b) => store.successRate(b.vendor.name) - store.successRate(a.vendor.name))
        .map(x => x.vendor);

    case 'weighted':
    default: {
      const pool = [...withMetrics];
      const ordered = [];
      let totalWeight = pool.reduce((s, x) => s + x.vendor.weight, 0);
      while (pool.length) {
        let r = Math.random() * totalWeight;
        let idx = 0;
        for (; idx < pool.length; idx++) {
          r -= pool[idx].vendor.weight;
          if (r <= 0) break;
        }
        idx = Math.min(idx, pool.length - 1);
        const picked = pool.splice(idx, 1)[0];
        totalWeight -= picked.vendor.weight;
        ordered.push(picked.vendor);
      }
      return ordered;
    }
  }
  return withMetrics.sort((a, b) => a.vendor.priority - b.vendor.priority).map(x => x.vendor);
}

async function routeRequest({ capability, payload, requirements = {}, strategyOverride }) {
  const cap = store.getCapability(capability);
  if (!cap) {
    return {
      status: 'ERROR',
      error: `Unknown capability: ${capability}`,
      httpStatus: 404
    };
  }

  const strategy = strategyOverride || cap.strategy;
  const { eligible, excluded } = getEligibleVendors(cap.vendors, requirements);

  if (eligible.length === 0) {
    const excMsg = excluded.length > 0 ? ` Excluded: ${excluded.map(e => `${e.name} (${e.reason})`).join('; ')}` : '';
    const reason = `No eligible vendors available.${excMsg}`;
    logger.logRouting({ capability, strategy, chosen: null, candidates: [], reason, excluded });
    return { status: 'ERROR', error: 'No eligible vendors available', excludedVendors: excluded, httpStatus: 503 };
  }

  const ordered = orderByStrategy(strategy, eligible, capability, requirements);
  const attempted = [];

  for (const vendor of ordered) {
    const result = await simulateVendorCall(vendor);
    store.recordResult(vendor.name, result);
    attempted.push({ vendor: vendor.name, success: result.success, latencyMs: result.latencyMs, error: result.error });

    logger.logRequest({ capability, vendor: vendor.name, payload, success: result.success, latencyMs: result.latencyMs, cost: vendor.costPerRequest, error: result.error });

    if (result.success) {
      const reason = buildReason(strategy, vendor, ordered, attempted, excluded);
      logger.logRouting({ capability, strategy, chosen: vendor.name, candidates: ordered.map(v => v.name), reason, attempts: attempted, excluded });

      return {
        status: 'SUCCESS',
        vendorUsed: vendor.name,
        routingReason: reason,
        latencyMs: result.latencyMs,
        cost: vendor.costPerRequest,
        response: buildMockVendorResponse(capability, payload),
        httpStatus: 200
      };
    }
  }

  logger.logRouting({ capability, strategy, chosen: null, candidates: ordered.map(v => v.name), reason: 'All eligible vendors failed or timed out', attempts: attempted, excluded });
  return { status: 'ERROR', error: 'All eligible vendors failed', attempts: attempted, excludedVendors: excluded, httpStatus: 502 };
}

function buildReason(strategy, vendor, ordered, attempted, excluded = []) {
  const priorAttempts = attempted.slice(0, -1);
  let base;
  switch (strategy) {
    case 'priority': base = `${vendor.name} selected because it has the highest priority (priority=${vendor.priority}) among eligible vendors`; break;
    case 'weighted': base = `${vendor.name} selected via weighted random draw (weight=${vendor.weight})`; break;
    case 'lowest-latency': base = `${vendor.name} selected because it has the lowest observed average latency`; break;
    case 'lowest-cost': base = `${vendor.name} selected because it has the lowest cost per request ($${vendor.costPerRequest})`; break;
    case 'failover': base = `${vendor.name} selected as the current primary/fallback in the failover chain`; break;
    case 'round-robin': base = `${vendor.name} selected as the next vendor in round-robin order`; break;
    case 'feature-based': base = `${vendor.name} selected because it supports the required feature`; break;
    case 'health-based': base = `${vendor.name} selected because it currently has the best health/success rate`; break;
    default: base = `${vendor.name} selected by strategy '${strategy}'`;
  }
  if (excluded.length > 0) {
    base += `. Excluded: ${excluded.map(e => `${e.name} (${e.reason})`).join('; ')}`;
  }
  if (priorAttempts.length > 0) {
    const failedNames = priorAttempts.map(a => `${a.vendor} (${a.error})`).join(', ');
    base += `. After failover from: ${failedNames}`;
  }
  return base;
}

function buildMockVendorResponse(capability, payload) {
  if (capability === 'PAN_VERIFICATION') {
    return { panStatus: 'VALID', nameMatch: true };
  }
  return { status: 'PROCESSED', echo: payload };
}

module.exports = { routeRequest, getEligibleVendors, orderByStrategy, simulateVendorCall };
