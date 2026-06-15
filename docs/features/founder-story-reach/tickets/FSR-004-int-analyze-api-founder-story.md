---
status: todo
---

# FSR-004: [INT] Analyze API founder-story wiring

## User Flows to Verify

- Given `POST /posts/analyze` receives a founder-story draft with valid scoring
  context / When the engine analyzes the request / Then the scored item returns
  `detectedFormat: "founder_story"`.
- Given the same request / When the response prediction is parsed / Then it
  matches the existing available prediction schema and contains no amplifier
  keys or amplifier prediction signals.
- Given a pass-2 judge refine path / When the client reissues `/posts/analyze`
  / Then `judgeSignals` remains exactly `{ impressions, replies }` and contains
  no amplifier fields.

## Architectural Invariants

- `founder_story` must be produced by the real classifier, not by an API-route
  special case.
- Reach output for `founder_story` must flow through the same `computeReachModel`
  path as other formats.
- No amplifier-shaped field may cross the API boundary.

## Modules Under Test

Fastify `/posts/analyze` route, deterministic analysis service, classifier,
reach model, shared response schemas, and the client request builder for the
pass-2 judge refine path.

## Pipeline Log
