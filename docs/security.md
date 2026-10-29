# Security

How OrderBot is protected today, what data it handles, and the rules every change follows. This repository is public, so specific weaknesses aren't listed here. The open findings from the October 2026 code review are tracked privately (see [where findings live](#where-findings-live)).

## The model today

| Layer | Today | Direction |
|---|---|---|
| The page | A static site that anyone with the address can load. Staff normally reach it through the SharePoint embed. | Sign-in before the page is usable |
| Identity | Firebase **anonymous** sign-in: each browser gets an ID, not a person | Microsoft (Entra ID) sign-in, with roles for capturers and admins |
| Data access | Firestore security rules decide what a signed-in client may read and write. They're edited in the Firebase console and aren't versioned. | Rules kept in this repository and changed through pull requests |
| Admin mode | A switch stored in the browser (`biq_admin`) that shows the mapping tools and the Cost report view, after a confirmation. It keeps capturers away from tools they shouldn't use by accident, but it isn't access control. | Real roles, checked by the rules |
| The Gemini API key | Server-side only: Secret Manager, read by the proxy. It never reaches the browser. | Keep it that way |
| Firebase web config (`js/config.js`) | Public by design. It identifies the project and isn't a secret (`CLAUDE.md` rule 6). Protection comes from the rules and the key's restrictions. | No change |
| The proxy | Answers the websites on its CORS list. CORS only restricts what browsers do, so it isn't authentication. | Verify the caller (for example Firebase App Check) and cap spending |
| The code | Public on a personal GitHub account | Private, in a company organisation ([plan](plans/move-to-company-github.md)) |

## Data OrderBot handles

- **Customer order documents** (PDFs, photos, spreadsheets) often name the end customer and the installation address. That's personal information under POPIA.
- The browser reads the documents. Their content is sent through the proxy to **Google's Gemini API** to be read. The proxy itself stores nothing.
- **Comparison results** (each line's customer and BlindIQ values, order numbers, reasoning) are saved in `orderbot_comparisons`. **Capturers' corrections**, which can include a pasted screenshot, are saved in `orderbot_feedback` ([data-model.md](data-model.md)).
- Anyone deciding how long to keep this data, or whether sending documents to the Gemini API fits Blind Designs' POPIA obligations, should start from this list.

## Rules for every change

1. **No secrets in code**, ever: not in the repository, not in commit history, not in a pull request description. Server-side keys go in Secret Manager. If a secret is committed by mistake, rotate it first and clean the history second.
2. **Treat document and database text as untrusted.** Customer documents, AI answers and anything in Firestore can contain markup. Put such text on the page with `textContent` or an escaping helper, never by building HTML strings from it. The cost report console already follows this rule for Firestore data.
3. **Pin third-party code.** Load libraries at a fixed version with an integrity (SRI) hash, and update them deliberately in their own pull request ([architecture.md](architecture.md#libraries-loaded-from-cdns)).
4. **Keep the backend minimal.** The proxy should do as little as possible. Anything added to it (checks, limits) goes in its own pull request and is tested on its own (`CLAUDE.md` rule 2).
5. **Least privilege.** Give collaborators, service accounts and the development partner the narrowest access that does the job, and remove it when the work ends.
6. **Don't publish weaknesses.** Until the repository is private, describe security fixes in neutral terms in pull requests and commit messages, and keep the detail in the private tracker.

## Where findings live

- The October 2026 code review (a private Claude project document and its full report) holds the current list, in priority order. Its first items are security work.
- Once the repository is private, each finding becomes a private GitHub issue with a `security` label, so it's tracked, assigned and closed like any other work.
- If you find a problem, tell Russel directly rather than opening a public issue.

## Related pages

- [Architecture](architecture.md)
- [Backend proxy](backend-proxy.md)
- [Data model](data-model.md)
- [Known issues and roadmap](known-issues-and-roadmap.md)
- [Moving to a company GitHub organisation](plans/move-to-company-github.md)
