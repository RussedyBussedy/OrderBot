# ADR 0006: Deterministic rules run after the AI and keep its answer

- **Status:** Accepted
- **Date:** 11 October 2026 (prompt v2.4), recorded 29 October 2026

## Context

Two problems were found by joining fifteen months of first checks with what was changed on the BlindIQ orders afterwards:

- **Noise:** about 1 flag in 90 led to a change. Many flags were formatting: BlindIQ's 5 mm steps and shortened names, colour codes, a quantity left blank, the pin that goes with a chain side.
- **Missed mistakes:** most misses were customer values the AI reported as exactly BlindIQ's value.

Prompt wording alone couldn't fix either reliably.

## Decision

- After the AI passes, pure, tested rules in `js/comparison-checks.js` (`applyDeterministicChecks`, `applyExactReading`, `reconcileSecondReading`) and `js/outdoor-motors.js` adjust the results. They turn known formatting differences into MATCH, add flags the rules know to be wrong (for example a Perfect Fit clip size against the Universal Frame), and use exact readings where the customer's document is machine-readable.
- Every adjustment **keeps the AI's original answer** next to the new one (`aiResult`, `aiCustomerValue`) and records which rule acted (`autoMatched`, `ruleFlag`), so each change can be audited.
- Critical fields can't be cleared just because the AI agrees with BlindIQ on a second pass.

## Consequences

- Flags are fewer and more meaningful. Replayed over the history, about 29,000 of 349,000 flags would have been matched, and only 0.44% of those were followed by a change on the order.
- Rules are code, so they're tested in Node and reviewed in pull requests, unlike prompt text.
- Rules must be kept in step with BlindIQ's catalogue and with `BD_STANDARDS` in the prompt. A stale rule silently hides or invents flags.

## Related pages

- [Decisions](README.md)
- [Comparison rule checks](../comparison/rule-checks.md)
- [Comparison pipeline](../comparison/pipeline.md)
