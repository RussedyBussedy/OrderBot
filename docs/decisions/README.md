# Decisions

Architecture decision records (ADRs): short notes of significant decisions about OrderBot, each with its context, the decision and its consequences. They explain why things are the way they are, so nobody "fixes" a deliberate choice by accident, and so a choice can be revisited knowingly when its context changes.

| No. | Decision | Status |
|---|---|---|
| [0001](0001-no-build-step.md) | No build step: browser-native ES modules | Accepted |
| [0002](0002-minimal-backend-proxy.md) | The backend is a minimal proxy | Accepted |
| [0003](0003-blindiq-database-is-source-of-truth-for-mappings.md) | BlindIQ's database is the source of truth for the converter's mappings | Accepted |
| [0004](0004-gemini-3-8-flash-default-temperature.md) | Gemini 3.8 Flash for every AI call, at its default temperature | Accepted |
| [0005](0005-regression-tests-outside-repository.md) | Regression tests live outside the repository while it's public | Accepted, to be superseded by 0007 |
| [0006](0006-deterministic-rules-after-the-ai.md) | Deterministic rules run after the AI and keep its answer | Accepted |
| [0007](0007-private-company-github-organisation.md) | Code lives in a private Blind Designs GitHub organisation | Proposed |
| [0008](0008-firebase-hosting-with-pr-previews.md) | Firebase Hosting, with a preview for every pull request | Proposed |

## Writing a new record

- Copy the shape of an existing record: **Status**, **Date**, then **Context**, **Decision**, **Consequences**.
- Number it with the next free number, and name the file after the decision, in lower case with hyphens.
- Status is one of: Proposed, Accepted, Superseded by NNNN, or Rejected. Don't rewrite an accepted record when the decision changes. Write a new one and mark the old one as superseded.
- Add it to the table above in the same pull request as the change it explains.

## Related pages

- [Architecture](../architecture.md)
- [History](../history.md)
- [Wiki home](../README.md)
