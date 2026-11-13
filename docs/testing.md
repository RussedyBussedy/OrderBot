# Testing

How OrderBot is tested today: an automated regression package that sits next to the repository, and a manual end-to-end check. Covers where the tests live and why, how to run them and read the result, how to add one, and the plan to run them on every pull request.

## The regression package

| | |
|---|---|
| Where | `orderbot-tests.zip` in OneDrive, `Document Converter/OrderBot reviews/` |
| What it tests | The comparison rules and AI context (`js/comparison-checks.js`, `js/comparison-context.js`, `js/outdoor-motors.js`) and the converter (`js/biq-converter.js`, the form specs, and the converter UI through jsdom) |
| How | Node scripts (`*.test.mjs`) that load the repository's own modules and print one `✓` or `❌` line per check |
| Dependencies | `jsdom`, `pdfjs-dist` 3.11.174 and `xlsx` 0.18.5 (the same PDF and spreadsheet libraries as the page) |
| Baseline on `main` | **1,831 passed, 25 failed** on Windows (11 November 2026, main e70a599, from a fresh unzip of the OneDrive package). The failures are the 25 known ones below. How it got there: 1,433 passed, 25 failed on 30 October 2026, with the 70 mm cassette change, which added `new-tests/biq-cassette.test.mjs` (123 checks, one more with TBD's BDO671259 PO in `TASKFILES_DIR`). The Mathéo accessory notes change adds `new-tests/biq-part-notes.test.mjs` (25 checks, 2 more with the 14 Mathéo sheets in `TASKFILES_DIR`) and `new-tests/ui-part-notes.test.mjs` (7 checks): 1,465 passed, the same 25 failed. The Roller check change (Nov 2026) adds `new-tests/biq-roller-selector.test.mjs` (29 checks), gives the converter tests the fabric list (`new-tests/_maps.mjs`, `fixtures/fabric_properties_2026-11-02.json`) and passes `js/roller-selector.js` into the two harnesses that lift `runPostAIValidations` from index.html (`tests/biq-converter.test.mjs`, `tests/biq-coupled-control.test.mjs`); see the review package "Roller check 2026-11". On Windows, 9 `biq-comparison-legibility` checks failed too until the test was corrected on 11 November 2026 (1,456 / 34 on main, 1,485 / 34 with the change). The motor check fixes (2 Nov 2026) add 3 checks to that file (32): 1,488 / 34. The red 1.5:1 (#31, 5 Nov) adds `new-tests/biq-chain-15.test.mjs` (28 checks, review package "Chain 1.5 red 2026-11"): 1,516 / 34. The no-remote note (9 Nov) adds 1 check to `biq-roller-selector.test.mjs` (33): 1,517 / 34. Outdoor blinds' own controls (9 Nov) add `new-tests/biq-outdoor-controls.test.mjs` (57 checks, review package "Outdoor controls 2026-11"): 1,574 / 34. Sundry lines without a part (9 Nov) add `new-tests/biq-sundry-no-part.test.mjs` (22 checks, 1 more with BDO675469's PDF in `TASKFILES_DIR`) and update `biq-part-notes` (+1), `ui-part-notes` (+3), `biq-motor-sundries` and `biq-pdf-preview` for the new behaviour: 1,600 / 34 (review package "Roman headrail print error 2026-11"). Mathéo's Roman sheet (9 Nov) adds `new-tests/biq-matheo-roman.test.mjs` (34 checks, 2 more with the 16 sheets in `TASKFILES_DIR`): 1,634 / 34 (same review package). Sundry lines matched to BlindIQ's parts (9 Nov, on top of the sundry change) adds `new-tests/biq-sundry-matching.test.mjs` (60 checks, 1 more with 9 live imports in `TASKFILES_DIR`) and one check each to `biq-part-notes` and `ui-part-notes`: 1,696 / 34. Since 10 November 2026, the orderbot-tests.zip in OneDrive holds all of these test files. Before that it lacked the November ones and gave 1,433 / 48 on main; the old zip is kept beside it as `orderbot-tests-2026-10-30.zip`. The review fixes (#38 to #43, 11 Nov) add six files with 126 checks (`biq-bar-follows-hardware` 34, `biq-no-drive` 27, `biq-colour-alert` 28, `biq-check-panel-motor-table` 10, `ui-history-newest-first` 9, `biq-roller-typed-weight` 18; review package "Review fixes 2026-11") and change one expectation in `biq-cassette`: 1,822 / 34. The nine `biq-comparison-legibility` failures on Windows were never pdf.js: the test built the path of its sample PDFs with `URL.pathname`, which gives "/C:/…" there, and Node can't open that. With `fileURLToPath` all 19 of its checks pass: 1,831 / 25. The zip holds all of this since 11 November 2026; the one before is kept as `orderbot-tests-2026-11-10.zip` and gives 1,695 / 35 on today's main. The task folders are `Z:\BlindIQ_DocumentRepository\TaskFiles` on the office network. |

What's inside:

| Folder or file | Contents |
|---|---|
| `new-tests/` | The current rules, one file per subject, most with real orders as evidence: comparison checks, AI context and the v2.4 prompt, second reading and legibility, BlindIQ Online exact reading, outdoor motors, Perfect Fit, the Roller check, the Colour Alert and the history search, and the converter's catalogue linkage, dealer layouts, options and defaults, control drops, warranty, documented rules, sundry lines and the check panel |
| `new-tests/fixtures/` | History replayed by some rules (`outdoor_motorised.json`, `pf_history.json`), each with a note of where it came from |
| `*.test.mjs` at the top, and `tests/` | The older converter suite |
| `samples/` | Sample customer files: dealer layouts, and synthetic PDFs for the legibility tests |
| `BlindIQ_mappings_base.json`, `biq-catalogue-refresh-2026-10-09.json`, `BlindIQ_mappings_full.json` | The mappings export of June 2026, the October catalogue refresh, and the merged file the older tests read |
| `setup.sh`, `run-all.sh`, `package.json` | Link the package to a clone and run everything (`npm test` runs `run-all.sh`) |
| `analysis-tools/` | Scripts and the method of the October 2026 review |

Two optional environment variables switch on the checks that read real customer documents: `TASKFILES_DIR` (copies of BlindIQ task folders) and `ABTEST_DIR` (the A/B test's customer files). Without them, those checks are skipped.

### The 25 known failures

These failures predate the October 2026 work. They were written against older mappings and converter behaviour and need a review of their own. Until then, a change is good when **passes go up (or stay the same) and the failures are still exactly these 25** (one of them is really a pass: `biq-emit-flag` prints "✓ PDF preview shows withheld options in red with ✗", and `run-all.sh` counts every line with ❌ or ✗ as a failure):

| File | Failures |
|---|---|
| `biq-control-matrix.test.mjs` | 1 |
| `biq-emit-flag.test.mjs` | 4 |
| `biq-import-safety.test.mjs` | 2 |
| `biq-motoronly-default.test.mjs` | 6 |
| `tests/biq-converter.test.mjs` | 3 |
| `tests/biq-customers-db.test.mjs` | 2 |
| `tests/biq-discern.test.mjs` | 2 |
| `tests/biq-shutter.test.mjs` | 4 |
| `tests/biq-canon.mjs` | 1 |

## Why the tests live outside the repository

The repository is public, and the fixtures are business data: the BlindIQ catalogue, replayed order history and real customer documents. The package's own README says to keep it private. That's sensible, but it costs a lot. The tests can't run automatically on a pull request, they drift from the code, and a new developer doesn't find them. The decision is recorded in [ADR 0005](decisions/0005-regression-tests-outside-repository.md).

## Running the tests

On Windows, use **Git Bash**:

```bash
# once: unzip the package next to your clone, not inside it
cd /c/dev/blind-designs/orderbot-tests
REPO=/c/dev/blind-designs/OrderBot ./setup.sh
# every time
bash run-all.sh
```

`run-all.sh` prints one line per file (`OK` or `!!`, then the pass and fail counts and the file name), the first failing lines of any file that failed, and finally `TOTAL pass=… fail=…`.

**Windows caveat:** `setup.sh` links the clone's `js/`, `index.html` and `data/` with `ln -s`. In Git Bash that may create **copies** instead, unless Windows Developer Mode is on and `MSYS=winsymlinks:nativestrict` is set. With copies, the tests keep testing the code as it was when you ran `setup.sh`. Run it again after each change, or use WSL.

To run one file: `cd` into the package and run, for example, `node new-tests/biq-perfect-fit.test.mjs`. Some files read the catalogue files through `BIQ_BASE`, `BIQ_REFRESH` and `BIQ_DRB_XLSX`. `run-all.sh` sets these in its first lines, so export the same values when you run a file on its own.

**The torque and battery tests** (`new-tests/biq-motor-calc.test.mjs`, 130 checks, review package "Motor calc 2026-11", 13 November 2026). Six of its checks need the motor-calc pack, which holds the makers' own motor records and is never part of this package or the repository: set `MOTOR_CALC_PACK` to its folder (on Russel's PC it is found without). They check that `js/motor-calc/` is the pack's code (only comment lines may differ), run the pack's 141 reference cycles through it, and compare what the records give with the autonomies the makers publish. Without the pack they are skipped with a note. The change also updates `tests/biq-converter.test.mjs` (the torque figure, and how its torque alert is forced) and one pattern in `biq-roller-selector.test.mjs`. With it the suite is 1,961 passed and the same 25 failed, on a package that gives 1,831 / 25 on `main`. The tests are folded into `orderbot-tests.zip` once the change is merged.

## Adding a test

- One file per rule or subject in `new-tests/`, named `biq-<subject>.test.mjs`, printing `✓` and `❌` lines like the others.
- Put the real order numbers that justify a rule in the test's description.
- When a rule is replayed over history, keep that history as a fixture in `new-tests/fixtures/` with a note of where it came from.
- Test the pure modules directly. The comparison and converter modules have no DOM code for exactly this reason.
- For a converter change, the October 2026 method is the standard: replay the customer documents of real converted orders and compare them, item by item, with what BlindIQ finally stored. A rule only goes in when the stored orders back it.

## Manual end-to-end check

`CLAUDE.md` rule 5: each change must be deployed and checked before the next one begins. Before merging, and again on the live app after merging:

1. **Comparison:** upload a real customer document and its BlindIQ printout → **Run comparisons** → the report renders, with critical fields highlighted → find the order in **Comparison history**.
2. **Converter** (if touched): open a sample customer file in a known layout → the order appears with no new problems → the XML downloads.
3. **Admin views** (if touched): switch to admin mode → the mapping tools and the Cost report view open.
4. **Drawings** (if the view's script or `visualiser/` was touched): open OrderBot with the SharePoint embed's fragment → **Drawings** → the visualiser opens without asking for the passphrase → **OPEN FULL SCREEN** opens it in its own tab.
5. The browser console (F12) shows no new errors.

## Bringing the tests into the repository

Once the repository is private ([plan](plans/move-to-company-github.md), phase 3):

1. Move the package into a `tests/` folder with its own `package.json` and a committed lockfile. `setup.sh` becomes unnecessary, because the tests can import `../js/` directly.
2. Keep real customer documents **out** of Git. They stay opt-in through `TASKFILES_DIR` and `ABTEST_DIR`, read from a private location. Catalogue extracts and anonymised fixtures can go in.
3. List the 25 known failures by name in an "expected failures" file, so the run is green until they're reviewed and anything new turns it red. Print the number of skipped checks.
4. Add the GitHub Actions workflow ([environments.md](environments.md#1-automatic-checks-on-every-pull-request)) and make the check required on `main`.
5. Review the 25 old failures: fix them, rewrite them for today's behaviour, or delete them with a reason.

## Related pages

- [Getting started](getting-started.md)
- [Development workflow](development-workflow.md)
- [Environments](environments.md)
- [Comparison rule checks](comparison/rule-checks.md)
- [Converter rules](converter/rules.md)
- [Decisions](decisions/README.md)
