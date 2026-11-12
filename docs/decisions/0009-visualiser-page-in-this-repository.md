# ADR 0009: The visualiser's encrypted page is published from this repository

- **Status:** Accepted
- **Date:** 12 November 2026

## Context

The Drawings view shows the Bend & Blind Visualiser in an iframe. Until November 2026 the iframe loaded a second GitHub Pages site, `RussedyBussedy/bd-tools`, from an address written into the script at the end of `index.html`.

- `bd-tools` holds one file: the visualiser's finished, encrypted page. The visualiser's source isn't in any repository ([architecture.md](../architecture.md#things-that-live-outside-this-repository)).
- GitHub doesn't redirect a GitHub Pages site when its repository is transferred. Moving `bd-tools` to the company organisation ([plan](../plans/move-to-company-github.md)) would have left the Drawings view loading a dead address until that line was changed, and moving both repositories meant two sites and two addresses to switch in step.
- The page is encrypted because the site is public. Anyone with the address can load any file the site publishes, whether the repository is public or private ([security.md](../security.md)).

## Decision

Russel, 12 November 2026: "bundle them first, then we can look at locking it later".

- The visualiser's encrypted page lives in this repository as `visualiser/index.html`, copied byte for byte from `bd-tools`, and is published with the frontend.
- The Drawings view loads it by a relative address (`BASE` is `visualiser/`), so it follows OrderBot to any host and any address.
- It stays a page of its own in an iframe. Its code isn't merged into `index.html`.
- It stays encrypted, and its key and passphrase stay out of the repository. The staff SharePoint embed still carries the key.
- `bd-tools` keeps its copy until nobody uses its old address, and is then archived. New builds go here only.

## Alternatives considered

- **Move `bd-tools` as a repository of its own:** two transfers and two address changes to make in step, for a repository that holds one file.
- **Merge the visualiser's code into `index.html`:** a fault in either tool could then stop the other, the two couldn't be released separately, and the visualiser's code would be published in readable form.
- **Drop the encryption once the repository is private:** making the repository private doesn't change who can load the site, so the page would be readable by anyone with the address.
- **One lock page over the whole site, OrderBot included:** it needs a step that builds the app into one file, which [ADR 0001](0001-no-build-step.md) leaves out for now. Left for later.

## Consequences

- There is one repository and one site to host, to move and to give a development partner access to. The plan's step for hosting `bd-tools` falls away.
- A visualiser build is released through a pull request: live within minutes of the merge, and undone with one click ([runbook](../operations/runbooks.md#publish-a-new-visualiser-build)). Nobody can review the file by reading it, so the commit message has to say which version it is.
- Each build adds about 0.7 MB to the repository's history, because an encrypted file neither compresses nor diffs.
- Staff who ticked **Remember on this device** at the old address stay unlocked, because browser storage belongs to the site and the site is the same. After a move to a new address they enter the passphrase once, or open OrderBot through SharePoint as usual.
- The source still has no repository (plan, phase 6). When it gets one, it must never sit where the site publishes it.
- Until `visualiser/` is added to `.dockerignore`, the proxy's container image copies the file. That's harmless; add it with the next proxy change ([known issues](../known-issues-and-roadmap.md)).

## Related pages

- [Decisions](README.md)
- [User interface: the embedded visualiser](../app/user-interface.md#drawings-the-embedded-visualiser)
- [Runbooks](../operations/runbooks.md)
- [Moving to a company GitHub organisation](../plans/move-to-company-github.md)
