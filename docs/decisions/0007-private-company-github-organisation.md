# ADR 0007: Code lives in a private Blind Designs GitHub organisation

- **Status:** Proposed
- **Date:** 29 October 2026

## Context

OrderBot and the other Blind Designs tools live in public repositories on Russel's personal GitHub account (`RussedyBussedy`). That means:

- **Ownership:** the company's code depends on one person's account, and there's nowhere to give a development partner or a second admin proper, revocable access.
- **Visibility:** anyone can read the code, the business rules in `CLAUDE.md`, and the addresses of the services it uses. Because of this, the tests and their data are kept outside the repository ([ADR 0005](0005-regression-tests-outside-repository.md)).
- **GitHub's plans:** on the Free plan, branch protection and GitHub Pages work only for **public** repositories. Private repositories need GitHub Team (or Pro for a personal account).

## Decision (proposed)

- Create a GitHub organisation for Blind Designs with at least two owners, and transfer the company's repositories to it as **private** repositories.
- Use the Team plan if `main` is to be protected by rules (required pull requests and passing checks).
- Give collaborators, such as a development partner, the least access their work needs.
- Move the frontend's hosting off GitHub Pages **before** the transfer, because GitHub doesn't redirect Pages addresses when a repository moves ([ADR 0008](0008-firebase-hosting-with-pr-previews.md)).

## Consequences

- The code, tests and data can live together, and the tests can run on every pull request.
- A small monthly cost for the Team plan, and a one-off migration (addresses, the Claude project sync, local clones).
- The steps, in a safe order: [plans/move-to-company-github.md](../plans/move-to-company-github.md).

## Related pages

- [Decisions](README.md)
- [Moving to a company GitHub organisation](../plans/move-to-company-github.md)
- [Security](../security.md)
