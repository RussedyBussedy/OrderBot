# OrderBot

OrderBot is Blind Designs' internal web app for checking and capturing customer orders. Order capturers use it to compare a dealer's order document with the order they keyed into BlindIQ, and to turn a dealer's order document into an XML file that BlindIQ can import. Admins also use it to look after the reference data the checks rely on and the Daily Cost Report settings.

| | |
|---|---|
| Live app | https://russedybussedy.github.io/OrderBot/ (also embedded in the staff SharePoint site) |
| Owner and maintainer | Russel Baker, Blind Designs |
| In use since | July 2025, by the order capturers every working day |
| Documentation | [docs/README.md](docs/README.md) |

## Start here

- [What OrderBot does](docs/overview.md), in plain English
- [Getting started on your PC](docs/getting-started.md): folders, clone, run it, run the tests
- [How to make a change](CONTRIBUTING.md): branch, pull request, review, merge
- [Architecture](docs/architecture.md) and the [glossary](docs/glossary.md) of blind and BlindIQ terms

## Three rules

1. **`main` is production.** Every merge to `main` is live on GitHub Pages within minutes. Work on a branch and merge through a pull request.
2. **One concern per pull request.** Don't mix frontend and backend changes, or a restructure with a new dependency. See [CONTRIBUTING.md](CONTRIBUTING.md).
3. **Test before you merge.** Run the regression tests and the end-to-end check in [docs/testing.md](docs/testing.md).

## What's in this repository

| Path | What it is |
|---|---|
| `index.html` | The single-page app: layout, styles, and the code for order comparison, history and reference data |
| `js/` | ES modules the page loads: settings (`config.js`, `constants.js`), comparison context and rule checks, the outdoor motor table, the BlindIQ XML converter (`biq-converter.js`, `biq-converter-ui.js`, `biq-form-specs.js`) and the admin cost report console |
| `index.js`, `package.json`, `Dockerfile`, `.dockerignore` | The Gemini proxy that runs on Google Cloud Run |
| `data/` | Two reference JSON files (sundry names, designer fabric aliases); not loaded by the app today |
| `bd-logo-white.png` | Header logo |
| `CLAUDE.md` | Guidance and rule log for AI coding agents (Claude Code) |
| `docs/` | The wiki: how OrderBot works and how to work on it |
| `CONTRIBUTING.md`, `.github/` | The contribution workflow and the pull request template |

Some things OrderBot depends on are kept outside this repository, including the regression tests, the Daily Cost Report script and the visualiser's source. They're listed in [architecture.md](docs/architecture.md#things-that-live-outside-this-repository).
