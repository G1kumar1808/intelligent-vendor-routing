# AI Tool Usage Disclosure

This project was built with assistance from **Claude (Anthropic)** as an
AI pair-programmer.

## What AI was used for
- Scaffolding the overall architecture (unified API → router engine →
  vendor store → logger → agent) based on the assignment's problem
  statement and example routing config.
- Writing the implementation of all 8 routing strategies, the failover
  loop, the in-memory metrics store, and the mandatory API endpoints.
- Writing the bonus agentic-AI module (`src/agent.js`): strategy
  recommendation, unhealthy-vendor detection, fallback-rule suggestion,
  and the plain-English → JSON config parser.
- Generating the architecture diagram, README, and sample request/response
  documentation.
- Testing every endpoint (via curl) to confirm correct behaviour, including
  fixing a regex bug in the plain-English config parser that was truncating
  multi-word vendor names (e.g. "Vendor A" → "A") before it shipped.

## What was NOT auto-generated / required human (my) judgment
- Choice of tech stack (Node.js/Express) and decision to simulate vendor
  calls rather than integrate real third-party APIs, given the assignment
  has no real vendors to call.
- Reviewing and verifying the routing logic actually satisfies each
  functional requirement in the brief (registration, configurable rules,
  automatic switching, standardized responses, logging).
- Final review of all deliverables before submission.

## Model
Claude (Anthropic), via the Claude chat interface, on 2026-07-04/05.
