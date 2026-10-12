# Project status

_Last updated: 2026-10-12_

**Current stage:** 5 — Backend (step 5.3 done: staging site live end-to-end)

**Next action:** merge the canonical-address PR; then the Stage 5 completion gate (review + exercise).
Google sign-in and custom SMTP (M3) before colleagues sign up.

Staging: `https://inventory-phi-ashen.vercel.app` (permanent address; deployment-specific
`inventory-<random>-mrd23.vercel.app` addresses change on every deploy).

## Stage checklist

| Stage | Status | Evidence |
| ----- | ------ | -------- |
| 1 Requirements | Complete (planning level) | Original project brief; open questions below |
| 2 UI/UX Design | Complete (design level) | `design/` — 26 screens, live canvas |
| 3 Architecture | Complete | `docs/ARCHITECTURE.md` (approved); gate below |
| 4 Database | Complete | Gate below; migrations 0001–0005 on Supabase staging; 87 tests + race test green in CI |
| 5 Backend | In progress | data-access layer; receiving; device preparation; deployments; shipments; abroad configuration; returns/repairs/write-offs; facility stages; corrections; catalogue management; read queries for every screen; login/sign-up/approval; 111 backend tests + 131 DB tests |
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
| H1 | Production hosting: Vercel Hobby terms may treat internal company use as commercial (secondary sources) — decide at Stage 8 (Vercel Pro, or a host whose free plan allows business use) | Revisit at Stage 8 |
| M3 | Custom SMTP email sender before colleagues sign up (Google sign-in now works and avoids email for Google users) (built-in sender is limited; templates locked without it) | Before inviting colleagues |
| E1 | `NEXT_PUBLIC_SUPABASE_URL` in the cloud environment lacks `https://` (code tolerates it) | Owner may fix (non-blocking) |
| R6 | Supabase region is Tokyo; consider a region closer to Oman | Revisit at Stage 8 |

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
| B1 | Server talks to PostgreSQL directly (postgres.js, one transaction per action, `app.user_id` set per transaction); Supabase used for Auth/Storage | 2026-10-11 |
| H0 | Staging site on Vercel (owner's choice; owner considers it personal/non-commercial — assistant flagged the terms risk, see H1) | 2026-10-11 |
| H2 | Vercel uses the Supabase integration's `POSTGRES_URL` (transaction pooler) when `DATABASE_URL` is absent; old manual `DATABASE_URL` removed (PR #5) | 2026-10-12 |
| S5 | First Super Admin bootstrapped on staging (owner's account) via `bootstrap_first_super_admin` | 2026-10-12 |
| R7 | SIMs: a product is marked once as "is a SIM"; ICCIDs entered at receiving; Configure window picks a free SIM by ICCID from a dropdown | 2026-10-12 |
| R8 | When a router's SIM is swapped, the person chooses: old SIM back as a spare, or retired (option C) | 2026-10-12 |
| R9 | Routers must be configured (have a SIM) before an Oman deployment (from lifecycle M1; owner may relax). SIMs are never deployment lines on their own — they travel inside their router | 2026-10-12 |
| R10 | Routers may be shipped abroad unconfigured, with loose SIMs, for the partner to configure; the "configured first" rule (R9) applies to Oman deployments only. A SIM inside a router is never its own line; a loose SIM can be | 2026-10-12 |
| A8 | Everything abroad is tracked: serials shipped, SIMs, which SIM + IP is in which router (recorded by MRD for the partner), and international deployments | 2026-10-12 |
| R11 | A router returned from an Oman site brings its SIM back and stays configured (ready to redeploy). For repair, supplier return or write-off of a router with a SIM, the person chooses: SIM kept as spare (brought back to the office) or retired (owner confirmed 2026-10-12: returned routers are usually reused as-is, without reconfiguration) | 2026-10-12 |
| R12 | Facility stages: forward only; an Editor may skip steps with a reason noted on the form; moving back or re-opening a closed facility needs an Admin/Super Admin and a reason (owner re-confirmed: re-opening is Admin/Super Admin only); `closed` from any stage | 2026-10-12 |
| A9 | A facility can have many configured routers over time. A closed facility may re-open for a new POC or contract; it must be re-opened (stage moved, with a reason) before anything is deployed to it — new or returned office routers can then go out | 2026-10-12 |
| C1 | Catalogue records are archived, never deleted (contacts may be removed); a received product's kind is locked; a facility's country is locked once stock moved there; places holding stock cannot be archived; archived suppliers cannot be used for receiving | 2026-10-12 |
| O1 | `/api/health/db` restricted to the Super Admin (was: any signed-in user) | 2026-10-12 |
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

| 2026-10-11 | `tests/server/receive.test.ts` (Vitest, 8 tests) | **8/8 pass** | Mutation: removing the permission check made "a Viewer is refused" fail |

| 2026-10-11 | Backend (Vitest) 17 tests incl. approval | **17/17 pass** | Test IDs first used invalid UUIDs; the strict input check rejected them (correct) — test data fixed |
| 2026-10-11 | pgTAP incl. 0006 | **94/94 pass** + race test | |
| 2026-10-11 | Live smoke test against Supabase staging Auth | **PASS** | `/` and `/admin/users` redirect signed-out visitors to `/login`; login/sign-up pages render; bogus confirmation link rejected by Supabase |
| 2026-10-12 | Staging DB connection (`/api/health/db`) | **First: fail** → fixed → **PASS** | 28P01: brackets left around the password in `DATABASE_URL`; then ECONNREFUSED when unset. Fixed by PR #5 (use `POSTGRES_URL`) |
| 2026-10-12 | Approval on staging (owner) | **PASS** | Second account approved as Editor, reaches home page |
| 2026-10-12 | 5.4 preparation: pgTAP 0007 (8) + Vitest `prepare.test.ts` (13) | **102/102 + 30/30 pass** | Mutation: removing the "SIM must be free" rule failed 1 backend + 4 DB tests. Older receive test narrowed to its own products (shared test DB) |
| 2026-10-12 | 5.5 deployments: Vitest `deployments.test.ts` (14) | **44/44 pass** | Mutation: removing the "router must be configured" rule failed 5 tests (the completion check caught it a second time) |
| 2026-10-12 | 5.6 shipments: Vitest `shipments.test.ts` (11) + pgTAP 0008 (3), 0009 (3) | **First run: fail** → fixed → **55/55 + 108/108 pass** | Tests found a real Stage 4 bug: shipments could never be cancelled (0009). Also closed a gap: retired units could be moved again (0008) |
| 2026-10-12 | A8 configure at partner: pgTAP 0010 (5) + 2 backend tests | **113/113 + 57/57 pass** | Mutation: without the partner rule, 2 backend tests fail |
| 2026-10-12 | 5.7 returns/repairs/write-offs: Vitest `movements.test.ts` (15) | **72/72 pass** | Mutation: without the "choose what happens to the SIM" rule, 2 tests fail. `changeRouterSim` now shares `takeSimOut`. Prepare test narrowed to its own SIMs (shared test DB) |
| 2026-10-12 | 5.8 stages + corrections: pgTAP 0011 (11) + Vitest `stages-corrections.test.ts` (13) | **124/124 + 85/85 pass** | Mutation: without the database "only Admins move back" rule, 3 backend tests fail (the server relies on the database for that rule) |
| 2026-10-12 | A9 closed-facility rule (1 backend test) | **86/86 pass** | Mutation: without the check at completion, 2 tests fail |
| 2026-10-12 | 5.9 catalogue: pgTAP 0012 (7) + Vitest `catalogue.test.ts` (13) | **First run: fail** → fixed → **131/131 + 99/99 pass** | Test found a real bug: product details were saved as text, not data (double JSON conversion). Mutation: without the kind lock, 1 test fails |
| 2026-10-12 | 5.10 read queries: Vitest `queries.test.ts` (12) | **111/111 pass** | Mutations: removing the search escaping failed 1 test; removing the "no SIM" filter first passed unnoticed (weak test data) → added a configured router in the office → now fails as expected |
| 2026-10-12 | Google button smoke test (local build against staging Supabase) | **Code path OK** | Button sends the browser to Supabase's Google authorize address; Supabase answers "provider is not enabled" until the owner configures Google |
| 2026-10-12 | PR #6 merged; Google sign-in on staging (owner) | **First try: fail** | Back on /login with the "code" message: Google worked, the code exchange failed — most likely started on a deployment address (cookie on another host). Fix: the live site now redirects every address to SITE_URL (308); the message shows the exact reason code. Local check: 308 with VERCEL_ENV=production, 200 without |
| 2026-10-12 | Google sign-in retest from the main address (owner) | **PASS** | Signed in with Google as nitin@moonrock.om → linked to the existing Super Admin account (same email); confirms the address-mismatch cause |
| 2026-10-12 | Staging end-to-end (owner) | **PASS** | Sign-up → email confirm → sign-in → pending page → bootstrap → home shows role `super_admin` |

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
- 2026-10-11 — B1 = A; data-access layer (`withActor`, `requirePermission`) and `receiveDelivery` with 8 backend tests; backend tests added to CI.
- 2026-10-11 — 5.3: migration 0006 (auth link, bootstrap), Supabase login/sign-up/confirm/pending pages, approval actions + admin page, proxy; tests and live smoke test pass.
- 2026-10-11 — H0: Vercel for staging; email template edit not possible without SMTP — confirm route made friendly for the default link.
- 2026-10-11 — PRs #3 (app), #4 (confirm/redirect fixes, health page) merged; Vercel staging live; sign-up and email confirmation working.
- 2026-10-12 — PR #5 merged (H2); database connection works on staging; owner bootstrapped as Super Admin (S5). Step 5.3 complete.
- 2026-10-12 — 5.4: migration 0007 (SIM products, preparation rules); SIM ICCIDs at receiving; configureRouter, changeRouterSim, listFreeSims, serialiseItems with tests (R7, R8).
- 2026-10-12 — 5.5: deployment actions (create, add/remove item, schedule, cancel, complete) with friendly stock/configuration checks; shared `parseInput`; clear "not enough stock" message (R9).
- 2026-10-12 — 5.6: shipment actions (create, add/remove item, cancel, ship, mark received); migrations 0008 (retired units stay retired) and 0009 (shipment cancel bug fix); R10 recorded; A8 asked.
- 2026-10-12 — A8 answered (track everything abroad); migration 0010: configure routers at a partner; SIM dropdown per partner.
- 2026-10-12 — 5.7: returnFromFacility, sendForRepair, backFromRepair, returnToSupplier, writeOff (units and counted items) with SIM handling (R11).
- 2026-10-12 — 5.8: R12 decided; migration 0011 (stage rules, Super Admin corrections); changeFacilityStage, correctStock, correctUnit; A9 asked.
- 2026-10-12 — A9: deployments to a closed facility are refused until it is re-opened.
- 2026-10-12 — 5.9: catalogue management (create/update/archive/restore for 7 lists, contacts); migration 0012; C1.
- 2026-10-12 — 5.10: read queries (stock overview + low stock, item lists, item history, search, deployments/shipments/batches, facilities, lookups, audit log).
- 2026-10-12 — 5.11: Google sign-in button + clearer confirm-route errors; health page Super Admin only (O1).
- 2026-10-12 — PR #6 merged (5.4–5.11, migrations 0007–0012). Canonical-address redirect + clearer sign-in error after the first Google test failed.
