# AI models

Which Gemini model each AI call uses, how the settings are chosen, and how to change or test a model safely. Since October 2026 every call uses `gemini-3.8-flash`, set by two constants in `js/config.js`.

## The two constants

| Constant (`js/config.js`) | Value | Used for |
|---|---|---|
| `COMPARISON_MODEL` | `gemini-3.8-flash` | The comparison (Pass 1 in `processSingleComparison`), the second look at low-confidence fields (Pass 2, `reExtractLowConfidence`), the second reading (`secondReadingOf`), and the converter's name matching ("discernment", in `js/biq-converter-ui.js`) |
| `EXTRACTION_MODEL` | `gemini-3.8-flash` | The converter's AI reading of documents in an unknown layout (`js/biq-converter-ui.js`, with `BIQ_EXTRACTION_SCHEMA`), the clean rewrite of a capturer's correction, and merging guidelines ("Add / unify guideline/s") |

Every call goes through the proxy as `{ model, payload }` ([backend-proxy.md](backend-proxy.md)) and asks for JSON that matches a schema (`responseMimeType: "application/json"` with a `responseSchema`), so the answers can be parsed reliably.

## Temperature

`isGemini3(model)` in `js/config.js` returns true for Gemini 3 and later. For those models every call site leaves the temperature at the model's default. Google advises that lowering it on Gemini 3 can cause looping or worse output. For older (2.x) models the call sites pin the low temperatures they always used (0.1, 0.2, or 0 for discernment). Reverting a constant to a 2.x model therefore restores that model's original settings too.

## Prompt version

`PROMPT_VERSION` in `js/config.js` (currently `v2.4`) labels the comparison prompt. `persistComparison` saves it with every comparison as `promptVersion`, which is how reviews compare results before and after a prompt change. Bump it in the same pull request as any change to what the comparison AI is told ([comparison/ai-context.md](comparison/ai-context.md)). The model name itself isn't saved with a comparison.

## Cost

- One comparison is one Pass 1 call. Pass 2 is added only when a line has two or more fields below 0.8 confidence, and it re-reads just those lines.
- The **second reading** adds a customer-only call that costs about a third of a comparison. It runs only when the converter couldn't read the customer's file itself and `needsSecondReading` (`js/comparison-checks.js`) finds it handwritten or unclear: a photo, a scan, pen strokes or ink annotations. Typed PDFs, filled-in forms and spreadsheets are read once. `SECOND_READING` in `js/config.js` switches it off entirely.
- Known layouts are read by the converter's own parsers, with no AI. Only unknown layouts and images go to `EXTRACTION_MODEL`.
- Token usage isn't recorded anywhere yet. Monthly cost is estimated from the Google Cloud bill.

## History

| When | Change |
|---|---|
| 2025 to early 2026 | Gemini 2.5 Pro, with a few experiments with Gemini 3 previews |
| April 2026 | `gemini-3.1-pro-preview` tried for extraction and reverted: comparisons were worse. That run used temperature 0.1, against Google's Gemini 3 guidance. |
| June 2026 | Models split: extraction on Gemini 3 Flash (preview), comparison and discernment on Gemini 2.5 Pro |
| 7 October 2026 | Both moved to `gemini-3.8-flash` (generally available, no shutdown date). Prompt v2.3 followed on 10 October and v2.4 on 11 October. |

## Changing the model

1. Make a branch. Change `COMPARISON_MODEL` or `EXTRACTION_MODEL`, never both in one change unless you've tested both.
2. **Test it on real documents before merging.** The standard is the A/B replay used for prompt v2.4: run the old and new settings over the real customer documents of orders where mistakes were missed or flags ignored, plus earlier test pairs, with the BlindIQ order rebuilt as it stood at the time of the check. Compare missed mistakes and noise, not just totals.
3. If the prompt changes too, bump `PROMPT_VERSION`.
4. Merge and watch the first day's comparisons. Reverting means changing the constant back ([runbook](operations/runbooks.md#change-the-ai-model)).
5. Record the change in the [history](history.md), and in a decision record if it's a lasting choice ([ADR 0004](decisions/0004-gemini-3-8-flash-default-temperature.md)).

## Related pages

- [Comparison AI context](comparison/ai-context.md)
- [Comparison pipeline](comparison/pipeline.md)
- [Converter overview](converter/overview.md)
- [Backend proxy](backend-proxy.md)
- [Runbooks](operations/runbooks.md)
