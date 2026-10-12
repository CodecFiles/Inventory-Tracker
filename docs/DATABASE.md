# Database design — v1.0 (approved 2026-10-11) (conceptual model approved 2026-10-11; logical design in progress)

_Stage 4. Conceptual model only — no SQL yet. Built from the owner's answers on 2026-10-11._

v0.2: added partner companies abroad, partner contacts, shipments; IP stored per SIM assignment.
v0.3: any number of countries (`countries` table); abroad deployments tracked via partner stock;
non-configurable products skip "Configured".
v0.4: conceptual model approved; no return path from abroad (F10); SIMs become units (see §L1);
logical design part 1 (products, suppliers, batches, units).
v0.5: batch codes auto-generated from supplier prefix (Q1); logical design part 2 (locations, movements, stock levels).
v0.6: repairs by supplier or outside repair companies (Q3); logical design part 3 (clients, facilities, partners, deployments, shipments).
v0.7: A4–A6 confirmed (MRD based in Oman); logical design part 4 (users, roles, permissions, audit).
v0.8: P1, P2 confirmed — logical design complete.
v1.0: owner approved the full logical design; implementation started (plain SQL migrations, T1).

## Business facts this model is built on

| # | Fact (owner, 2026-10-11) | Effect on the design |
|---|--------------------------|----------------------|
| F1 | All goods are received at **MRD Office** — one place, no shelves/bins | One office location; no bin-level tracking |
| F2 | Goods go from the office to **facilities**, or are **shipped abroad** (e.g. Saudi Arabia, Qatar) — any product, not only routers/SIMs | Destinations include facilities and foreign recipients |
| F3 | A Teltonika TRB router uses **one SIM at a time**; the SIM has an IP after configuration | SIM ↔ router is one-to-one *at a time*, with history |
| F4 | One deployment to a facility can contain **many products** | Deployment → many deployment items |
| F6 | Goods sent abroad go to a **partner company** in that country, which takes ownership. Each partner has a company name and **one or more contact people**. Countries also have **facilities** with deployments, POCs and contracts | `partners`, `partner_contacts`, `shipments`; facilities get a country and an optional partner |
| F7 | IP is assigned **at configuration**; a SIM change means reconfiguration and probably a new IP (owner not certain) | IP stored on the **SIM-in-router assignment**, not on the SIM or router alone — correct in either case |
| F8 | **Any number of countries**, not only Qatar/Saudi | `countries` reference table |
| F9 | MRD must track **all abroad deployments** — which items, how many, to which facility | Shipped items sit in the partner's stock until an abroad deployment is recorded |
| F10 | Items **never come back from abroad** | No return path from partner stock/abroad facilities in normal workflow; a Super Admin correction is the only exception |
| F11 | **Hybrid** products (e.g. CO₂ sensors) arrive as a counted quantity and get serials during preparation (from design) | Batch records the counted quantity; units are created when serials are assigned |
| F5 | Equipment can **come back** (POC not converted, fault) and go to **repair/servicing/reconfiguration** or **back to the supplier** under warranty, then possibly be redeployed | Units have a lifecycle and a full movement history |

Note: the design's sample data uses the RUT956 model; MRD's real router is the TRB series. Product
models are data rows, not part of the structure, so this changes nothing in the schema.

## Entity-relationship diagram (draft)

```mermaid
erDiagram
    PRODUCTS ||--o{ UNITS : "model of"
    BATCHES ||--o{ UNITS : "received in"
    SUPPLIERS ||--o{ BATCHES : "supplies"
    LOCATIONS ||--o{ UNITS : "currently at"
    UNITS ||--o{ SIM_ASSIGNMENTS : "router side"
    SIMS ||--o{ SIM_ASSIGNMENTS : "sim side"
    FACILITIES ||--o{ DEPLOYMENTS : "receives"
    DEPLOYMENTS ||--|{ DEPLOYMENT_ITEMS : "contains"
    UNITS ||--o{ DEPLOYMENT_ITEMS : "deployed as"
    PRODUCTS ||--o{ DEPLOYMENT_ITEMS : "quantity items"
    UNITS ||--o{ STOCK_MOVEMENTS : "history"
    LOCATIONS ||--o{ STOCK_MOVEMENTS : "from / to"
    FACILITIES ||--o{ FACILITY_STAGE_HISTORY : "lifecycle"
    PARTNERS ||--|{ PARTNER_CONTACTS : "has"
    PARTNERS ||--o{ FACILITIES : "manages (abroad)"
    COUNTRIES ||--o{ PARTNERS : "based in"
    COUNTRIES ||--o{ FACILITIES : "located in"
    PARTNERS ||--o{ SHIPMENTS : "receives"
    SHIPMENTS ||--|{ SHIPMENT_ITEMS : "contains"
    UNITS ||--o{ SHIPMENT_ITEMS : "shipped as"
    USERS ||--o{ AUDIT_LOG : "performed"
```

