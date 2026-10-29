# Getting started

How to set up a Windows PC to work on OrderBot: where the code goes, which tools you need, how to clone it, how to run the app and the proxy locally, and how to run the regression tests. macOS and Linux work the same way with the usual path differences.

## 1. Where the code lives

Keep every repository in one short, plain folder outside OneDrive:

```text
C:\dev\
  blind-designs\        <- company repositories
    OrderBot\           <- folder name = repository name
    bd-tools\
  personal\             <- anything that isn't the company's
```

**Why not OneDrive, Dropbox or a SharePoint-synced folder?** A Git repository keeps its history in a hidden `.git` folder that Git rewrites constantly: lock files, packed objects, the index. Sync tools copy those files one by one while Git is still writing them. The result can be a corrupted repository, "conflicted copy" files, or files that OneDrive has turned into online-only placeholders. Microsoft's own forum has threads titled "OneDrive is corrupting my git repositories". GitHub is your backup instead. Push your branch whenever you stop for the day, because nothing on your PC is backed up until it's pushed.

The rest of the conventions:

- **No spaces in the path.** Command-line tools, scripts and `npm` handle `C:\dev\blind-designs\OrderBot` without quoting. `C:\Users\Russel\OneDrive - blinddesigns.co.za\Documents\Blind Designs Software\OrderBot` trips them up.
- **The folder name matches the repository name exactly**, one folder per repository, grouped by owner. When code moves to a company GitHub organisation, the owner folder matches the organisation's name.
- **Keep business data out of repository folders.** Review packages, customer samples and exports stay in OneDrive (`Document Converter/` today), where they're backed up and shared. A repository holds code, tests, fixtures and docs.
- **Name new repositories in lower case with hyphens** (`bd-tools`, `delivery-optimiser`). Don't rename `OrderBot` while GitHub Pages serves it at `/OrderBot/`: the live URL and the SharePoint embed depend on that path. The [plan](plans/move-to-company-github.md) allows a rename once hosting has moved.
- Inside the repository, files are lower case with hyphens too (`biq-converter.js`, `getting-started.md`).

A OneDrive folder such as `Documents/Blind Designs Software/OrderBot` is fine for non-code material about the project (meeting notes, specs from suppliers). It isn't the place for the repository.

## 2. Tools

