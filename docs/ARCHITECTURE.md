# Architecture — DRAFT (awaiting owner approval)

_Status: proposed 2026-10-10. Nothing here is final until the owner approves it in
`PROJECT_STATUS.md`._

## 1. Confirmed requirements that shape the architecture

| Topic | Decision (owner, 2026-10-10) |
|-------|------------------------------|
| Users | ~15–20 people in total |
| Login | Any email address (`@moonrock.om`, Gmail, others). No Microsoft 365. Google sign-in is wanted. |
| Access approval | New sign-ups are **pending** until an admin approves them |
| Roles (v1) | **Super Admin** (all permissions) · **Admin** (only the permissions a Super Admin grants) · **Editor** (read + edit, no administration) · **Viewer** (read only) |
| Hosting | No company servers. Managed cloud. Development on free tiers; a small monthly fee is acceptable at launch |
| Offline | Not needed — technicians enter their work from the office |
| Teltonika RMS | Not needed. Teltonika routers are tracked like any other inventory |

## 2. Plain-language picture

```
  Staff browser (laptop / phone)
          │  HTTPS only
          ▼
  ┌──────────────────────────────┐
  │  Web app (Next.js)           │
  │   • Screens (from design/)   │  ← what people see
  │   • Server code              │  ← checks WHO you are, WHAT you may do,
  │                              │    and whether the action is valid
  └──────────────┬───────────────┘
                 │ private connection (secret key, never sent to browsers)
                 ▼
  ┌──────────────────────────────┐
  │  Supabase (managed service)  │
  │   • PostgreSQL database      │  ← the permanent record + last line of defence
  │   • Auth (Google + email)    │  ← proves identity, stores passwords safely
  │   • File storage             │  ← photos, PDFs, delivery notes
  └──────────────────────────────┘
```

**Rule of thumb:** the browser can be tampered with by anyone, so it only *shows* things. Every
decision that matters is made on the server, and the most important ones are enforced again by the
database itself.

## 3. Components and responsibilities

| Component | Responsible for | Never responsible for |
|-----------|-----------------|-----------------------|
| **Frontend** (React screens in Next.js) | Showing data, forms, instant input hints, hiding buttons a user can't use | Security or data integrity — it can be bypassed |
| **Backend** (Next.js server actions / API routes) | Checking login + approval status + permissions, validating input, business rules (stock, deployments, lifecycle), writing audit records, running multi-step changes as one transaction | Storing data long-term |
| **Database** (PostgreSQL) | Storing all records, relationships, and enforcing hard rules: unique serials/ICCIDs, no negative stock, no device deployed twice, history never deleted | Deciding who the user is |
| **Auth** (Supabase Auth) | Sign-up/sign-in with Google or email, password hashing, reset emails, sessions | Roles and approval — those live in our own `users` table |
| **File storage** (Supabase Storage, private bucket) | Photos and documents; served only via short-lived signed links after a permission check | Public access |

### What "rules" means here (examples from this project)

- A user whose account is still **pending** cannot see any data.
- Only someone with the "approve users" permission can approve a sign-up; only a **Super Admin** can
  grant permissions to an Admin.
- You cannot deploy more units than are in stock; stock can never go below zero.
- One router serial, one SIM ICCID, one IP address — never assigned twice at the same time.
- A device already deployed to Facility A cannot also be deployed to Facility B.
- Facility stages move in order (Site Inspection → … → Active Operations) unless an admin overrides.
- Every change writes an audit record; audit records cannot be edited or deleted.

If these lived only in the browser, anyone could skip them with the browser's developer tools.

## 4. Options considered

| | **A. Next.js + Supabase (recommended)** | B. Supabase only (browser talks to database directly) | C. Node + MongoDB Atlas |
|---|---|---|---|
| How it works | Screens + server code in one TypeScript project; Supabase provides Postgres, login, files | No server code; security written as database "row-level security" policies | Separate server; document database |
| Fit for inventory integrity | **Strong** — relational keys, constraints and transactions | Strong database, but every rule must be an SQL policy | **Weaker** — no foreign keys; relationships and many rules must be hand-coded |
| Learning curve | Medium: one language (TypeScript) + SQL basics | Looks easiest, but policies are subtle; one mistake exposes data | Medium, and you'd learn patterns less suited to this data |
| Security | Rules in readable, testable server code **plus** DB constraints (two layers) | One layer; easy to leak data by mistake | Depends entirely on our code |
| Cost (≈20 users) | Free during development (verify at Stage 8) | Same | Free tier available |
| Maintenance | One codebase + one managed service | Fewest parts, hardest to debug | Two services; no built-in login or file storage |

**Why not MongoDB, even though it's popular:** this data is a web of relationships (batch → units →
device → SIM → facility → deployment). PostgreSQL enforces those relationships and the "no negative
stock / no double deployment" rules automatically. MongoDB would leave them to our code, which is
exactly where beginners' bugs appear.

## 5. Login and approval flow

```
Sign up (Google or email+password)
        │
        ▼
users.status = PENDING ──► sees "Waiting for approval" page only
        │
Admin with "approve users" permission reviews
        │
   ┌────┴─────┐
APPROVED     REJECTED
(role set)   (no access)
```

Permissions are stored individually (e.g. `inventory.receive`, `deployments.create`,
`users.approve`, `settings.manage`) and grouped into roles. Super Admin implicitly has all; Admins
get a subset chosen by a Super Admin. This lets you add roles later (e.g. read-only Viewer) without
redesigning.

## 6. Environments

| Environment | Where | Data | Purpose |
|-------------|-------|------|---------|
| Development | Owner's computer / Claude session | Fake sample data | Building and experimenting |
| Staging | Supabase project #1 + preview deploy | Fake sample data | Testing before release |
| Production | Supabase project #2 + live site | Real MRD data | Staff use |

Supabase's free plan allows two projects per organisation, which covers staging + production.

## 7. Known risks of a $0 setup (to decide at Stage 8, recorded now)

- **Supabase free:** projects pause after ~1 week with no activity, and automated daily backups are
  a paid-plan feature (secondary sources; verify on the official pricing page). Real company data
  without backups is a risk — budget for the paid plan at launch, or run our own scheduled backup.
- **App hosting:** Vercel's free Hobby plan is for non-commercial use only, so it is not suitable
  for a company tool. Netlify's free plan reportedly allows commercial use; Render's free web
  services sleep after 15 minutes. Options to be verified on official pages at Stage 8.

## 8. Still open

- Is a single **User** level enough for v1, or do some users need read-only access? (The design's
  Users screen shows Admin / Operations / Technician / Viewer; it will be updated to match the
  agreed roles — a Stage 2 revision under rule 4.)
- Launch budget: strict $0 with risks above, or a small monthly amount for backups.