(GitHub renders this as a picture.)

## The tables in plain language

| Table | One row is… | Key rules |
|-------|-------------|-----------|
| `products` | A model or item type (TRB router, SIM, sensor, Cat6 cable) | Tracking type: **serialised** (one row per item in `units`) or **quantity** (counted) |
| `suppliers` | A company MRD buys from | Needed for warranty returns |
| `batches` | One delivery received at MRD Office | Belongs to one supplier |
| `units` | One physical serialised item | Unique serial; belongs to one product and one batch; has a current status and location |
| `sims` | One SIM card | Unique ICCID; holds its number and IP |
| `sim_assignments` | "This SIM was in this router from… to…, configured with IP …" | **Only one open assignment per router and per SIM**; an IP can't be on two open assignments |
| `locations` | A place goods can be: MRD Office, each facility, each partner's stock, repair/service, supplier | Single office; no shelves |
| `facilities` | A client site (Qatar Foundation, Lulu…) in any country | Has a country, a current stage, and optionally the partner that manages it |
| `countries` | One country (Oman, Qatar, Saudi Arabia, …) | Unique name/code; add new countries any time, no code change |
| `partners` | A partner company abroad (one or more per country) | Company name, country; has its own stock location |
| `partner_contacts` | One contact person at a partner | A partner has one or more |
| `shipments` | One consignment from MRD Office to a partner | Has many items; ownership passes to the partner |
| `shipment_items` | One line of a shipment: a unit, or a product + quantity | A unit can't be in two open shipments |
| `facility_stage_history` | "Facility moved to stage X on date Y by Z" | Insert-only |
| `deployments` | One dispatch to a facility (POC or contract) | Has many items |
| `deployment_items` | One line of a deployment: a unit, or a product + quantity | A unit can't be in two active deployments |
| `stock_movements` | Any move: received, deployed, returned, sent to repair, shipped abroad, back to supplier | **Insert-only — history is never edited or deleted** |
| `users`, `roles`, `permissions` | People and what they may do | Pending until approved |
| `audit_log` | Any change: who, what, when, before/after | Insert-only |

## Unit lifecycle (draft)

```
Received ─► In office ─┬─► Configured* ─┬─► Deployed (facility, any country)
               ▲       │                │
               │       │                └─► Shipped to partner ─► Partner stock ─► Deployed abroad
               │       └── (non-configurable products go straight to Deployed / Shipped)
               │
               ├── In repair / servicing ◄── fault (from office or a deployment)
               └── Returned to office  ◄──── POC not converted / removed from facility
In office / In repair ─► Returned to supplier (warranty) ─► replacement arrives as a new receipt
Any ─► Retired (written off)

* Configured applies to routers (SIM + IP); sensors, cables etc. skip it.
```

Control report this enables: **"Shipped to partner, not yet deployed"** — anything sitting in a
partner's stock too long is visible.

## Assumptions to confirm (do not block the design)

- **A1** (resolved → F9) Abroad deployments are tracked.
- **A3** (resolved → F10) Items do not come back from abroad.
- **A2** IP-per-assignment (F7): confirm with whoever configures the routers.

---

# Logical design (columns, types, rules)

## L0. Conventions used in every table

| Convention | Meaning | Why |
|------------|---------|-----|
| `id bigint` identity primary key | Internal number, assigned by the database, never changes | Stable links between tables |
| `created_at`, `updated_at timestamptz` | When the row was made / last changed, with time zone | Oman, Qatar, Saudi users see correct local times |
| `is_active boolean` instead of deleting | "Archived" rather than removed | Deleting a product would break the history of every unit that used it |
| Foreign keys use `ON DELETE RESTRICT` | The database refuses to delete a row others still point to | History can't be destroyed by accident |
| Status values are a fixed list (enum) | e.g. `in_office`, `configured`, `deployed` | A typo like `deplyed` is rejected |

