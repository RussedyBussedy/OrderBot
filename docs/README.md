# OrderBot wiki

This wiki explains how OrderBot works and how to work on it safely. It's written for a developer who is new to OrderBot and to the blinds trade, such as a development partner taking over maintenance, and for Russel, who owns the app.

`CLAUDE.md` in the repository root is the companion for AI coding agents: a dense rule log with the evidence behind each rule. This wiki covers the same system for people, organised by topic.

## Start here

| Page | What it covers |
|---|---|
| [Overview](overview.md) | What OrderBot is for, who uses it and what it has achieved, in plain English |
| [Glossary](glossary.md) | Blind, BlindIQ and platform terms used everywhere else |
| [Getting started](getting-started.md) | Folder conventions, cloning, running the app and the tests on your PC |

## How it works

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | The moving parts, how they connect, and what lives outside this repository |
| [User interface](app/user-interface.md) | The page's views and sections, admin mode, and how `index.html` is organised |
| [Comparison pipeline](comparison/pipeline.md) | What happens when a capturer runs a comparison, from upload to saved result |
| [Comparison AI context](comparison/ai-context.md) | How the prompts are put together: corrections, guidelines, standards, reading rules |
| [Comparison rule checks](comparison/rule-checks.md) | The deterministic checks that run after the AI (`js/comparison-checks.js`, `js/outdoor-motors.js`) |
| [Comparison validations](comparison/validations.md) | The post-AI validations: fabric, colour, controls, torque, valances, critical fields |
| [History, feedback and reference data](comparison/history-feedback-and-reference-data.md) | Comparison history, capturer corrections, AI guidelines, fabric/motor/tube tables |
| [Converter overview](converter/overview.md) | The BlindIQ XML converter: from a customer document to import-ready XML |
| [Dealer formats](converter/dealer-formats.md) | Every customer document layout the converter reads |
| [Converter rules](converter/rules.md) | The business rules the converter applies, by subject |
| [Mappings and catalogue](converter/mappings-and-catalogue.md) | How dealer wording resolves to BlindIQ IDs, and where the catalogue comes from |
| [XML export](converter/xml-export.md) | The XML BlindIQ imports, and what's filtered out of it |
| [Converter user interface](converter/user-interface.md) | The converter's screens, admin mapping tools and its use by the comparison |
| [Data model](data-model.md) | Every Firestore collection and browser storage key |
| [Backend proxy](backend-proxy.md) | `index.js` on Cloud Run: the only server-side code |
| [Cost report console](cost-report-console.md) | The admin view for the Daily Cost Report settings |
| [AI models](ai-models.md) | Which Gemini models are used where, and how to change them |

## Working on it

| Page | What it covers |
|---|---|
| [CONTRIBUTING](../CONTRIBUTING.md) | The rules every change follows |
| [Development workflow](development-workflow.md) | Branch → pull request → review → merge → check, with commands; rolling back |
| [Environments](environments.md) | Production, preview and local, and why each pull request should get a test link |
| [Testing](testing.md) | The regression tests, the baseline, adding a test, the manual check |
| [Deployment](deployment.md) | How the frontend and the proxy reach production, and how to undo it |

## Running it

| Page | What it covers |
|---|---|
| [Runbooks](operations/runbooks.md) | Step-by-step procedures: deploys, key rotation, catalogue refresh, triage |
| [Security](security.md) | The security model today and the principles every change follows |
| [Known issues and roadmap](known-issues-and-roadmap.md) | A dated snapshot of known problems and planned work |

## Background

| Page | What it covers |
|---|---|
| [Decisions](decisions/README.md) | Architecture decision records: what was decided, and why |
| [History](history.md) | How OrderBot got here, in a short timeline |
| [Moving to a company GitHub organisation](plans/move-to-company-github.md) | The plan to make the code private and company-owned, with previews and CI |

## Keeping the wiki current

- Change the docs in the **same pull request** as the code they describe. A reviewer should be able to read the change and its docs side by side.
- Describe what the code does now. Put the history of a rule in its commit message and in `CLAUDE.md`, and the reasoning behind a design choice in a [decision record](decisions/README.md).
- Name code by file and function, not by line number. Line numbers go stale with the next commit.
- The repository is published by GitHub Pages, which runs Jekyll over Markdown files. Don't write two opening curly braces in a row, or an opening brace followed by a percent sign, anywhere in these pages: Jekyll treats them as template tags and the publish fails.

## Related pages

- [CONTRIBUTING](../CONTRIBUTING.md)
- [Overview](overview.md)
- [Getting started](getting-started.md)
- [Glossary](glossary.md)
