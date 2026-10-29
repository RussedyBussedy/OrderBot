# Deployment

How each part of OrderBot reaches production today, how to check a deploy worked, and how to undo one. The frontend deploys itself when `main` changes. The proxy is deployed by hand. Firestore rules and the reference data are changed in consoles and screens, outside Git.

## Frontend (`index.html`, `js/`)

### Today: GitHub Pages

- **Source:** the root of the `main` branch. Every merge to `main` starts a "pages build and deployment" run on the repository's **Actions** tab. When it's green, the new files are live at `https://russedybussedy.github.io/OrderBot/`.
- **Jekyll:** with no `.nojekyll` file in the repository, GitHub Pages runs Jekyll over it. Markdown files, `docs/` included, are published as web pages too. Two opening curly braces in a row, or an opening brace followed by a percent sign, in any Markdown file fail the build. A failed build leaves the previous site live but blocks every later deploy until it's fixed.
- **Caching:** GitHub Pages lets browsers keep files for about 10 minutes, so for a short while a browser can hold a mix of old and new files. `index.html` imports some modules as namespaces so that a missing function switches a feature off instead of stopping the page ([architecture.md](architecture.md#frontend-modules)). When one module starts using a new export from another, expect that window.
- **SharePoint:** the staff SharePoint page shows the live address in an embed. The embed's address also carries the visualiser's key in its fragment (`#dk=…&dv=…`), which the plain script at the end of `index.html` passes to the Drawings view. If the hosting address changes, update the embed and keep that fragment.
- **The visualiser:** the Drawings view loads `https://russedybussedy.github.io/bd-tools/`, hard-coded as `BASE` in the same script. If `bd-tools` moves, change that line.

**Checking a frontend deploy**

1. The Actions run for your merge is green.
2. Open the live app and press Ctrl+F5.
3. Run one real comparison. If the converter changed, convert one real file.

### Next: Firebase Hosting from GitHub Actions

The plan moves the frontend to Firebase Hosting, deployed by a GitHub Actions workflow on merge, with a preview address for every pull request. See [environments.md](environments.md#2-a-preview-link-for-every-pull-request) and [the plan](plans/move-to-company-github.md), phase 1.

## Backend: the Gemini proxy

Merging a change to `index.js`, `package.json` or `Dockerfile` does **not** deploy it. Deploy it yourself, from an up-to-date clone of `main`, straight after the pull request is merged:

```bash
gcloud run deploy gemini-secure-proxy --source . --region africa-south1 --project orderbot-2b212
```

- This builds the container from `Dockerfile` (base image `node:20-slim`), creates a new Cloud Run **revision** and sends all traffic to it.
- You need the Google Cloud CLI, signed in with an account that may deploy to Cloud Run in `orderbot-2b212`.
- The Gemini key isn't part of the deploy. The proxy reads it from Secret Manager (`gemini-api-key`, latest version) on its first request and keeps it in memory ([backend-proxy.md](backend-proxy.md)).
- To test before any traffic moves, deploy a tagged revision with no traffic first ([environments.md](environments.md#testing-a-proxy-change)).
- `CLAUDE.md` also mentions a "Cloud Run build trigger". Whether one is connected to this repository isn't recorded here. Check the Cloud Run service's settings in the console: if a trigger exists, merges to `main` may redeploy the proxy as well.

**Checking a proxy deploy**

1. `gcloud run services describe gemini-secure-proxy --region africa-south1 --project orderbot-2b212` shows the new revision serving 100% of traffic.
2. Run a comparison in the live app.
3. Look at the service's logs in the Cloud Run console for errors.

## Firestore rules and indexes

The security rules and indexes are edited in the Firebase console today, and they aren't versioned anywhere. The recommendation is to export them into `firestore.rules` and `firestore.indexes.json` in this repository, change them only through pull requests, and deploy them with `firebase deploy --only firestore`. The rules decide who may read and write each collection ([security.md](security.md)).

## Data changes that aren't deploys

These take effect for every user the moment they're saved. There's no pull request and no preview, so take a copy first:

| Change | Where | Procedure |
|---|---|---|
| Converter mappings and the BlindIQ catalogue | Converter, admin mode, **Import mappings file** | [Runbook](operations/runbooks.md#refresh-the-blindiq-catalogue-mappings) |
| Fabric, motor and tube tables | Reference data & rules, **Upload CSV to replace all** | [Runbook](operations/runbooks.md#update-the-fabric-motor-or-tube-tables) |
| AI guidelines | Reference data & rules, **AI guidelines** | [History, feedback and reference data](comparison/history-feedback-and-reference-data.md) |
| Daily Cost Report settings | Cost report view (admin) | [Cost report console](cost-report-console.md) |

## Rolling back

| What | How |
|---|---|
| Frontend | Press **Revert** on the merged pull request, then merge the revert. Pages redeploys the previous files ([development-workflow.md](development-workflow.md#rolling-back)). |
| Proxy | List revisions with `gcloud run revisions list --service gemini-secure-proxy --region africa-south1 --project orderbot-2b212`, then `gcloud run services update-traffic gemini-secure-proxy --to-revisions=<previous revision>=100 --region africa-south1 --project orderbot-2b212`. |
| Gemini key | Enable the previous secret version again, then deploy a new revision so new instances read it ([runbook](operations/runbooks.md#rotate-the-gemini-api-key)). |
| Mappings | Importing **merges** category by category and never deletes, so re-importing the previous file puts back changed values but doesn't remove new keys. Keep the export you took before each import. |
| Fabric, motor and tube tables | Upload the CSV you kept before the change. |

## Related pages

- [Development workflow](development-workflow.md)
- [Environments](environments.md)
- [Backend proxy](backend-proxy.md)
- [Runbooks](operations/runbooks.md)
- [Security](security.md)
