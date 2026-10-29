# ADR 0004: Gemini 3.8 Flash for every AI call, at its default temperature

- **Status:** Accepted
- **Date:** 7 October 2026, recorded 29 October 2026

## Context

Until October 2026 OrderBot used two models: a Gemini 3 Flash preview for extraction, and Gemini 2.5 Pro for comparison and name matching. Preview models can be withdrawn at short notice. An April 2026 trial of `gemini-3.1-pro-preview` was reverted because comparisons got worse, but that trial ran at temperature 0.1, which Google advises against for Gemini 3 models.

## Decision

- Both `COMPARISON_MODEL` and `EXTRACTION_MODEL` in `js/config.js` are `gemini-3.8-flash`, which is generally available with no shutdown date.
- Gemini 3 and later models run at their **default** temperature. Call sites pin the old low temperatures only for 2.x models, through `isGemini3()`, so reverting a constant restores that model's settings too.

## Consequences

- One model to watch, and the calls are faster and cheaper than with 2.5 Pro.
- A model change is a one-line change in each direction ([ai-models.md](../ai-models.md)), but it still needs an A/B replay on real documents before it's merged.
- Prompt work since then (v2.3, v2.4) was tuned on this model. A future model change should re-run the same replays.

## Related pages

- [Decisions](README.md)
- [AI models](../ai-models.md)
