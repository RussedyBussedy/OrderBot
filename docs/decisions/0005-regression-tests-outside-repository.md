# ADR 0005: Regression tests live outside the repository while it's public

- **Status:** Accepted, to be superseded by [0007](0007-private-company-github-organisation.md)
- **Date:** October 2026, recorded 29 October 2026

## Context

The regression tests rely on business data: BlindIQ catalogue extracts, replayed order history, and real customer documents that can name end customers. The OrderBot repository is public.

## Decision

The tests are kept as a package (`orderbot-tests.zip`) in OneDrive, `Document Converter/OrderBot reviews/`. The package links to a clone of the repository (`setup.sh`), and every change review updates it. Its README says to keep it private.

## Consequences

- The data stays private.
- The tests can't run automatically on pull requests, so they only protect changes when someone runs them by hand.
- They can drift from the code, and a new developer won't find them in the repository.
- On Windows, the link step may copy files instead of linking them ([testing.md](../testing.md)).

## Supersession

When the repository is private ([ADR 0007](0007-private-company-github-organisation.md)), the tests move into `tests/` and run in CI on every pull request. Real customer documents stay outside, opt-in through environment variables. This record then becomes "Superseded by 0007".

## Related pages

- [Decisions](README.md)
- [Testing](../testing.md)
