## What and why

<!-- What does this change, and why? Link the issue, email or ruling it comes from. -->

## Evidence

<!-- For a rule: the orders, counts and replay results that back it. For a bug: how to reproduce it. -->

## Area

- [ ] Frontend (`index.html`, `js/`)
- [ ] Backend proxy (`index.js`, `package.json`, `Dockerfile`): deployed separately with `gcloud`, not by this merge
- [ ] AI prompt or model: `PROMPT_VERSION` bumped in `js/config.js`
- [ ] Converter mappings or catalogue data: regenerated from BlindIQ, not hand-edited
- [ ] Documentation only

## Checks

- [ ] Regression tests run. Result: ___ passed, ___ failed (baseline: the 25 known failures, see `docs/testing.md`)
- [ ] End-to-end on a real order: upload → compare → results → history search
- [ ] Converter (if touched): a sample customer file → no new problems → XML downloads
- [ ] Tried on the preview link (or on screen) by a capturer or Paul, for anything capturers will see
- [ ] `docs/` and `CLAUDE.md` updated to match
- [ ] One concern only: no unrelated changes mixed in
