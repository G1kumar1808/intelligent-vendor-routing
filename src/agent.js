const store = require('./vendorStore');

const HEALTH_ERROR_RATE_THRESHOLD = 0.2;
const HEALTH_LATENCY_THRESHOLD_MS = 2000;

function detectUnhealthyVendors() {
  return store.getAllMetrics()
    .filter(m => m.totalRequests > 0)
    .map(m => {
      const errorRate = store.errorRate(m.name);
      const reasons = [];
      if (errorRate > HEALTH_ERROR_RATE_THRESHOLD) reasons.push(`error rate ${(errorRate * 100).toFixed(1)}% exceeds ${HEALTH_ERROR_RATE_THRESHOLD * 100}% threshold`);
      if (m.avgLatencyMs > HEALTH_LATENCY_THRESHOLD_MS) reasons.push(`avg latency ${Math.round(m.avgLatencyMs)}ms exceeds ${HEALTH_LATENCY_THRESHOLD_MS}ms threshold`);
      if (!m.available) reasons.push('marked unavailable by health check');
      return { vendor: m.name, unhealthy: reasons.length > 0, reasons };
    })
    .filter(v => v.unhealthy);
}

function recommendStrategy(capability) {
  const cap = store.getCapability(capability);
  if (!cap) return { error: `Unknown capability: ${capability}` };

  const metrics = cap.vendors.map(v => store.getMetrics(v.name));
  const latencies = metrics.map(m => m.avgLatencyMs);
  const costs = cap.vendors.map(v => v.costPerRequest);
  const errorRates = cap.vendors.map(v => store.errorRate(v.name));

  const latencySpread = Math.max(...latencies) - Math.min(...latencies);
  const costSpread = Math.max(...costs) - Math.min(...costs);
  const anyUnhealthy = errorRates.some(e => e > HEALTH_ERROR_RATE_THRESHOLD);

  let recommendation, reason;
  if (anyUnhealthy) {
    recommendation = 'health-based';
    reason = 'One or more vendors show elevated error rates; route away from unhealthy vendors first.';
  } else if (latencySpread > HEALTH_LATENCY_THRESHOLD_MS / 2) {
    recommendation = 'lowest-latency';
    reason = `Latency varies significantly across vendors (spread ~${Math.round(latencySpread)}ms); optimize for speed.`;
  } else if (costSpread > 0.5) {
    recommendation = 'lowest-cost';
    reason = `Cost varies significantly across vendors (spread $${costSpread.toFixed(2)}); optimize for cost since performance is comparable.`;
  } else {
    recommendation = 'weighted';
    reason = 'Vendors are comparable on cost/latency/health; distribute load proportionally to avoid over-relying on a single vendor.';
  }

  return { capability, recommendedStrategy: recommendation, reason };
}

function suggestFallbackRules(capability) {
  const cap = store.getCapability(capability);
  if (!cap) return { error: `Unknown capability: ${capability}` };

  const ranked = [...cap.vendors].sort((a, b) => {
    const scoreA = store.successRate(a.name) - a.costPerRequest * 0.01 - store.getMetrics(a.name).avgLatencyMs * 0.0001;
    const scoreB = store.successRate(b.name) - b.costPerRequest * 0.01 - store.getMetrics(b.name).avgLatencyMs * 0.0001;
    return scoreB - scoreA;
  });

  return {
    capability,
    suggestedFallbackOrder: ranked.map((v, i) => ({
      order: i + 1,
      vendor: v.name,
      successRate: store.successRate(v.name),
      avgLatencyMs: Math.round(store.getMetrics(v.name).avgLatencyMs)
    })),
    rule: 'Try vendors in this order; move to the next on failure, timeout, or if success rate drops below 80%.'
  };
}

function generateConfigFromText(text) {
  const config = { strategy: 'weighted', vendors: [], failoverRules: [] };

  const weightRegex = /([A-Za-z][A-Za-z0-9_]*(?:\s+[A-Za-z0-9_]+)?)\s+for\s+(\d+)%/gi;
  let match;
  while ((match = weightRegex.exec(text)) !== null) {
    config.vendors.push({ name: match[1].trim(), weight: parseInt(match[2], 10) });
  }

  const switchRegex = /switch to ([A-Za-z][A-Za-z0-9_]*(?:\s+[A-Za-z0-9_]+)?)\s+if\s+(.+?)(?:\.|$)/i;
  const switchMatch = switchRegex.exec(text);
  if (switchMatch) {
    const fallbackVendor = switchMatch[1];
    const condition = switchMatch[2];
    config.vendors.push({ name: fallbackVendor, weight: 0, role: 'fallback' });

    const latencyMatch = /latency\s+cross(?:es)?\s+(\d+)\s*(second|sec|s|ms|millisecond)/i.exec(condition);
    if (latencyMatch) {
      const value = parseInt(latencyMatch[1], 10);
      const unit = latencyMatch[2].toLowerCase();
      const ms = unit.startsWith('s') ? value * 1000 : value;
      config.failoverRules.push({ trigger: 'latency', operator: '>', valueMs: ms, action: `switch to ${fallbackVendor}` });
    }
    const errorMatch = /error rate\s+(?:is\s+)?above\s+(\d+)%/i.exec(condition);
    if (errorMatch) {
      config.failoverRules.push({ trigger: 'errorRate', operator: '>', valuePercent: parseInt(errorMatch[1], 10), action: `switch to ${fallbackVendor}` });
    }
  }

  return {
    input: text,
    generatedConfig: config,
    note: 'Rule-based parse. For free-form / ambiguous instructions, swap this for a real LLM call (see README).'
  };
}

module.exports = { detectUnhealthyVendors, recommendStrategy, suggestFallbackRules, generateConfigFromText };
