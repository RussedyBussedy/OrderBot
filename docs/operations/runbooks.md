# Runbooks

Step-by-step procedures for the jobs that come up while running OrderBot. Each one says when to use it, the steps, how to check it worked, and how to undo it. Commands assume the Google Cloud CLI is signed in with access to the project `orderbot-2b212`.

## Deploy the proxy

**When:** a merged pull request changed `index.js`, `package.json` or `Dockerfile`.

**Steps**

1. Update your clone: `git switch main && git pull`.
2. Optional but safer: deploy a tagged revision that takes no traffic and test it first ([environments.md](../environments.md#testing-a-proxy-change)).
3. Deploy:

   ```bash
   gcloud run deploy gemini-secure-proxy --source . --region africa-south1 --project orderbot-2b212
   ```

**Check:** `gcloud run services describe gemini-secure-proxy --region africa-south1 --project orderbot-2b212` shows the new revision taking 100% of traffic, a comparison runs in the live app, and the service's logs in the Cloud Run console show no new errors.

**Undo:** send traffic back to the previous revision:

```bash
gcloud run revisions list --service gemini-secure-proxy --region africa-south1 --project orderbot-2b212
gcloud run services update-traffic gemini-secure-proxy --to-revisions=<previous revision>=100 --region africa-south1 --project orderbot-2b212
```

## Rotate the Gemini API key

**When:** the key may have been exposed, someone with access to it leaves, Google flags it, or on a regular schedule.

**Steps**

1. Create a new Gemini API key in Google AI Studio or the Google Cloud console (APIs & Services → Credentials), restricted to the Generative Language API.
2. Add it as a new version of the secret, typing or pasting it at the prompt so it never lands in a file or in your shell history:

   ```bash
   gcloud secrets versions add gemini-api-key --data-file=- --project orderbot-2b212
   ```

3. The proxy reads the key once per instance and keeps it in memory (`getApiKey` in `index.js`), so running instances carry on with the old key. Deploy a new revision (the same command as [Deploy the proxy](#deploy-the-proxy)) so fresh instances read the new one.
4. Once comparisons work, disable the old secret version (`gcloud secrets versions disable <version> --secret gemini-api-key --project orderbot-2b212`) and delete the old API key.

**Check:** a comparison runs, and the Cloud Run logs show no authorisation errors from Gemini.

**Undo:** `gcloud secrets versions enable <old version> …`, then disable the new one and deploy a new revision.

## Change the AI model

**When:** a model is being retired, or a better one is available.

**Steps:** change `COMPARISON_MODEL` and/or `EXTRACTION_MODEL` in `js/config.js` on a branch, run the A/B replay on real documents, bump `PROMPT_VERSION` if the prompt changes too, then open a pull request ([ai-models.md](../ai-models.md#changing-the-model)).

**Check:** watch the first day's comparisons: flags per order, failures, and what capturers say.

**Undo:** revert the pull request. The temperatures follow the model automatically (`isGemini3`).

## Refresh the BlindIQ catalogue mappings

**When:** BlindIQ's catalogue has changed (new ranges, colours or sundries, or retirements), the converter reports an item that isn't in BlindIQ, or a brand-new BlindIQ item has to be mapped by ID. The mapping tools refuse IDs the last catalogue import doesn't know.

**Rules:** the BlindIQ database is the source of truth ([ADR 0003](../decisions/0003-blindiq-database-is-source-of-truth-for-mappings.md)). Never hand-edit the mappings in Firestore, and never re-import an old export: re-importing the June 2026 export would put back retired IDs.

**Steps**

1. Run the catalogue extract queries **read-only** against BlindIQ's database. The queries and the method are kept with the October 2026 refresh in OneDrive (`Document Converter/OrderBot converter accuracy 2026-10-09/` and `BlindIQ_schema_discovery.sql`).
2. Build the import file in the same shape as `biq-catalogue-refresh-2026-10-09.json` ([mappings-and-catalogue.md](../converter/mappings-and-catalogue.md)).
3. Run the regression tests with `BIQ_REFRESH` pointing at the new file ([testing.md](../testing.md)). The failures should still be the 25 known ones.
4. In the live app, switch to admin mode, open **⚙ BlindIQ ID mappings**, and press **⬇ Export mappings file**. Keep that file: it's your undo.
5. Press **⬆ Import mappings file** and choose the new file. The import merges category by category and deletes nothing. Every user gets the change straight away.
6. Convert two or three recent real orders and compare them with what BlindIQ holds.

**Check:** no new red problems on orders that converted cleanly before, and the converter's warnings no longer name the stale items.

**Undo:** import the export from step 4. Because imports never delete, keys added by the bad file stay behind, but values it changed are put back.

## Roll back a bad frontend release

**When:** the live app misbehaves after a merge.

**Steps:** on the merged pull request press **Revert**, then merge the revert pull request ([development-workflow.md](../development-workflow.md#rolling-back)). If several merges are suspect, revert the most recent first.

**Check:** the "pages build and deployment" run is green, then Ctrl+F5 and the same action that failed now works.

**Undo:** revert the revert, once the fix is ready.

## Update the fabric, motor or tube tables

**When:** a fabric's weight, width or turning rule changes, a motor is added or retired, or a blind type's tube changes. The torque and fabric-width validations read these tables.

**Steps**

1. Copy the current table first. The app has no export button, so copy the rows shown under **Reference data & rules** into a spreadsheet, or export the collection from the Firebase console. Keep the copy in OneDrive.
2. Prefer editing single rows in the app. **Upload CSV to replace all** deletes every row first and then writes the new rows in a second step. If that second step fails, the table is left empty.
3. If you do upload a CSV, keep the same columns as the existing table ([history, feedback and reference data](../comparison/history-feedback-and-reference-data.md)).

**Check:** run a comparison on an order with that fabric or motor, and check the validation messages make sense.

**Undo:** upload the copy from step 1.

## Add a dealer layout

**When:** a dealer sends enough orders in a fixed layout that reading it exactly beats the AI reading.

**Steps (outline):** gather several real documents in that layout and keep them in the private test data, not in the repository. Add a parser and normaliser in `js/biq-converter.js` and recognise the layout in `biqDetectPdf` / `biqDetectXlsx` (`js/biq-converter-ui.js`). Add a `new-tests/biq-<dealer>.test.mjs`, replay the documents against what BlindIQ stored, then open a pull request with the counts. Details: [dealer-formats.md](../converter/dealer-formats.md).

**Check:** the dealer's documents convert with no new problems, and every other layout converts exactly as before.

**Undo:** revert the pull request. Documents in that layout go back to the AI reader.

## The quarterly review and the monthly report

Two Claude scheduled tasks on Russel's PC produce the regular reports. Neither changes code or the live app.

| Task | When | Output |
|---|---|---|
| "OrderBot quarterly review" | Tuesdays in January, April, July and October | `Document Converter/OrderBot reviews/<year>-Q<n>.md`, plus proposed changes as patches with tests in `<year>-Q<n>-changes/`. A quarter whose report already exists is skipped. |
| "OrderBot monthly report" | Working days 1 to 7 of each month, in the morning | A draft email in Russel's Outlook for management, with its files in `Document Converter/OrderBot reviews/monthly/<month>/` |

**If one didn't run:** the PC was probably off or asleep. Both tasks retry on the next scheduled day, or can be fired by hand from the scheduled tasks list. A quarter's proposed changes reach `main` only as normal pull requests.

## Clean up branches

**When:** monthly, or whenever the branch list gets long.

**Steps**

1. `git fetch --prune`, then `git branch -r --merged origin/main` lists branches already in `main`. Delete those on GitHub (**Branches** page, bin icon).
2. For each unmerged branch, see what it has that `main` doesn't with `git log --oneline origin/main..origin/<branch>`. Either open a pull request for it, or delete it if the work landed another way.
3. Locally: `git branch -d <branch>` for branches you no longer need.

**Undo:** a merged pull request's page offers **Restore branch**. Any branch can be recreated from its last commit's hash.

## OrderBot is down or slow

1. **Who's affected?** One person or everyone? Get a screenshot of the error and of the browser console (F12 → Console).
2. **The page doesn't load:** check [GitHub's status page](https://www.githubstatus.com/) and the repository's Actions tab for a failed "pages build and deployment". If a merge just went out, [roll it back](#roll-back-a-bad-frontend-release).
3. **"Could not connect to the database":** check the Firebase status page and the Firestore usage and quotas in the Firebase console. Ask whether the security rules or the API key's restrictions were changed recently.
4. **Comparisons fail or hang:** open the Cloud Run logs for `gemini-secure-proxy` and look for errors coming back from Gemini (quota, an invalid or retired model, an authorisation failure after a key change). Check the Gemini API's quota in the Google Cloud console. If the proxy was deployed recently, roll back its revision.
5. **Only the converter is wrong:** was a mappings file imported recently? Compare it with the export taken before the import. Was there a recent converter merge? Revert it.
6. **Afterwards:** write down what happened, why, and what would have caught it sooner, in the pull request or issue that fixes it.

## Related pages

- [Deployment](../deployment.md)
- [Development workflow](../development-workflow.md)
- [Environments](../environments.md)
- [Security](../security.md)
- [Mappings and catalogue](../converter/mappings-and-catalogue.md)
