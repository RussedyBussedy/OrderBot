# ADR 0002: The backend is a minimal proxy

- **Status:** Accepted
- **Date:** July 2025, reaffirmed April 2026, recorded 29 October 2026

## Context

The Gemini API key mustn't reach the browser. OrderBot's logic lives in the frontend, so the server only needs to add the key and pass requests on. In April 2026, middleware added to the proxy (security headers, rate limiting, server-side timeouts) in the same change as the frontend restructure was part of what broke production ([ADR 0001](0001-no-build-step.md)).

## Decision

- `index.js` is a stateless Express proxy on Cloud Run. It reads the key from Secret Manager, forwards `{ model, payload }` to Gemini and returns the answer. It stores nothing except the key, in memory.
- Business logic stays in the frontend modules.
- Anything added to the proxy goes in its own pull request, is tested on its own, and is deployed separately (`CLAUDE.md` rules 1 and 2).

## Consequences

- Very little server code to maintain or break, and a cheap service.
- Every check, rule and data access happens in the browser, so data protection relies on the Firestore rules, not on the server ([security.md](../security.md)).
- Protections the proxy should have, such as verifying the caller and capping spending, still need adding. "Minimal" means adding them carefully and one at a time, not leaving them out.

## Related pages

- [Decisions](README.md)
- [Backend proxy](../backend-proxy.md)
- [Security](../security.md)
