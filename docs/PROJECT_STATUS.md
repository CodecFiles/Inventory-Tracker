# Project status

_Last updated: 2026-10-10_

**Current stage:** 3 — Architecture (step 3.1: inspect what exists, answer the decision questions)

**Next action:** owner answers the Stage 3 decision questions below; then the assistant drafts
`docs/ARCHITECTURE.md` with the recommended options for agreement.

## Stage checklist

| Stage | Status | Evidence |
| ----- | ------ | -------- |
| 1 Requirements | Complete (planning level) | Original project brief; open questions below |
| 2 UI/UX Design | Complete (design level) | `design/` — 26 screens, live canvas |
| 3 Architecture | In progress | — |
| 4 Database | Not started | — |
| 5 Backend | Not started | — |
| 6 Frontend | Not started | — |
| 7 Testing | Not started | — |
| 8 Hosting and Launch | Not started | — |
| 9 Operations | Not started | — |

## What exists today (inspected 2026-10-10)

- Repository contains only `design/` (26 `.dc.html` screens, `canvas.json`, README) and `docs/`.
- No application code: no `package.json`, server, database, schema, migrations, tests, CI or hosting
  configuration.
- The screens are a **clickable prototype**, not a functioning frontend:
  - They run only inside the Claude Design canvas runtime (`support.js`); they are not standalone
    web pages and cannot be deployed as-is.
  - Data is hard-coded sample data plus a browser-side mock store (`localStorage`) and one optional
    shared document on the canvas. No server-side validation, permissions or real login.
- Reusable from the design: layouts, design tokens (colours, type, spacing), status vocabulary,
  workflows, sample data shapes and role names (Admin, Operations, Technician, Viewer).
- Design hints that affect architecture (to be confirmed, not assumed):
  - Login screen offers "Continue with Microsoft 365" and `@moonrock.om` emails.
  - Screens reference photo/document uploads, PDF/CSV exports, email notifications, barcode/serial
    scanning and Teltonika RMS.

## Open decisions (Stage 3)

| # | Question | Why it matters | Answer |
|---|----------|----------------|--------|
| D1 | Does MRD use Microsoft 365 for staff email/accounts? Can IT register an app in Entra ID? | Decides login (SSO vs own passwords) | — |
| D2 | Where may company data be hosted? (any cloud region / must stay in Oman or GCC / on-premise only) | Decides hosting options | — |
| D3 | Rough user numbers (total and at the same time) and monthly hosting budget | Sizing and cost | — |
| D4 | Who will maintain it after launch — only the owner, or an IT team too? Any language/stack the IT team already supports? | Maintainability | — |
| D5 | Must field technicians work offline (no signal on site)? | Offline sync is a large architectural cost | — |
| D6 | Teltonika RMS: integrate in version 1, or manual entry only? | External integration scope | — |

## Decisions made

_None yet._

## Test results

_None yet._

## Change log

- 2026-10-10 — Roadmap and status record added; Stage 3 started with project inspection.
