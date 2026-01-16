# Simplification Tactics

Objective, cross-domain approaches to reduce moving parts and invariants.

- Consolidate responsibility: merge components that always change together.
- Collapse handshakes: reduce multi-step protocols to single, atomic flows.
- Reduce state surface: prefer derived state to stored state when possible.
- Remove redundant layers: delete pass-throughs that add no isolation or safety.
- Normalize configuration: replace special cases with a single supported path.
- Make optional: isolate rarely used features behind modules or plugins.
- Prefer composition over orchestration: fewer cross-cutting coordinators.