| Tool | Needed for | How to get it |
|---|---|---|
| Git for Windows | Everything. Includes Git Bash and Git GUI. | Already on Russel's PC. Otherwise `winget install --id Git.Git -e` |
| Node.js, current LTS | Running the tests and a local web server | Already on Russel's PC. Check with `node -v`: Node 20 reached end of life in April 2026, so update to the current LTS with `winget install --id OpenJS.NodeJS.LTS -e` |
| A code editor | Reading and editing code | [VS Code](https://code.visualstudio.com/) is a good default: `winget install --id Microsoft.VisualStudioCode -e` |
| GitHub Desktop (optional) | A friendlier way to branch, commit, push and open pull requests than Git GUI | `winget install --id GitHub.GitHubDesktop -e` |
| Google Cloud CLI (`gcloud`) | Only for deploying the proxy | `winget install --id Google.CloudSDK -e` |
| Firebase CLI | Later, for hosting and preview links ([environments.md](environments.md)) | `npm install -g firebase-tools` |

## 3. One-time Git set-up

```bash
git config --global user.name "Your Name"
git config --global user.email "you@blinddesigns.co.za"
git config --global fetch.prune true
git config --global init.defaultBranch main
```

- `user.name` is the name stamped on your commits as the author. It's **not** your GitHub username.
- `user.email` should be an address on your GitHub account, so GitHub links your commits to you.
- `fetch.prune` tidies away branches that were deleted on GitHub.
- Leave line endings as the Git for Windows installer set them (`core.autocrlf=true`): Windows line endings in your working copy, Unix line endings in the repository.

In Git GUI the same settings are under **Edit → Options**, on the **Global** side.

## 4. Clone the repository

Command line (Git Bash or PowerShell):

```bash
mkdir -p /c/dev/blind-designs          # PowerShell: mkdir C:\dev\blind-designs
cd /c/dev/blind-designs
git clone https://github.com/RussedyBussedy/OrderBot.git
```

The first time you push, Git Credential Manager opens a window or your browser to sign in to GitHub. That's where your GitHub login is used.

With a GUI instead:

- **GitHub Desktop:** File → Clone repository → URL → `RussedyBussedy/OrderBot`, local path `C:\dev\blind-designs`.
- **Git GUI:** Clone Existing Repository, source `https://github.com/RussedyBussedy/OrderBot.git`, target `C:/dev/blind-designs/OrderBot`. Git GUI names the local branch `master`. Rename it with **Branch → Rename** to `main`, then run `git branch -u origin/main` once so `git pull` knows where to pull from.

When the repository moves to a company organisation, point your clone at the new address with `git remote set-url origin <new URL>` ([the plan](plans/move-to-company-github.md)).

## 5. Run the app locally

The app is plain files, but it has to be served over HTTP: browsers refuse to load ES modules from a file opened by double-clicking it. From the repository folder:

```bash
npx --yes http-server -p 8000 -c-1      # -c-1 turns caching off
# or
python -m http.server 8000
```

Then open <http://localhost:8000>.

What to expect today, because there's no separate test environment yet ([environments.md](environments.md)):

| Feature | Running locally |
|---|---|
| Layout, views and the converter on a known dealer layout | Works. The converter reads its mappings from the **production** database. |
| Connecting to Firebase | Should work. If the page says "Could not connect to the database", the Firebase web API key may restrict which websites can use it: an admin can add `http://localhost:8000/*` under Google Cloud console → APIs & Services → Credentials. |
| Anything that calls the AI (comparisons, the converter's AI reading) | Fails. The proxy only answers the websites in its CORS list (`allowedOrigins` in `index.js`), and `localhost` isn't on it yet. |
| Saving: corrections, guidelines, fabric, motor and tube tables, mappings | Writes to the **production** database that capturers use. Don't, until the staging database exists. |

## 6. Run the proxy locally (rarely needed)

Only needed when you're changing `index.js`.

```bash
gcloud auth application-default login     # once; your Google account needs access to the secret
npm install
npm start                                  # http://localhost:8080
```

`CLAUDE.md` has a `curl` call that checks it answers. To try the page against your local proxy, change `PROXY_API_URL` in `js/config.js` and add your page's origin to `allowedOrigins` in `index.js`, **on your machine only**. Never commit either change.

## 7. Run the regression tests

The tests live outside the repository for now (see [testing.md](testing.md) for why, and for the plan to bring them in).

1. Copy `orderbot-tests.zip` from OneDrive `Document Converter/OrderBot reviews/` and unzip it **next to** the clone, not inside it: `C:\dev\blind-designs\orderbot-tests`.
2. In **Git Bash**:

   ```bash
   cd /c/dev/blind-designs/orderbot-tests
   REPO=/c/dev/blind-designs/OrderBot ./setup.sh
   bash run-all.sh
   ```

3. The last line reads `TOTAL pass=… fail=…`. On today's `main` expect about 1,250 passes and the 25 known failures.

`setup.sh` links the clone's `js/`, `index.html` and `data/` into the test folder with `ln -s`. In Git Bash that may make **copies** instead of links, unless Windows Developer Mode is on and `MSYS=winsymlinks:nativestrict` is set. If it copies, run `setup.sh` again after every change, or run the tests under WSL.

## 8. Optional: Claude Code in your clone

Claude Code (the CLI, or the Code tab of the Claude desktop app) can work directly in `C:\dev\blind-designs\OrderBot`. It reads `CLAUDE.md` automatically and should follow the same workflow: a branch, a pull request, tests, and docs.

## Next steps

- Read the [overview](overview.md) and the [architecture](architecture.md).
- Make your first change by following the [development workflow](development-workflow.md).

## Related pages

- [Development workflow](development-workflow.md)
- [Environments](environments.md)
- [Testing](testing.md)
- [Deployment](deployment.md)
- [Moving to a company GitHub organisation](plans/move-to-company-github.md)
