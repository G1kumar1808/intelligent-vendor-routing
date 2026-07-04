# Sample API Requests & Responses

Base URL (local): `http://localhost:3000`

---

## 1. Register a vendor
**POST** `/vendors`
```json
{
  "capability": "PAN_VERIFICATION",
  "strategy": "weighted",
  "vendor": {
    "name": "VendorA",
    "weight": 70,
    "costPerRequest": 1.5,
    "timeoutMs": 2000,
    "rateLimitPerMinute": 100,
    "priority": 1,
    "supportedFeatures": ["PAN_VERIFICATION", "NAME_MATCH"]
  }
}
```
**Response**
```json
{
  "status": "SUCCESS",
  "capability": "PAN_VERIFICATION",
  "vendor": { "name": "VendorA", "weight": 70, "costPerRequest": 1.5, "...": "..." }
}
```

---

## 2. Route a PAN verification request (matches assignment's sample input/output exactly)
**POST** `/route`
```json
{
  "capability": "PAN_VERIFICATION",
  "payload": { "pan": "ABCDE1234F", "name": "Rahul Sharma" },
  "requirements": { "maxLatencyMs": 2000, "preferLowCost": true }
}
```
**Response**
```json
{
  "status": "SUCCESS",
  "vendorUsed": "VendorB",
  "routingReason": "VendorB selected because VendorA crossed latency threshold",
  "latencyMs": 850,
  "cost": 1.2,
  "response": { "panStatus": "VALID", "nameMatch": true }
}
```

---

## 3. Convenience alias (matches the diagram: Client -> /verify-pan -> Router)
**POST** `/verify-pan`
```json
{ "pan": "ABCDE1234F", "name": "Rahul Sharma" }
```

---

## 4. Inspect routing config for a capability
**GET** `/route?capability=PAN_VERIFICATION`

## 5. Live vendor metrics
**GET** `/vendor-metrics`
```json
{
  "status": "SUCCESS",
  "metrics": [
    { "name": "VendorA", "totalRequests": 12, "successCount": 11, "errorCount": 1,
      "avgLatencyMs": 268.6, "available": true }
  ]
}
```

## 6. Routing + request logs
**GET** `/routing-logs?limit=10`

## 7. Health check
**GET** `/health`

---

## Bonus agentic AI endpoints

### Recommend the best routing strategy
**GET** `/agent/recommend-strategy?capability=PAN_VERIFICATION`
```json
{
  "status": "SUCCESS",
  "capability": "PAN_VERIFICATION",
  "recommendedStrategy": "weighted",
  "reason": "Vendors are comparable on cost/latency/health; distribute load proportionally to avoid over-relying on a single vendor."
}
```

### Detect unhealthy vendors
**GET** `/agent/unhealthy-vendors`

### Suggest a fallback / failover order
**GET** `/agent/suggest-fallback?capability=PAN_VERIFICATION`

### Generate routing config from plain English (exact example from the assignment)
**POST** `/agent/generate-config`
```json
{ "text": "Use Vendor A for 70% traffic, Vendor B for 30%, but switch to Vendor C if latency crosses 2 seconds or error rate is above 5%." }
```
**Response**
```json
{
  "status": "SUCCESS",
  "generatedConfig": {
    "strategy": "weighted",
    "vendors": [
      { "name": "Vendor A", "weight": 70 },
      { "name": "Vendor B", "weight": 30 },
      { "name": "Vendor C", "weight": 0, "role": "fallback" }
    ],
    "failoverRules": [
      { "trigger": "latency", "operator": ">", "valueMs": 2000, "action": "switch to Vendor C" },
      { "trigger": "errorRate", "operator": ">", "valuePercent": 5, "action": "switch to Vendor C" }
    ]
  }
}
```
