# Project status

_Last updated: 2026-10-11_

**Current stage:** 5 — Backend (step 5.1: project skeleton + database-access decision)

**Next action:** owner decides B1 (how the server talks to the database); assistant scaffolds the
Next.js project and the database-access layer with tests.

## Stage checklist

| Stage | Status | Evidence |
| ----- | ------ | -------- |
| 1 Requirements | Complete (planning level) | Original project brief; open questions below |
| 2 UI/UX Design | Complete (design level) | `design/` — 26 screens, live canvas |
| 3 Architecture | Complete | `docs/ARCHITECTURE.md` (approved); gate below |
| 4 Database | Complete | Gate below; migrations 0001–0005 on Supabase staging; 87 tests + race test green in CI |
| 5 Backend | In progress | — |
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

| # | Question | Status |
|---|----------|--------|
_None blocking._

## Stage 3 completion gate

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Agreed architecture | Yes | D7; `ARCHITECTURE.md` §4 |
| Documented technology stack | Yes (later-stage choices listed with their stage) | `ARCHITECTURE.md` §8 |
| Clear component diagram | Yes | `ARCHITECTURE.md` §2, §10 |
| Explanation of component interaction | Yes | `ARCHITECTURE.md` §3, §9 |
| Owner understands it | Yes | Q1 answered correctly. Q2 concept confirmed 2026-10-11 via the cables exercise (owner: first save wins, second is rejected). Verified hands-on 2026-10-11 by `scripts/db-concurrency-test.sh`. Q3 explained by assistant |

## Stage 4 completion gate

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Approved schema | Yes | M2; `docs/DATABASE.md` v1.0 |
| Implemented migrations | Yes | `supabase/migrations/0001–0005`, deployed to Supabase staging (S3) |
| Reliable database access | Yes for deployment/migrations; app access is built in Stage 5 | CI + GitHub integration |
| Documented relationships | Yes | `docs/DATABASE.md` (ER diagram, L0–L5, migration notes) |
| Tests for critical integrity rules | Yes | 87 pgTAP tests + race test; mutation checks |
| Owner understanding | Partly | Exercises on keys, normalisation, constraints, concurrency answered correctly; index and backup questions explained by assistant (owner could not answer yet) — revisit in Stage 7 (indexes) and Stage 8 (backups) |

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
| R1 | One TRB router uses one SIM at a time; SIM gets an IP after configuration | 2026-10-11 |
| R2 | One deployment can contain many products | 2026-10-11 |
| R3 | Items can return (POC not converted, fault) → office, repair/servicing/reconfiguration, or supplier (warranty); may be redeployed | 2026-10-11 |
| F1 | Single receiving location: MRD Office, no shelves/bins; goods also shipped abroad (any product) | 2026-10-11 |
| R4 | Abroad: partner companies (per country, 1+ contacts) take ownership; countries also have facilities with deployments/POCs/contracts | 2026-10-11 |
| R5 | IP assigned at configuration; stored per SIM-in-router assignment (owner unsure; design works either way) | 2026-10-11 |
| F8 | Any number of countries | 2026-10-11 |
| F9 | MRD tracks all abroad deployments (items, quantities, facility) | 2026-10-11 |
| M1 | Conceptual model v0.3 and unit lifecycle approved ("fully correct") | 2026-10-11 |
| F10 | Items never come back from abroad (Super Admin correction only) | 2026-10-11 |
| L1 | SIMs modelled as units + `sim_details` (assistant design change, explained in DATABASE.md §L1) | 2026-10-11 |
| Q1 | Batch codes auto-generated (supplier prefix-year-number); manual entry may be allowed later | 2026-10-11 |
| Q3 | Repairs done by the supplier or outside repair companies | 2026-10-11 |
| A4 | One client can have many facilities | 2026-10-11 |
| A5 | Final facility stage `closed` when a POC is not converted | 2026-10-11 |
| A6 | MRD is based in Oman; facilities outside Oman are handled via a partner | 2026-10-11 |
| P1 | Admin with users.approve assigns only Editor/Viewer; only Super Admin creates Admins | 2026-10-11 |
| P2 | Editors can do all operational work incl. completing deployments and stage changes | 2026-10-11 |
| M2 | Full logical design approved (`docs/DATABASE.md` v1.0) | 2026-10-11 |
| T1 | Plain SQL migrations (Supabase CLI layout) + pgTAP tests | 2026-10-11 |
| A7 | ICCID is 18–22 digits | 2026-10-11 |
| A2 | SIM change → router reconfigured, likely new IP; handled by a new SIM assignment row (design unchanged) | 2026-10-11 |
| S0 | Supabase staging project created; GitHub repo linked to it (owner) | 2026-10-11 |
| S1 | Supabase GitHub integration enabled: repo linked, directory `.`, deploy to production from `main` (free plan; preview branches need Pro, not needed) | 2026-10-11 |
| S2 | PR #2 merged into `main` (merge commit 8c87d17); CI green on `main` | 2026-10-11 |
| S3 | Supabase staging deploy succeeded — owner sees the tables in Table Editor (free plan "Deploy to production" works) | 2026-10-11 |
| S4 | Branch rule narrowed to `main` (PR required); working branch pushes normally | 2026-10-11 |
| D9 | Development on free tiers (best/safest free options); small monthly fee acceptable at launch | 2026-10-10 |

