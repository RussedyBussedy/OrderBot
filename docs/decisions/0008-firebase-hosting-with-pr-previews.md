# ADR 0008: Firebase Hosting, with a preview for every pull request

- **Status:** Proposed
- **Date:** 29 October 2026

## Context

`main` is published straight to the capturers by GitHub Pages. There's no way to try a branch in a real browser against real documents before it's merged, and a local copy can't call the AI and would save into production ([environments.md](../environments.md)). GitHub Pages also stops being free once the repository is private ([ADR 0007](0007-private-company-github-organisation.md)).

## Decision (proposed)

- Host the frontend on **Firebase Hosting** in the existing project, deployed by GitHub Actions: preview channels for pull requests, and the live channel on merge to `main`. Set it up with `firebase init hosting:github`.
- Give previews and local runs a separate **staging** Firestore database, chosen by hostname in `js/config.js`.
- Let the proxy accept the preview and `localhost` origins (a backend change, deployed on its own).

## Alternatives considered

- **Azure Static Web Apps:** built-in pull request environments and Microsoft Entra ID sign-in, which fits the company's Microsoft 365 preference. But it adds a third platform while Firestore and the proxy stay on Google. Revisit it with the Microsoft sign-in work.
- **GitHub Pages with a preview action:** previews land inside the live site, and private repositories need a paid plan for Pages.
- **A permanent staging copy:** has to be kept in step, and doesn't give each pull request its own link.

## Consequences

- Every pull request gets a link that a capturer or Paul can try, and test data stays out of production.
- Production's address changes once, so the SharePoint embed, the proxy's CORS list and any bookmarks are updated in the same planned step.
- One more piece of configuration in the repository (`firebase.json`, the workflows), reviewed like code.

## Related pages

- [Decisions](README.md)
- [Environments](../environments.md)
- [Moving to a company GitHub organisation](../plans/move-to-company-github.md)
