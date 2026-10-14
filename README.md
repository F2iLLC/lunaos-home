# Luna OS Home

Luna OS Home is a personal and household assistant project intended to make everyday administration easier, starting with appointment preparation, form-filling workflows, and finding the right reference information when it is needed.

These are intended workflows, not implemented features. This is a separate project from LunaOS. It is an early private project owned by F2i LLC. A public release may be considered later; no open-source commitment has been made and no license has been selected.

## Proposed features — future work

These proposals describe the direction for discussion, not implemented capabilities or release commitments:

- **Household profiles:** Reuse information for household members so users do not repeatedly answer the same questions.
- **Document references:** Identify records needed for a task and where to find them, with personal records and real references stored outside the source repository.
- **Appointment coordination:** Find workable times, prepare requests, and eventually book with providers within user-set permissions.
- **Form assistance:** Prefill known information and flag missing or uncertain details for review.
- **Follow-through:** Track confirmations, missing paperwork, deadlines, and reminders.

A suggested first workflow for discussion is one appointment from request to confirmed booking, including the information and preparation it requires. This workflow is not implemented or a committed release promise.

## What works today

The initial starter is a local browser checklist. You can add a task, choose a category, mark it complete, and remove it. Categories help organize tasks; they do not perform the named workflows.

Tasks live only in the current browser tab's memory. Reloading or closing the page clears the checklist. The app does not save tasks, send task content to the local server, or contact external services. It has no accounts, reminders, appointment booking, form filling, integrations, or file retrieval. It does not read personal documents or store references to them.

## Run locally

Install Node.js 24 or newer. From this repository's directory, run:

```sh
npm start
```

Open <http://127.0.0.1:4173> in your browser. Stop the server with Ctrl+C. The server listens only on the local loopback address and serves the application's four public files. If port 4173 is occupied, stop the other process using it before starting this app.

There are no third-party runtime or development dependencies and no install step is needed. Use generic task labels, such as "Review the sample school checklist," rather than personal details. There is no save or export function.

## Develop and test

```sh
npm test
```

Tests cover task validation and state changes, along with the local server's allowed files, methods, and response headers. Application files are in `src/`; `server.js` provides the local static server. GitHub Actions runs the tests on pushes and pull requests.

For a quick browser check, add a fictional task, complete it, remove it, and reload the page to verify that tasks do not persist.

## What belongs in this repository

Keep reusable application code, supporting tests and configuration, and documentation that helps people use or develop the program here. Any examples or test data must be fictional.

Keep personal and family records, live household data, real private-file paths or links, credentials, secrets, agent transcripts, scratch notes, progress reports, status reports, and task plans outside the checkout. Future reference-information workflows should work with separately stored personal files; this starter does not implement those workflows.

The ignore rules exclude common personal-data, secret, and working-material locations. They are a precaution, not a content scanner or a security boundary: Git can still track sensitive material under other names or when force-added. Before committing, review the staged file list and diff with `git diff --cached --name-only` and `git diff --cached`. Do not force-add excluded material. Private repository visibility does not make this repository an appropriate place for household records.