Stage 2 revision needed (rule 4): the Users/Settings screens show Admin/Operations/Technician/Viewer
and a "Continue with Microsoft 365" login; these must change to the agreed roles and Google/email
sign-in with approval.

## Stage summaries

**Stage 3 — Architecture (closed 2026-10-10).** Learned: frontend / backend / database roles; why
rules are enforced on the server and again in the database; authentication vs authorisation;
environments; why relational PostgreSQL suits inventory better than MongoDB. Accomplished: approved
architecture, stack, component and security diagrams, request flow (`docs/ARCHITECTURE.md`).

**Stage 4 — Database (closed 2026-10-11).** Learned: tables, rows, primary/foreign keys, one-to-many
/ many-to-many / one-at-a-time relationships, normalisation, data types, constraints, triggers,
transactions, concurrency, migrations, CI, indexes and backups (introduced). Accomplished: approved
design, 5 migrations live on Supabase staging, 87 integrity tests + race test running on every push.

## Test results

| Date | Suite | Result | Notes |
|------|-------|--------|-------|
| 2026-10-11 | `supabase/tests/0001_*` (18 tests), local PostgreSQL 16 | **18/18 pass** | Mutation check: removing the serial-number unique rule made test 4 fail as expected — the tests detect a missing rule |
| 2026-10-11 | `0002_*` (12) + `0003_*` (20) | **First run: fail** → fixed → **50/50 pass** | Tests found a real bug (stock subtraction via upsert rejected valid deployments); fixed in 0003 before commit |
| 2026-10-11 | `0004_*` (21) + `0005_*` (16) | **87/87 pass** (all suites) | Mutation checks: removing the double-deployment index failed tests 11 and 18; removing the last-Super-Admin rule failed test 14 |
| 2026-10-11 | GitHub Actions `Database tests` run #1 | **PASS** — 87/87 + race test | Same suite on GitHub's servers; now runs on every push and PR |
| 2026-10-11 | GitHub Actions on `main` after merge (run #6) | **PASS** | |
| 2026-10-11 | `scripts/db-concurrency-test.sh` | **PASS** (3 runs) | Two simultaneous 6-cable deployments: 1 succeeds, 1 rejected, office 4. Mutation (no ≥ 0 rule): office −2, site 12 → FAIL as expected |

## Change log

- 2026-10-10 — Roadmap and status record added; Stage 3 started with project inspection.
- 2026-10-10 — Owner answered D1–D6; draft architecture written.
- 2026-10-10 — D8, D9 decided; database choice (D7) under discussion.
- 2026-10-10 — D7 decided (PostgreSQL via Supabase); architecture approved and completed (stack, request flow, security boundaries).
- 2026-10-10 — Stage 3 closed; Stage 4 started.
- 2026-10-11 — 4.1 exercise: owner listed Products, Batches, Routers, SIMs, Facilities, Deployments,
  Users (all correct). Added: Units (generalises Routers), Locations, Stock movements, Audit log,
  Roles/Permissions, Facility stage history.
- 2026-10-11 — R1–R3 answered; draft ER model v0.1 written (`docs/DATABASE.md`).
- 2026-10-11 — R4, R5 answered; model v0.2 (partners, contacts, shipments, IP per assignment).
- 2026-10-11 — Model v0.3: countries table, partner stock + abroad deployments, configurable-only step.
- 2026-10-11 — Conceptual model approved; logical design part 1 written (v0.4).
- 2026-10-11 — Q1 answered; serial exercise answered correctly; logical design part 2 written (v0.5).
- 2026-10-11 — Q3 answered; concurrency exercise answered correctly; logical design part 3 written (v0.6).
- 2026-10-11 — A4–A6 confirmed; logical design part 4 written (v0.7).
- 2026-10-11 — P1, P2 confirmed; logical design complete (v0.8).
- 2026-10-11 — Design approved (M2); tooling chosen (T1); migration 0001 + 18 pgTAP tests passing.
- 2026-10-11 — Migrations 0002 (places) and 0003 (stock) with 32 tests + concurrency test; bug found and fixed.
- 2026-10-11 — Migrations 0004 (deployments, shipments, SIMs) and 0005 (permissions, audit); 87 tests passing.
- 2026-10-11 — Supabase staging project created and linked to GitHub (owner); CI workflow added, first run green.
- 2026-10-11 — Supabase integration enabled; PR #2 opened (branch → main).
- 2026-10-11 — PR #2 merged; CI green on main; Supabase deploy confirmed by owner (tables visible).
- 2026-10-11 — Stage 4 closed; Stage 5 (Backend) started.
