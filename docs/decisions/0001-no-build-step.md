# ADR 0001: No build step, browser-native ES modules

- **Status:** Accepted
- **Date:** April 2026, recorded 29 October 2026

## Context

OrderBot began as one HTML file with everything inline. On 3 April 2026 a single change (`ef4eea8`) split the page into ES modules, added backend middleware and restructured code all at once. It broke production and was reverted the next day (`42b7a65`). Modules were then extracted one at a time, starting with pure functions (`js/config.js`, `js/constants.js`, then the comparison and converter modules).

## Decision

- The frontend is served as plain files: `index.html` loads `js/*.js` with `<script type="module">`. There's no bundler, transpiler or `npm` step for the frontend.
- Third-party libraries come from CDNs at fixed versions (except Tailwind's Play CDN).
- Modules use named exports only: no default exports and no CommonJS.
- When code moves out of `index.html`, move working functions as they are ("extract, don't rewrite"), pure functions first.

## Consequences

- Deploying is just publishing files, and anyone can read the code that runs.
- The pure modules run unchanged in Node, which is what makes the regression tests possible.
- There's no minification, tree-shaking or type-checking. `index.html` is still large (about 3,600 lines), and `js/biq-converter.js` is larger (about 6,500).
- Browsers can briefly hold a mix of old and new files after a deploy. The namespace imports guard against that ([architecture.md](../architecture.md#frontend-modules)).

## Revisit when

A tested build pipeline exists (for example with CI and previews in place, [ADR 0008](0008-firebase-hosting-with-pr-previews.md)) and there's a concrete need: type-checking, pinned npm dependencies, or splitting the converter.

## Related pages

- [Decisions](README.md)
- [Architecture](../architecture.md)
