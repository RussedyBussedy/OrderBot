# History

How OrderBot got to where it is, in a short timeline built from the Git history and `CLAUDE.md`. Each entry links what changed to why, so a newcomer can see which parts are old and settled and which are new.

| When | What happened |
|---|---|
| **19–29 July 2025** | Repository created. The page and the Gemini proxy (`index.js`, `Dockerfile`, `package.json`) are set up on Cloud Run, with the API key in Secret Manager. The comparison history starts on 17 July 2025, and the first corrections are recorded that month. |
| September–November 2025 | Proxy and prompt tweaks. A **comparison history** with search by order number is added (20 November 2025), and the model is switched back and forth between Gemini 2.5 and early Gemini 3 previews. |
| February–March 2026 | Retries on AI calls, a reasoning field in the AI's answer, guideline integration, better parsing instructions. |
| **3–4 April 2026** | An attempt to split the page into ES modules, with backend hardening in the same change (`ef4eea8`), breaks production and is reverted the next day (`42b7a65`). This is where the "one concern per commit" rule comes from ([ADR 0001](decisions/0001-no-build-step.md), [ADR 0002](decisions/0002-minimal-backend-proxy.md)). From 5 April, `js/config.js` and `js/constants.js` are extracted one careful step at a time. `CLAUDE.md` is written. |
| 7–17 April 2026 | The first pull requests from Claude Code: prompt stages v1.8 to v2.1, dealer formats such as Mathéo's taught to the AI, uncertainty flags on handwritten documents collapsed into one notice. A trial of `gemini-3.1-pro-preview` for extraction is reverted. |
| **14 June 2026** | The **BlindIQ XML converter** arrives (`js/biq-converter.js`, `js/biq-converter-ui.js`, `js/biq-form-specs.js`): dealer parsers, a mapping database, AI name matching and Blind Designs' order-form specs. Over the next weeks: Blind Guys sheets, Lifestyle, Curtain & Blind Workshop, Windovert, a per-customer format learner, intermediate and coupled brackets. Models are split: extraction on Gemini 3 Flash, comparison on Gemini 2.5 Pro. |
| July 2026 | Total Blind Designs' purchase orders are read (20 July). The page is restyled in Blind Designs' corporate identity (19 July). Valances become their own BlindIQ lines where BlindIQ needs them. |
| **5–7 August 2026** | Paul sets the **critical fields** and the One Touch Dual rule. On 7 August the converter's mappings are **rebuilt from a read-only SQL extract of BlindIQ** after a stale snapshot caused wrong IDs ([ADR 0003](decisions/0003-blindiq-database-is-source-of-truth-for-mappings.md)). Option sheets per type and range, and valance extrapolation, follow. |
| 21 August 2026 | **Capture lock:** capturers convert, only admins map. Every wrong-product incident on record had come through the mapping tools. |
| **7 October 2026** | Every AI call moves to **Gemini 3.8 Flash** at its default temperature ([ADR 0004](decisions/0004-gemini-3-8-flash-default-temperature.md)). |
| 9–11 October 2026 | **Converter accuracy work:** every converted order since June is replayed against what BlindIQ finally stored, and rules go in only where the stored orders back them. Items fully right rise from 30% to 73% on 2,380 items. The **BlindIQ catalogue refresh** adds BlindIQ's own links and retirements. **Prompt v2.3** (10 October) and **v2.4** (11 October) add the rule checks (`js/comparison-checks.js`), reading rules and the second reading ([ADR 0006](decisions/0006-deterministic-rules-after-the-ai.md)). Also on 11 October: the Zip X motor table, the BlindIQ Online exact check, and Perfect Fit clip sizes. |
| 10–12 October 2026 | Admin mode loses its PIN in favour of a confirmation (10 October). The impact review of the first fifteen months, a full **code review**, and the monthly management report (11–12 October). |
| 14–16 October 2026 | Wood and retro venetians, Total Blind Designs note filtering, and double rollers. Finish Logic purchase-order support is built and tested but not yet merged. |
| **19–21 October 2026** | The admin **Cost report** view for the Daily Cost Report: settings, then the send time and days, then the report layout and price check (pull requests #22 to #24). |
| 29 October 2026 | Development practices formalised: a local clone outside OneDrive, this wiki, `CONTRIBUTING.md`, and the plan to move to a private company GitHub organisation with tests on every pull request and preview links ([plan](plans/move-to-company-github.md)). |
| January 2027 (scheduled) | The first automatic **quarterly review** of OrderBot and the converter. |

## Related pages

- [Overview](overview.md)
- [Decisions](decisions/README.md)
- [Known issues and roadmap](known-issues-and-roadmap.md)
- [AI models](ai-models.md)
