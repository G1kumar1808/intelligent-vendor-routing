# Intelligent Vendor Routing Platform

A single unified API that routes each incoming request to the best available
third-party vendor (e.g. PAN verification, OCR, SMS) based on configurable
rules and live performance signals — the client never knows which vendor
actually handled its request.

```
Client → /route (or /verify-pan) → Vendor Router → VendorA / VendorB / VendorC → Standardized Response
```

See `architecture.svg` for the full diagram.

## Quick start

```bash
npm install
npm start
# server starts on http://localhost:3000
```

Vendors are loaded on boot from `config/vendors.sample.json`. Edit that file
(or use `POST /vendors`) to add/change vendors — no code changes required.

## Running in Antigravity (or any AI-agent IDE)

This is a plain Node.js/Express project — no special setup needed:
1. Open this folder in Antigravity.
2. Let the agent run `npm install && npm start` (or do it yourself in the terminal).
3. Hit the endpoints below with curl/Postman, or ask the agent to write more tests.

There's nothing Antigravity-specific to configure; it's a normal repo.

## Mandatory APIs

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/vendors` | Register a vendor under a capability |
| GET | `/vendors` | List all capabilities and their vendors |
| POST | `/route` | Route a request for a capability (main entry point) |
| GET | `/route` | Inspect current routing config/strategy |
| GET | `/vendor-metrics` | Live per-vendor metrics (latency, success/error rate, availability) |
| GET | `/routing-logs` | Request logs + routing-decision logs |
| GET | `/health` | Service + vendor health |

Convenience alias: `POST /verify-pan` maps directly to `/route` with
`capability=PAN_VERIFICATION`, matching the example diagram in the brief.

Full sample requests/responses: see `samples/sample-requests.md`.

## Routing strategies implemented (all 8)

| Strategy | How it picks |
|---|---|
| `priority` | Lowest `priority` number among eligible vendors |
| `weighted` | Weighted random draw using each vendor's `weight` |
| `lowest-latency` | Vendor with the lowest rolling average latency |
| `lowest-cost` | Vendor with the lowest `costPerRequest` |
| `failover` | Ordered by priority; only moves to the next on failure |
| `round-robin` | Cycles through vendors in turn, per capability |
| `feature-based` | Filters to vendors supporting `requirements.requiredFeature`, then by priority |
| `health-based` | Orders by current success rate; unhealthy vendors are excluded entirely |

Pass `"strategy": "<name>"` in the `/route` body to override the capability's
default strategy (set in the config file) for a single request.

## Explanation of routing decisions

For every request, `router.js`:
1. **Filters** vendors to those that are not force-down, not rate-limited,
   currently healthy, and (if required) support the requested feature and
   average-latency ceiling — this is `getEligibleVendors()`.
2. **Orders** the remaining candidates according to the active strategy —
   this is `orderByStrategy()`.
3. **Calls vendors in that order.** If a vendor call fails or times out
   (simulated — see below), the router automatically tries the next
   candidate. This failover behaviour applies underneath *every* strategy,
   not just the one literally named "failover".
4. Every attempt is written to two logs: a request-level log (which vendor,
   latency, cost, success/error) and a routing-decision log (which strategy
   ran, which vendor won, the human-readable reason, and the full failover
   chain that was attempted). `routingReason` in the API response and the
   `/routing-logs` endpoint both surface this.

### Why simulated vendor calls?
There are no real third-party PAN/OCR vendors available for this exercise,
so `simulateVendorCall()` in `router.js` stands in for the network call. It
uses each vendor's configured `simulatedLatencyMs` range, `timeoutMs`, and
`simulatedFailureRate` to produce realistic success/failure/timeout
outcomes — this is what lets you actually exercise and observe failover,
health-based exclusion, and round-robin behaviour. Swapping in real HTTP
calls to real vendor APIs is a one-function change (replace the body of
`simulateVendorCall`).

## Bonus: Agentic AI features (`src/agent.js`)

| Feature | Endpoint |
|---|---|
| Recommend the best routing strategy given current metrics | `GET /agent/recommend-strategy?capability=...` |
| Explain why a vendor was selected | already included as `routingReason` on every `/route` response |
| Detect unhealthy vendors from logs/metrics | `GET /agent/unhealthy-vendors` |
| Suggest fallback/failover rules | `GET /agent/suggest-fallback?capability=...` |
| Generate a routing config from plain English | `POST /agent/generate-config` |

These are implemented as a deterministic rule-based agent so they work
instantly with no API key. The plain-English parser handles exactly the
assignment's example ("Use Vendor A for 70% traffic, Vendor B for 30%, but
switch to Vendor C if latency crosses 2 seconds or error rate is above 5%.")
and produces the matching JSON config — see `samples/sample-requests.md`.

### Extending with a real LLM
`generateConfigFromText` in `src/agent.js` is a clean drop-in point for a
real model call (e.g. the Claude API) for free-form instructions the regex
parser can't handle — just replace its body with a prompted API call that
asks for JSON-only output in the same shape.

## Project structure

```
vendor-router/
├── server.js                 # Express app, all routes
├── src/
│   ├── vendorStore.js         # vendor registry + live metrics (in-memory)
│   ├── router.js              # strategy engine + failover + simulated vendor calls
│   ├── logger.js              # request logs + routing-decision logs
│   └── agent.js                # bonus agentic AI features
├── config/
│   └── vendors.sample.json    # sample vendor config (PAN_VERIFICATION, OCR)
├── samples/
│   └── sample-requests.md     # sample API requests/responses
├── architecture.svg           # architecture diagram
├── AI_USAGE.md                 # AI tool usage disclosure
└── README.md
```

## Notes / assumptions
- In-memory storage only (no DB) — resets on restart. Fine for a 24-hour
  take-home; swapping in Redis/Postgres would only touch `vendorStore.js`.
- Cost/latency/rate-limit thresholds for "unhealthy" are set to reasonable
  defaults (`HEALTH_ERROR_RATE_THRESHOLD = 0.2`, `HEALTH_LATENCY_THRESHOLD_MS = 2000`)
  in `src/agent.js` — tune as needed.
