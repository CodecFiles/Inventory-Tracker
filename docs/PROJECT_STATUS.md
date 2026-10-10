# Project status

_Last updated: 2026-10-10_

**Current stage:** 3 — Architecture (step 3.3: completion-gate check)

**Next action:** owner reads `docs/ARCHITECTURE.md` §2, §9, §10 and explains the request flow back
in their own words (understanding check); then Stage 3 is closed and Stage 4 begins.

## Stage checklist

| Stage | Status | Evidence |
| ----- | ------ | -------- |
| 1 Requirements | Complete (planning level) | Original project brief; open questions below |
| 2 UI/UX Design | Complete (design level) | `design/` — 26 screens, live canvas |
| 3 Architecture | In progress — gate items 1–4 met, awaiting understanding check | `docs/ARCHITECTURE.md` (approved) |
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

## Open decisions

_None for Stage 3._

## Stage 3 completion gate

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Agreed architecture | Yes | D7; `ARCHITECTURE.md` §4 |
| Documented technology stack | Yes (later-stage choices listed with their stage) | `ARCHITECTURE.md` §8 |
| Clear component diagram | Yes | `ARCHITECTURE.md` §2, §10 |
| Explanation of component interaction | Yes | `ARCHITECTURE.md` §3, §9 |
| Owner understands it | Pending | Understanding check |

## Decisions made

| # | Decision | Date |
|---|----------|------|
| D1 | No Microsoft 365. Login with any email (company, Gmail, others); Google sign-in wanted | 2026-10-10 |
| D1b | New sign-ups stay pending until an admin approves | 2026-10-10 |
| D1c | Roles v1: Super Admin (all), Admin (permissions granted by Super Admin), User (features only) | 2026-10-10 |
| D2 | No company servers; managed cloud, free or minimum cost, must be safe | 2026-10-10 |
| D3 | ~15–20 users; minimum budget | 2026-10-10 |
| D5 | No offline mode — technicians enter work from the office | 2026-10-10 |
| D6 | No Teltonika RMS integration; routers tracked as inventory | 2026-10-10 |
| D8 | Roles v1: Super Admin · Admin (permissions granted by Super Admin) · Editor (read + edit) · Viewer (read only). Supersedes D1c | 2026-10-10 |
| D7 | Architecture Option A approved: Next.js + Supabase (PostgreSQL, Auth, Storage). MongoDB considered and rejected for integrity reasons | 2026-10-10 |
| D9 | Development on free tiers (best/safest free options); small monthly fee acceptable at launch | 2026-10-10 |

Stage 2 revision needed (rule 4): the Users/Settings screens show Admin/Operations/Technician/Viewer
and a "Continue with Microsoft 365" login; these must change to the agreed roles and Google/email
sign-in with approval.

## Test results

_None yet._

## Change log

- 2026-10-10 — Roadmap and status record added; Stage 3 started with project inspection.
- 2026-10-10 — Owner answered D1–D6; draft architecture written.
- 2026-10-10 — D8, D9 decided; database choice (D7) under discussion.
- 2026-10-10 — D7 decided (PostgreSQL via Supabase); architecture approved and completed (stack, request flow, security boundaries).
