# Known issues and roadmap

A dated snapshot, as of **29 October 2026**, of the known problems that aren't security issues, followed by the planned work. Most items come from the October 2026 code review and the change reviews since. Security findings are tracked privately ([security.md](security.md)). Once the repository is private, each item here should become a GitHub issue and this page should shrink to a pointer.

Effort: **S** is under half a day, **M** is one to three days, **L** is longer.

## Known issues

### Comparison

| Issue | Effect | Effort |
|---|---|---|
| Stale names in the validation lists in `js/constants.js` (for example "element vison", "element double roller") | Some blind types miss checks or get them wrongly, which raises false CRITICAL alerts | S |
| The control check accepts only chain, motor and dual wording | Crank and spring outdoor lines get control errors | S |
| Colourless products (Double Roller, bamboo, curtain tracks) get colour checks | False colour errors | S |
| Saving a guideline clears part of the guideline cache inconsistently | Comparisons can fail for up to five minutes afterwards (`CACHE_TTL_MS`) | S |
| Corrections are identified by field and item letter only | A capturer's later correction on another order can overwrite an earlier one | S |
| "Upload CSV to replace all" on the fabric, motor and tube tables deletes every row and then writes the new rows in a separate step | An interrupted upload leaves the table empty, and the torque and fabric checks then have nothing to work with | S |
| Spreadsheets are dropped from comparisons without a message | An `.xlsx` customer document isn't compared, although the converter reads it exactly | S |
| A failed save re-runs every AI call; there are no request timeouts; error responses are retried; the model's finish reason isn't checked; token use isn't stored | Slow failures, extra cost, no usage figures | M |
| Handwriting the model reads as BlindIQ's value even on its own (1200 read as 1700) | Some handwritten mistakes are still missed. The capturers made the same misreadings at first. | L |
| `BD_STANDARDS` still describes valances as separate BlindIQ lines, which is true for rollers but not for wood and retro venetians | The AI can flag a venetian's valance options wrongly. Fixing it is a prompt change (`PROMPT_VERSION`). | S |
| The prompt text changed on 11 October 2026 (the BlindIQ Online block in `describeConverterReading`, the Perfect Fit line in `BD_STANDARDS`) without a `PROMPT_VERSION` bump | Comparisons saved as v2.4 ran on two slightly different prompts. Bump the version with the next prompt change. | S |
| History search results aren't sorted newest first (the sort subtracts date strings), and "Load more" never appears (paging was never wired up) | Older checks can show first; long histories are cut short | S |
| A bad CSV on the fabric, motor or tube tables shows no error | The list stays on "Processing CSV…"; the error is only in the browser console | S |
| If the browser blocks local storage, part of the page's start-up doesn't run (`setupCollapsible`) | Reference tables and the converter may not load in locked-down browsers | S |
| "Add / unify guidelines" deletes and rewrites the whole guideline list in two separate batches | An interrupted save can leave no guidelines | S |

### Converter

| Issue | Effect | Effort |
|---|---|---|
| Finish Logic purchase orders: a warning that Finish Logic prints after a line's options can make the converter skip the following blinds, without a flag | Lost lines on those orders. Fixed in the unmerged `finish-logic-2026-10` package, along with reading other dealers' Finish Logic POs. Check such orders by hand until it's merged. | S (merge) |
| Sizes from AI and form paths take the first digits ("1 200" or "1,200" become 1; "2.5m" becomes 2) | Wrong sizes on some AI-read orders | S |
| Six of the 34 live blind types have no blocking minimum width | Impossible sizes can pass | S |
| The XML isn't cleaned of control characters; sundry codes run out after "z" | BlindIQ can reject an import file | S |
| Sundry names match by substring for multi-character tokens ("Sonesse 30 RTS 3Nm/30" can match "Sonesse 40 Rts 3nm/30") | A wrong motor part is possible | M |
| Mappings imports aren't validated, have no history and no undo; re-importing the June 2026 export would put back retired IDs | A bad import affects every conversion at once | M |
| A mapping deleted on one PC can come back: open admin tabs merge live updates without removing keys, and a later save from such a tab writes the whole category | Deleted (bad) mappings reappear | M |
| "Add row" and bulk paste in the mapping manager store plain numbers on tabs whose values are objects (such as Sundries, which need `{sundry, type}`) | Those entries are skipped by the motor sundry lookups | S |
| Some converter indexes are built once per page load | A mapping change can need a page reload before it takes effect everywhere | S |
| The converter's options panel looks up the option sheet without the range (`biqVariantSpec` called with the blind type only) | Suggestions and "required" marks can come from the wrong sheet; the exported options use the right one | S |
| The converter's AI extraction retries every failure three times, including errors that won't succeed on a retry | Slow failures, extra cost | S |
| The format profile runs after the defaults, so one pass doesn't settle; Mathéo drops unknown columns; CNBW valances are parsed but unused; AI results are applied by line position to whatever order is on screen | Occasional wrong or missing values | M |
| Some product data is hard-coded and disagrees with the comparison (roll-width allowance of 35 mm against 0; the 5 mm rule on six types) | The two tools can disagree on the same order | M |
| Not done: the UBL XML parser for Blind Guys double rollers; motor sundry wordings that don't resolve ("Lithium Ion" against "Lithium"); Extras on Blind Guys roller sheets | Manual work for capturers | M |
| Open rulings for Russel: shutter tilt above 1800 mm; Mathéo Smart Rail with Grey hardware; venetians exactly 600 mm wide; one crank handle per order; vertical chain colour on Anodised and Anthracite tracks | Left to the capturer until decided | — |

