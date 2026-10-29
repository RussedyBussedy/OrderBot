# Contributing to OrderBot

This is how every change reaches OrderBot, whoever makes it: Russel, a developer, or an AI agent such as Claude Code. The step-by-step version with commands is in [docs/development-workflow.md](docs/development-workflow.md).

## The rules

1. **`main` is production.** GitHub Pages publishes `main` to the order capturers within minutes of a merge. There's no staging step in between yet (see [docs/environments.md](docs/environments.md)).
2. **Never commit straight to `main`.** Every change goes through a branch and a pull request, even a one-line fix. Since August 2026, 53 commits went straight onto `main` and 10 changes arrived through pull requests. The pull request is the only place a change can be seen, checked and reverted as one unit.
3. **One concern per pull request.** Don't mix frontend and backend, and don't add a dependency while restructuring code. The April 2026 modularisation (`ef4eea8`) did all of that in one go, broke production, and was reverted the next day (`42b7a65`). That's CLAUDE.md rule 1.
4. **Backend changes travel alone.** `index.js`, `package.json` and `Dockerfile` aren't deployed by a merge. Deploy them yourself with `gcloud` (see [docs/deployment.md](docs/deployment.md)), in their own pull request, and check the live app straight afterwards.
5. **A prompt change bumps `PROMPT_VERSION`** in `js/config.js`. Each saved comparison records the version that produced it (`promptVersion`), and the reviews compare results by version.
6. **Never hand-edit the converter mappings** in Firestore. Regenerate them from the BlindIQ database and import them (see [the runbook](docs/operations/runbooks.md#refresh-the-blindiq-catalogue-mappings)).
7. **Docs travel with the code.** When a change alters behaviour, a rule, a data shape or a deployment step, update the matching `docs/` page and `CLAUDE.md` in the same pull request.

## Branch names

| Prefix | Use it for | Example |
|---|---|---|
| `feature/` | New behaviour | `feature/ubl-xml-parser` |
| `fix/` | A bug or a wrong result | `fix/allusion-wand-lh-and-rh` |
| `docs/` | Documentation only | `docs/wiki` |
| `chore/` | Housekeeping: dependencies, config, clean-up | `chore/pin-tailwind` |
| `claude/` | Branches Claude Code creates on its own | `claude/cost-report-layout` |

Lower case, words joined with hyphens, and short enough to read in a list. Delete the branch once it's merged.

## Commit messages

- First line: what the commit does, in the imperative, 72 characters at most. "Perfect Fit: read the clip size as the Gasket fix", not "changes" or "Add files via upload".
- Then a blank line and a body that says **why**. Where a rule is backed by data, give the evidence: the orders, the counts, who made the ruling. Most of the October 2026 commits already do this, and it's what makes the history useful.
- Keep JavaScript and documentation in separate commits when a change is large (for example "(1/2: js)" and "(2/2)"), so either can be reverted alone.

## Pull requests

Open the pull request early. A draft is fine. The [template](.github/pull_request_template.md) asks for:

- what changed and why, with the evidence;
- which area it touches: frontend, backend, prompt, mappings or docs;
- the test result against the baseline (passes go up, failures stay the 25 known ones);
- the manual end-to-end check;
- docs and `CLAUDE.md` updated, `PROMPT_VERSION` bumped if prompts changed, and the backend deployed separately if it was touched.

### Review

Until there's a second developer:

- the author reviews their own diff on GitHub before merging, reading every changed line, not just the summary;
- for anything a capturer will see, a capturer or Paul tries it before it's merged, on the preview link once previews exist ([docs/environments.md](docs/environments.md)) or on the author's screen until then;
- Claude Code's pull requests get the same review as anyone else's. Ask it to explain anything you don't follow, and check that it updated `docs/`.

### Merging

- Prefer **Squash and merge**: one commit on `main` per change, so a revert is one click. Edit the squashed message so it keeps the why.
- After the merge, delete the branch (GitHub offers a button) and check the live app once the Pages deploy has finished (see [docs/deployment.md](docs/deployment.md)).
- If something breaks, revert first and investigate afterwards ([docs/development-workflow.md](docs/development-workflow.md#rolling-back)).

## Working with Claude Code

Claude Code reads `CLAUDE.md` automatically, and the same rules apply to it: a branch, a pull request, one concern, tests, and docs updated in the same pull request. When you ask it for a change, ask for the pull request description to include the test result and the evidence. Review its pull requests the way you would a colleague's.

## Where to ask

Questions about the business rules (what a capturer should see, what counts as a mistake) go to Russel, and to Paul for the critical fields and the Daily Cost Report. Questions about the code go to Russel, and to whoever maintains it with him.