## L1. Design change: SIMs are units

In v0.3 SIMs had their own table. But a SIM is received in a batch, sits in the office, moves to a
facility inside a router — exactly what `units` already tracks. Keeping them separate would mean
building receiving, movements and history twice. So: **a SIM is a unit of a SIM product**, and its
SIM-only fields (ICCID, phone number, carrier) live in a small side table `sim_details` linked
one-to-one. `sim_assignments` now links a SIM unit to a router unit.

## L2. Part 1 — products, suppliers, batches, units

### `categories`
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| name | text | required, unique (Routers, SIM cards, Sensors, Cables & Accessories …) |
| is_active | boolean | default true |

### `products`
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| name | text | required |
| brand | text | required (Teltonika …) |
| model | text | required (TRB…) ; **unique together with brand** |
| category_id | bigint | required → `categories` |
| tracking_type | enum | `serialised` · `quantity` · `hybrid` — required |
| requires_configuration | boolean | default false (true for routers) |
| min_stock_level | integer | required, default 0, **must be ≥ 0** |
| description | text | optional |
| specifications | jsonb | optional free-form key/values (varies per product) |
| is_active, created_at, updated_at | | conventions |

### `suppliers`
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| name | text | required, unique |
| code_prefix | text | required, unique, 2–5 capital letters (e.g. `TEL`) — used for batch codes |
| country_id | bigint | → `countries` |
| email, phone | text | optional |
| is_active, created_at, updated_at | | conventions |

### `batches` — one delivery received at MRD Office
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| code | text | required, unique (e.g. `TEL-2026-004`). **Generated automatically** as supplier prefix – year – next number for that prefix and year. Switching to manual entry later only changes the form; the unique rule stays |
| supplier_id | bigint | required → `suppliers` |
| purchase_order | text | optional |
| invoice_number | text | optional |
| received_on | date | required, not in the future |
| received_by | uuid | required → `users` |
| notes | text | optional |
| created_at | timestamptz | convention |

### `batch_lines` — what a delivery contained
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| batch_id | bigint | required → `batches` |
| product_id | bigint | required → `products`; **one line per product per batch** |
| quantity_received | integer | required, **must be > 0** |

### `units` — one physical serialised item (routers, SIMs, serialised sensors)
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| product_id | bigint | required → `products` (must be serialised or hybrid) |
| batch_line_id | bigint | required → `batch_lines` (where it came from) |
| serial_number | text | required; **unique per product** |
| imei | text | optional; unique when present |
| status | enum | required, default `in_office` (lifecycle values) |
| location_id | bigint | required → `locations` (where it is now) |
| created_at, updated_at | | conventions |

Rule enforced in a transaction, not a simple column check: units created for a batch line can never
exceed its `quantity_received`.

