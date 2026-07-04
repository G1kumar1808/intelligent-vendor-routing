const express = require('express');
const path = require('path');
const store = require('./src/vendorStore');
const { routeRequest } = require('./src/router');
const logger = require('./src/logger');
const agent = require('./src/agent');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const CONFIG_PATH = process.env.VENDOR_CONFIG || path.join(__dirname, 'config', 'vendors.sample.json');

store.loadFromFile(CONFIG_PATH);

app.post('/vendors', (req, res) => {
  const { capability, strategy, vendor } = req.body;
  if (!capability || !vendor || !vendor.name) {
    return res.status(400).json({ status: 'ERROR', error: 'capability and vendor.name are required' });
  }
  const registered = store.registerVendor(capability, vendor, strategy);
  res.status(201).json({ status: 'SUCCESS', capability, vendor: registered });
});

app.get('/vendors', (req, res) => {
  res.json({ status: 'SUCCESS', capabilities: store.listCapabilities() });
});

app.patch('/vendors/:name', (req, res) => {
  const { name } = req.params;
  const updates = req.body;
  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ status: 'ERROR', error: 'Request body with at least one field to update is required' });
  }
  const result = store.updateVendor(name, updates);
  if (!result) {
    return res.status(404).json({ status: 'ERROR', error: `Vendor '${name}' not found` });
  }
  res.json({ status: 'SUCCESS', message: `Vendor '${name}' updated`, vendor: result });
});

app.post('/route', async (req, res) => {
  const { capability, payload, requirements, strategy } = req.body;
  if (!capability) {
    return res.status(400).json({ status: 'ERROR', error: 'capability is required' });
  }
  const result = await routeRequest({ capability, payload, requirements, strategyOverride: strategy });
  const httpStatus = result.httpStatus || 200;
  delete result.httpStatus;
  res.status(httpStatus).json(result);
});

app.post('/verify-pan', async (req, res) => {
  const { pan, name, maxLatencyMs, preferLowCost, strategy } = req.body;
  const result = await routeRequest({
    capability: 'PAN_VERIFICATION',
    payload: { pan, name },
    requirements: { maxLatencyMs, preferLowCost },
    strategyOverride: strategy
  });
  const httpStatus = result.httpStatus || 200;
  delete result.httpStatus;
  res.status(httpStatus).json(result);
});

app.get('/route', (req, res) => {
  const { capability } = req.query;
  if (!capability) {
    return res.json({ status: 'SUCCESS', capabilities: store.listCapabilities() });
  }
  const cap = store.getCapability(capability);
  if (!cap) return res.status(404).json({ status: 'ERROR', error: `Unknown capability: ${capability}` });
  res.json({ status: 'SUCCESS', capability, strategy: cap.strategy, vendors: cap.vendors });
});

app.get('/vendor-metrics', (req, res) => {
  const { vendor } = req.query;
  if (vendor) {
    const m = store.getMetrics(vendor);
    if (!m) return res.status(404).json({ status: 'ERROR', error: `Unknown vendor: ${vendor}` });
    return res.json({ status: 'SUCCESS', metrics: m });
  }
  res.json({ status: 'SUCCESS', metrics: store.getAllMetrics() });
});

app.get('/routing-logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({ status: 'SUCCESS', ...logger.getLogs({ limit }) });
});

app.get('/health', (req, res) => {
  const vendorHealth = store.getAllMetrics().map(m => ({
    vendor: m.name,
    available: m.available,
    errorRate: store.errorRate(m.name),
    avgLatencyMs: Math.round(m.avgLatencyMs),
    totalRequests: m.totalRequests
  }));
  res.json({ status: 'SUCCESS', service: 'UP', uptimeSeconds: process.uptime(), vendors: vendorHealth });
});

app.get('/agent/recommend-strategy', (req, res) => {
  const { capability } = req.query;
  if (!capability) return res.status(400).json({ status: 'ERROR', error: 'capability query param required' });
  res.json({ status: 'SUCCESS', ...agent.recommendStrategy(capability) });
});

app.get('/agent/unhealthy-vendors', (req, res) => {
  res.json({ status: 'SUCCESS', unhealthyVendors: agent.detectUnhealthyVendors() });
});

app.get('/agent/suggest-fallback', (req, res) => {
  const { capability } = req.query;
  if (!capability) return res.status(400).json({ status: 'ERROR', error: 'capability query param required' });
  res.json({ status: 'SUCCESS', ...agent.suggestFallbackRules(capability) });
});

app.post('/agent/generate-config', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ status: 'ERROR', error: 'text is required' });
  res.json({ status: 'SUCCESS', ...agent.generateConfigFromText(text) });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Intelligent Vendor Routing Platform listening on port ${PORT}`);
    console.log(`Loaded capabilities: ${Object.keys(store.capabilities).join(', ')}`);
  });
}

module.exports = app;