### Platform and housekeeping

| Issue | Effect | Effort |
|---|---|---|
| The June 2026 server automation (`convert-cli.mjs`) runs 4 of the 14 refresh steps and reads 3 of the 9 layouts, but `CLAUDE.md` says it behaves like the browser | If it's in use, its output differs from the app's. Retire it. | S |
| Node 20 (Docker image `node:20-slim`) reached end of life in April 2026; there's no lockfile | Unsupported runtime; builds aren't reproducible | S |
| Tailwind is loaded from its Play CDN unpinned; SheetJS 0.18.5 and PDF.js 3.11.174 are behind releases that include security fixes; no SRI hashes | Unplanned changes; maintenance debt | M |
| `data/sundry-names.json` and `data/designer-aliases.json` aren't used by the app | Clutter, and business data in a public repository | S |
| `.dockerignore` excludes only top-level `*.md`, so `docs/` and `.github/` are copied into the proxy's container image | Harmless, but add both folders to `.dockerignore` with the next proxy change | S |
| Unused code: `biqImportSafetyScan`, `biqComputeControlDrop`, the history paging imports, `historyDataCache` | Clutter that misleads readers | S |
| The regression tests, analysis tools, the Daily Cost Report script and the visualiser's source live outside any repository | Handover risk ([architecture.md](architecture.md#things-that-live-outside-this-repository)) | M |
| 13 merged branches not deleted, 3 stale April branches, generic commit messages | Hard-to-read history ([development-workflow.md](development-workflow.md#branch-hygiene)) | S |

## Roadmap

### Platform (the order agreed in the plan)

1. Hosting moved to Firebase Hosting, with no visible change for users.
2. The repositories moved to a private Blind Designs GitHub organisation.
3. The tests brought into the repository, run on every pull request, and required on `main`.
4. A preview link and separate test data for every pull request.
5. Hardening: caller verification for the proxy, Microsoft sign-in and roles, Firestore rules in the repository, pinned dependencies, the current Node LTS.

Details: [plans/move-to-company-github.md](plans/move-to-company-github.md).

### Product

From the October 2026 review, roughly in order of payoff:

- **Check every order automatically.** It's the biggest payoff: 42 of the 76 capture mistakes in the review period were on orders that were never checked.
- A **"Fixed" / "Not an issue"** button on each flag, so OrderBot learns which flags matter and the reviews can measure it.
- **Convert → Compare** in one step for converted orders.
- Converter: source badges and an assumptions checklist; whole-task intake (every document in a BlindIQ task folder); a conversion log; a queue for mapping requests from capturers.
- A browsable comparison history with CSV export; a cost and accuracy dashboard.
- Open the visualiser from an order line.

The improvement phases in `CLAUDE.md` (export and reporting, history and search, UI polish, careful modularisation, analytics, security and resilience, advanced features) remain the longer-term outline. Phase 0 (foundation) is done.

## Related pages

- [Security](security.md)
- [Moving to a company GitHub organisation](plans/move-to-company-github.md)
- [Comparison pipeline](comparison/pipeline.md)
- [Converter rules](converter/rules.md)
- [History](history.md)