### `sim_details` — extra fields for SIM units (one-to-one)
| Column | Type | Rules |
|--------|------|-------|
| unit_id | bigint | primary key **and** → `units` (that's what makes it one-to-one) |
| iccid | text | required, unique |
| phone_number | text | optional, unique when present |
| carrier | text | optional |

Added in 0007 (R7, 2026-10-12): `products.is_sim` (yes/no, set **once per product** in the catalogue,
e.g. "Omantel Data SIM"). A SIM product must be serialised. When a SIM product is received, each
serial number is the SIM's ICCID and a `sim_details` row is created; `sim_details` is refused for
units of non-SIM products.

## L3. Part 2 — locations, movements, stock levels

The bank-account model: a bank keeps **every transaction** (never edited) and a **balance**.
We do the same — `stock_movements` is the transaction list, `stock_levels` is the balance.

### `locations`
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| type | enum | `office` · `facility` · `partner_stock` · `repair_company` · `supplier` — required |
| name | text | required (e.g. "MRD Office", "Lulu Hypermarket") |
| facility_id | bigint | → `facilities`; **required when type = facility**, otherwise empty |
| partner_id | bigint | → `partners`; **required when type = partner_stock**, otherwise empty |
| supplier_id | bigint | → `suppliers`; **required when type = supplier**, otherwise empty |
| repair_company_id | bigint | → `repair_companies`; **required when type = repair_company**, otherwise empty |

One location per facility, per partner and per supplier (unique). Exactly one `office` row.

### `stock_movements` — every move ever made (insert-only)
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| movement_type | enum | `receive` · `serialise` · `deploy` · `ship` · `deploy_abroad` · `return` · `send_repair` · `back_from_repair` · `return_to_supplier` · `write_off` · `correction` |
| product_id | bigint | required → `products` |
| unit_id | bigint | → `units`; set for serialised items, empty for quantity items |
| quantity | integer | required, **> 0**; **must be 1 when unit_id is set** |
| from_location_id | bigint | → `locations`; empty only for `receive` |
| to_location_id | bigint | → `locations`; empty only for `write_off`; **must differ from from_location** |
| batch_id / deployment_id / shipment_id | bigint | the document that caused the move (whichever applies) |
| performed_by | uuid | required → `users` |
| moved_at | timestamptz | required, default now |
| note | text | optional |

- **No updates, no deletes** — enforced by database permissions, not just app code. A mistake is
  fixed by a new `correction` movement, like a reversing entry in accounting.
- `send_repair` may only go to a `supplier` or `repair_company` location (Q3); `back_from_repair`
  only comes from one.
- `deploy_abroad` may only start from a `partner_stock` location (F9); nothing may move *out of*
  an abroad facility or partner stock except by a Super Admin `correction` (F10).

### `stock_levels` — current balance for counted (quantity / un-serialised hybrid) items
| Column | Type | Rules |
|--------|------|-------|
| location_id | bigint | → `locations` |
| product_id | bigint | → `products` |
| quantity | integer | required, **CHECK quantity ≥ 0 — this is the "no negative stock" guarantee** |
| | | **Primary key = (location_id, product_id)** — one balance row per product per place |

Serialised units don't need a balance row: each unit's `location_id` *is* its position, and
counts are calculated from `units`.

### How one operation stays consistent (transaction)

Deploying 6 cables from the office to Lulu runs as **one transaction**:

```
BEGIN
  1. office balance  : 10 → 4     (row is locked while we change it)
  2. Lulu balance    :  0 → 6
  3. insert stock_movement (deploy, 6, office → Lulu)
  4. insert audit record
COMMIT   ← all four happen, or none do
```

If step 1 would make the office balance negative, the CHECK rule fails, the database undoes
steps 1–4, and the user sees "Only 4 in stock".

## L4. Part 3 — clients, facilities, partners, deployments, shipments

### `repair_companies` (Q3)
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| name | text | required, unique |
| country_id | bigint | → `countries` |
| email, phone, is_active | | optional / convention |

### `clients` — the organisation a facility belongs to (A4 confirmed: one client → many facilities)
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| name | text | required, unique (Qatar Foundation, Bank Muscat, Lulu …) |
| is_active, created_at | | convention |

### `facilities`
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| name | text | required (e.g. "Bank Muscat Head Office") |
| client_id | bigint | required → `clients` |
| facility_type | text | optional (office, hypermarket, campus …) |
| country_id | bigint | required → `countries` |
| city / address | text | optional |
| partner_id | bigint | → `partners`; **required when the country is not Oman** — MRD is based in Oman (A6 confirmed) |
| stage | enum | `site_inspection` · `bms_scan` · `poc` · `poc_study` · `contract` · `deployment` · `active_operations` · `closed` |
| project_lead | uuid | → `users` |
| is_active, created_at, updated_at | | convention |

`facility_stage_history` (insert-only): facility_id, from_stage, to_stage, changed_by, changed_at,
note. Stage changes must follow the order unless an admin overrides; `closed` = POC not converted.

### `facility_contacts` / `partner_contacts` (same shape)
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| facility_id / partner_id | bigint | required → owner row |
| name | text | required |
| role, email, phone | text | optional |
| is_primary | boolean | **at most one primary contact per facility / partner** |

### `partners`
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| name | text | required; **unique per country** |
| country_id | bigint | required → `countries` |
| is_active, created_at | | convention |

### `deployments` — one dispatch to one facility
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| code | text | required, unique, generated (e.g. `DEP-2026-031`) |
| facility_id | bigint | required → `facilities` |
| deployment_type | enum | `poc` · `contract` |
| from_location_id | bigint | required → `locations`: MRD Office, or the partner's stock for abroad facilities |
| status | enum | `draft` · `scheduled` · `completed` · `cancelled` |
| deployment_date | date | required when completed |
| created_by / completed_by | uuid | → `users` |
| notes | text | optional |

**Stock only moves when a deployment is completed** — drafts and scheduled deployments don't
reduce stock, and the stock check happens at completion.

### `deployment_items`
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| deployment_id | bigint | required → `deployments` |
| product_id | bigint | required → `products` |
| unit_id | bigint | → `units`; required for serialised products, empty for quantity products |
| quantity | integer | > 0; must be 1 when unit_id is set |
| building, position | text | optional ("Placement at facility" in the design) |
| removed_at | timestamptz | set when the item is returned/removed |

**The double-deployment rule (from Stage 3 Q2):** a unit may appear in only one deployment item
that is not removed and whose deployment isn't cancelled — a *partial unique index* on `unit_id`.

### `shipments` / `shipment_items` — MRD Office → partner stock
Same shape as deployments/items, with `partner_id` instead of facility, plus `courier`,
`tracking_number`, `shipped_on`; status `draft` · `shipped` · `received_by_partner` · `cancelled`.
Stock moves to the partner's stock location when status becomes `shipped`.

## L5. Part 4 — users, roles, permissions, audit

### `users` — one row per person (linked to their Supabase login)
| Column | Type | Rules |
|--------|------|-------|
| id | uuid | primary key **and** → Supabase Auth user (one-to-one) |
| email | text | required, unique (any domain) |
| full_name | text | required |
| role | enum | `super_admin` · `admin` · `editor` · `viewer`; empty while pending |
| status | enum | `pending` · `approved` · `rejected` · `disabled` — default `pending` |
| approved_by / approved_at | uuid / timestamptz | set on approval |
| created_at, last_login_at | timestamptz | |

Rules:
- Only `approved` users can read or change anything (checked on every request, server-side).
- **There must always be at least one approved Super Admin** — the last one can't be demoted or disabled.
- Nobody can change their own role or permissions.
- Leavers are `disabled`, never deleted — their name stays on the history they created.

### `permissions` — the catalogue of things that can be allowed
`key` (primary key, e.g. `inventory.receive`) and `description`. Initial list:

| Area | Permission keys |
|------|-----------------|
| Inventory | `inventory.receive` · `inventory.prepare` (configure, SIM/IP) · `inventory.move` (repair, return, write-off) |
| Deployments | `deployments.create` · `deployments.complete` · `shipments.manage` |
| Facilities | `facilities.manage` · `facilities.change_stage` |
| Catalogue | `products.manage` · `suppliers.manage` · `partners.manage` |
| Reports | `reports.view` · `reports.export` · `audit.view` |
| Administration | `users.approve` · `users.manage` · `settings.manage` |

### Who gets what
| Role | Permissions |
|------|-------------|
| **Super Admin** | Everything, always. Only role that can grant/revoke Admin permissions and create Admins |
| **Admin** | Exactly the permissions a Super Admin ticked for that person (`user_permissions`) |
| **Editor** | Fixed set (`role_permissions`): all Inventory, Deployments and Facilities actions + `reports.view` |
| **Viewer** | Fixed set: read-only screens + `reports.view` |

### `role_permissions` (role, permission_key) and `user_permissions` (user_id, permission_key, granted_by, granted_at)
Composite primary keys — the same permission can't be granted twice. `user_permissions` is only
allowed for users whose role is `admin`.

### `audit_log` — insert-only
| Column | Type | Rules |
|--------|------|-------|
| id | bigint | primary key |
| occurred_at | timestamptz | required, default now |
| actor_id | uuid | → `users` (who) |
| action | text | e.g. `deployment.completed`, `user.approved`, `unit.updated` |
| entity_type / entity_id | text / bigint | what was changed |
| before / after | jsonb | the values before and after the change |

Written by **database triggers** on the important tables, so a change is audited even if
application code forgets. No updates or deletes allowed, for anyone.

## Confirmed (part 4)

- **P1** An Admin with `users.approve` can assign only Editor or Viewer; only a Super Admin creates Admins.
- **P2** Editors may do all operational work, including completing deployments and changing facility stages.

---

# Implementation

## Tooling (T1, agreed 2026-10-11)

- **Migrations:** plain SQL files in `supabase/migrations/`, named `<timestamp>_<what>.sql`, applied
  in order. Never edit a migration that has run on staging/production — add a new one.
- **Tests:** pgTAP SQL tests in `supabase/tests/`. Each test proves a rule is enforced
  (`throws_ok`) or that valid data is accepted (`lives_ok`).
- **Run locally:** `scripts/db-test.sh` builds a throwaway database from all migrations and runs
  every test. Needs PostgreSQL + pgTAP (`PGHOST`, `PGPORT`, `PGUSER` env vars).
- Supabase runs PostgreSQL 17; local tests currently use PostgreSQL 16. Nothing used so far differs
  between them; re-run the tests on Supabase staging when it exists (Stage 8 checklist).

## Migration log

| # | File | Contents | Tests |
|---|------|----------|-------|
| 0001 | `20261011000001_catalogue_and_receiving.sql` | enums, countries, users, categories, suppliers, products, batches, batch_lines, units, sim_details; RLS on all tables | 18 passing |
| 0002 | `20261011000002_places.sql` | clients, partners, repair companies, facilities (+ stage history, contacts), locations (auto-created per place), `units.location_id` | 12 passing |
| 0003 | `20261011000003_stock.sql` | stock_movements (insert-only ledger), stock_levels (balance ≥ 0), movement routes, unit status updates | 20 passing + concurrency test |
| 0004 | `20261011000004_deployments_shipments_sims.sql` | automatic codes (batches, DEP, SHP), deployments + items, shipments + items, SIM assignments, `complete_deployment`, `ship_shipment` | 21 passing |
| 0005 | `20261011000005_permissions_audit.sql` | permissions catalogue, role/user permissions, `has_permission`, user-change rules, audit log via triggers | 16 passing |
| 0006 | `20261011000006_auth_link.sql` | every Supabase Auth sign-up becomes a pending MRD user; one-time `bootstrap_first_super_admin` | 7 passing |
| 0007 | `20261012000007_sim_products.sql` | `products.is_sim`; SIM details only for SIM units; SIM assignment needs a free SIM (`in_office`) and a router that is `in_office`/`configured` | 8 passing (0004 test 6 now refused by the status rule) |
| 0008 | `20261012000008_retired_units.sql` | a retired unit can't be moved again (except a Super Admin `correction`); trigger named `0_…` so it runs before `stock_movements_apply` | 3 passing; renaming it to run second broke valid write-offs (order proven) |
| 0009 | `20261012000009_fix_shipment_cancel.sql` | **bug fix**: cancelling a shipment always failed (0004 compared a shipment status with `scheduled`) | 3 passing; fail without the fix |
| 0010 | `20261012000010_configure_at_partner.sql` | a router can get its SIM at a partner abroad (both in that partner's stock), as well as in MRD Office (A8) | 5 passing; removing the partner rule fails 2 backend tests |

Implementation notes (0001):
- A unit's product must match its batch line — enforced with a **composite foreign key**
  `(batch_line_id, product_id)`, no extra code needed.
- "No more units than received" and "no units for quantity products" — enforced by a trigger
  that locks the batch line, so two people adding units at once are counted correctly.
- `units.location_id` comes in migration 0002, together with the `locations` table.
- ICCID format check: 18–22 digits (confirmed by owner, A7).

Implementation notes (0002–0003):
- The application only **inserts movements**; a trigger applies them to balances and units in the
  same transaction.
- Allowed routes per movement type live in one function, `check_movement_route`.
- Bug found by the tests: subtracting stock with an "upsert" failed even when stock existed
  (PostgreSQL checks the would-be new row of −6 first). Fixed with a plain `UPDATE`.
- `scripts/db-concurrency-test.sh` runs two real connections deploying 6 of 10 cables at once:
  one succeeds, one is rejected, office = 4. With the `quantity >= 0` rule removed, the same test
  gives office = −2 and site = 12 — proof the rule is what protects the stock.
- Left for the backend (Stage 5): facility stage order + admin override; `correction` movements
  restricted to Super Admin.

Implementation notes (0004–0005):
- Completing a deployment or shipment is one function call = one transaction: every item moves,
  or none does (tested with a deployment that had too many cables — its router stayed in the office).
- A router's current SIM moves with it on deployment/shipment.
- The server must run `select set_config('app.user_id', '<uuid>', true)` at the start of each
  transaction; audit records and user-change rules depend on it.
- Stage 5 to-do: returning a router should also return its SIM (currently the SIM's movement must
  be recorded separately); permission checks for `correction` movements.
