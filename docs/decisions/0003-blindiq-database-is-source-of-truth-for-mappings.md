# ADR 0003: BlindIQ's database is the source of truth for the converter's mappings

- **Status:** Accepted
- **Date:** 7 August 2026, extended 9 October 2026; recorded 29 October 2026

## Context

The converter's mappings (`orderbot_biq_mappings`) began as a snapshot taken before BlindIQ's December 2025 to January 2026 catalogue clean-up. In that clean-up, retired types got a "Z " prefix and were hidden, and the "Element" generation took over the classic names. The drift between the snapshot and BlindIQ caused every phantom-option and wrong-ID incident of August 2026. Hand edits made it worse: in October 2026 the live mappings still held placeholder IDs such as 8888, and one of them went out on 61 wood venetian lines.

## Decision

- The mappings are generated from a **read-only SQL extract of BlindIQ** and loaded with the admin **Import mappings file** tool. They're never edited by hand in Firestore.
- The categories that carry BlindIQ's own links and retirements (range colours, range fixes, range to type, hidden flags, inactive sundries, size warnings) are regenerated from SQL only. They're declared empty in `BIQ_SEED_MAPPINGS` and have no tab in the mapping manager.
- An ID that isn't a BlindIQ record is ignored (`biqCatalogueHasId`), and the mapping manager refuses to save one.

## Consequences

- When BlindIQ's catalogue changes, the converter needs a fresh extract and import before it knows the new items ([runbook](../operations/runbooks.md#refresh-the-blindiq-catalogue-mappings)).
- The extract scripts are an essential part of the system, and today they live outside this repository ([architecture.md](../architecture.md#things-that-live-outside-this-repository)).
- Imports merge and never delete, so undoing one means importing the previous export. Snapshots and an undo are on the [roadmap](../known-issues-and-roadmap.md).

## Related pages

- [Decisions](README.md)
- [Mappings and catalogue](../converter/mappings-and-catalogue.md)
