const fs = require('fs');
const path = require('path');

class VendorStore {
  constructor() {
    this.capabilities = {};
    this.metrics = {};
    this.rrCursor = {};
  }

  loadFromFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    for (const capability of Object.keys(data)) {
      for (const vendor of data[capability].vendors) {
        this.registerVendor(capability, vendor, data[capability].strategy);
      }
    }
  }

  registerVendor(capability, vendor, strategy) {
    if (!this.capabilities[capability]) {
      this.capabilities[capability] = { strategy: strategy || 'priority', vendors: [] };
    }
    if (strategy) this.capabilities[capability].strategy = strategy;

    const existingIdx = this.capabilities[capability].vendors.findIndex(v => v.name === vendor.name);
    const normalized = {
      name: vendor.name,
      weight: vendor.weight ?? 1,
      costPerRequest: vendor.costPerRequest ?? 1,
      timeoutMs: vendor.timeoutMs ?? 3000,
      rateLimitPerMinute: vendor.rateLimitPerMinute ?? 1000,
      priority: vendor.priority ?? 99,
      supportedFeatures: vendor.supportedFeatures ?? [],
      simulatedFailureRate: vendor.simulatedFailureRate ?? 0.05,
      simulatedLatencyMs: vendor.simulatedLatencyMs ?? [100, 400],
      forceDown: vendor.forceDown ?? false
    };

    if (existingIdx >= 0) {
      this.capabilities[capability].vendors[existingIdx] = normalized;
    } else {
      this.capabilities[capability].vendors.push(normalized);
    }

    if (!this.metrics[vendor.name]) {
      this.metrics[vendor.name] = {
        name: vendor.name,
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        lastLatencyMs: null,
        requestsThisMinute: 0,
        minuteWindowStart: Date.now(),
        available: true,
        lastError: null,
        lastUpdated: Date.now()
      };
    }
    return normalized;
  }

  getCapability(capability) {
    return this.capabilities[capability];
  }

  listCapabilities() {
    return Object.keys(this.capabilities).map(cap => ({
      capability: cap,
      strategy: this.capabilities[cap].strategy,
      vendors: this.capabilities[cap].vendors
    }));
  }

  getMetrics(vendorName) {
    return this.metrics[vendorName];
  }

  getAllMetrics() {
    return Object.values(this.metrics);
  }

  _refreshRateWindow(vendorName) {
    const m = this.metrics[vendorName];
    const now = Date.now();
    if (now - m.minuteWindowStart > 60000) {
      m.minuteWindowStart = now;
      m.requestsThisMinute = 0;
    }
  }

  isRateLimited(vendor) {
    this._refreshRateWindow(vendor.name);
    const m = this.metrics[vendor.name];
    return m.requestsThisMinute >= vendor.rateLimitPerMinute;
  }

  recordResult(vendorName, { success, latencyMs, error }) {
    const m = this.metrics[vendorName];
    this._refreshRateWindow(vendorName);

    m.totalRequests += 1;
    m.requestsThisMinute += 1;
    m.lastLatencyMs = latencyMs;
    m.avgLatencyMs = m.avgLatencyMs === 0 ? latencyMs : (0.3 * latencyMs + 0.7 * m.avgLatencyMs);
    m.lastUpdated = Date.now();

    if (success) {
      m.successCount += 1;
    } else {
      m.errorCount += 1;
      m.lastError = error || 'unknown error';
    }

    const errorRate = m.totalRequests > 0 ? m.errorCount / m.totalRequests : 0;
    m.available = errorRate < 0.5;
  }

  errorRate(vendorName) {
    const m = this.metrics[vendorName];
    if (!m || m.totalRequests === 0) return 0;
    return m.errorCount / m.totalRequests;
  }

  successRate(vendorName) {
    const m = this.metrics[vendorName];
    if (!m || m.totalRequests === 0) return 1;
    return m.successCount / m.totalRequests;
  }

  updateVendor(vendorName, updates) {
    for (const cap of Object.values(this.capabilities)) {
      const v = cap.vendors.find(v => v.name === vendorName);
      if (v) {
        const allowed = ['forceDown', 'weight', 'priority', 'costPerRequest', 'timeoutMs', 'rateLimitPerMinute', 'simulatedFailureRate'];
        for (const key of allowed) {
          if (updates[key] !== undefined) v[key] = updates[key];
        }
        if (updates.forceDown === false && this.metrics[vendorName]) {
          this.metrics[vendorName].available = true;
          this.metrics[vendorName].errorCount = 0;
          this.metrics[vendorName].totalRequests = 0;
          this.metrics[vendorName].successCount = 0;
          this.metrics[vendorName].avgLatencyMs = 0;
        }
        return v;
      }
    }
    return null;
  }
}

module.exports = new VendorStore();
