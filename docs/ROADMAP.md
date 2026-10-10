# Master Development Roadmap — follow these 9 stages in order

Guide the complete software development lifecycle using the following nine stages. This roadmap is
the main structure for the project. The assistant is responsible for teaching, guiding the
decisions, and helping complete each stage properly.

| Stage | Area | Status |
| ----- | ---- | ------ |
| 1 | Requirements — what the application must do and who will use it | Complete (planning level) |
| 2 | UI/UX Design — screens, layouts, and navigation | Complete (design level) |
| 3 | Architecture — how the frontend, backend, database, and other services fit together | In progress |
| 4 | Database — how application data is structured, stored, related, and protected | Not started |
| 5 | Backend — business rules, APIs, permissions, and data processing | Not started |
| 6 | Frontend — connecting the designed screens to real application functionality | Not started |
| 7 | Testing — verifying functionality, security, and reliability | Not started |
| 8 | Hosting and Launch — deploying the application for organisation-wide access | Not started |
| 9 | Operations — backups, monitoring, updates, troubleshooting, and maintenance | Not started |

Live status lives in [`PROJECT_STATUS.md`](PROJECT_STATUS.md). The requirements and UI/UX design
stages are complete at the planning/design level; the existing design and source files must still
be inspected to establish what has actually been implemented.

## Stage 1 — Requirements

Use the existing project brief as the initial requirements document.

Identify important unanswered questions, business rules, user roles, workflows, and edge cases that
could affect the architecture or database.

Do not repeat requirements that are already clear. Ask focused questions only when the answers
materially affect implementation.

## Stage 2 — UI/UX Design

Use the existing Claude Design output as the approved design reference.

Inspect the actual files to determine whether there is a static design, a clickable prototype, or a
functioning frontend.

Preserve the existing design and visual quality. Make changes only when required by functionality,
usability, accessibility, or technical limitations.

## Stage 3 — Architecture

Before building the database or backend, explain the overall application architecture in plain
language and then at a professional technical level. Cover:

- The frontend and its responsibilities.
- The backend and its responsibilities.
- The database and its responsibilities.
- APIs and communication between components.
- Authentication and authorisation.
- File and image storage.
- Hosting and deployment.
- Development, testing, staging, and production environments.
- Security boundaries and data flow.

Inspect the existing code before choosing technologies. Recommend an appropriate architecture for an
internal multi-user enterprise inventory application. Explain the advantages, disadvantages, costs,
maintenance burden, and security implications of the realistic options. Use diagrams or simple
flowcharts when useful.

Do not select technologies just because they are popular. Prefer a maintainable solution that fits
the existing project and that the owner can realistically learn and operate.

**Completion gate:** an agreed architecture, a documented technology stack, a clear component
diagram, and an explanation of how the components interact before moving to detailed database
implementation.

## Stage 4 — Database

Design and implement the database based on the agreed architecture and confirmed business
requirements.

Teach DBMS concepts along the way: relational modelling, primary and foreign keys, normalisation,
constraints, indexing, transactions, migrations, backups, and query optimisation.

Design the relationships for batches, products, individual devices, SIM cards, stock locations,
inventory movements, facilities, deployments, project stages, users, and audit records.

Pay particular attention to inventory integrity: no accidental duplicate deployments, no negative
stock, and no loss of historical movements.

Explain the schema before implementing it. Use version-controlled migrations and test the important
constraints.

**Completion gate:** an approved schema, implemented migrations, reliable database access,
documented relationships, and tests for critical data-integrity rules.

## Stage 5 — Backend

Implement the server-side functionality: business logic, APIs, authentication, permissions,
validation, inventory transactions, facility management, deployment workflows, and audit history.

Explain the purpose of each major component and how it interacts with the database.

Do not trust the frontend to enforce security or data integrity. Validate and authorise sensitive
operations on the server.

**Completion gate:** the core backend operations work against the real database, enforce the
appropriate permissions, and pass their relevant tests before the frontend depends on them.

## Stage 6 — Frontend

Connect the existing designed screens to the real backend, screen by screen, starting with
authentication and the core inventory workflow.

Forms, buttons, search, filters, navigation, status changes, and administrative actions must perform
real operations rather than merely appearing functional. Preserve the existing design wherever
practical. Implement loading states, validation, error handling, empty states, and permission-aware
interfaces.

**Completion gate:** the important user workflows work from the interface through the backend to the
database, with the resulting changes persisted and verified.

## Stage 7 — Testing

Test the application before real organisational use. Teach the difference between unit,
integration, and end-to-end testing. Test:

- Login and access permissions.
- Inventory receiving and batch quantities.
- Device configuration and SIM assignments.
- Stock movements and deployments.
- Facility and project management.
- Audit history.
- Invalid inputs and failure scenarios.
- Duplicate operations and concurrent inventory changes.
- Security-sensitive endpoints.
- Database recovery procedures.

Maintain a record of tests performed, results, failures, and fixes.

**Completion gate:** critical business workflows pass defined acceptance tests. Security issues and
data-integrity defects are addressed before launch.

## Stage 8 — Hosting and Launch

Deploy to suitable production infrastructure. Explain and implement hosting, database access,
domain setup, HTTPS, secrets, file storage, production migrations, initial administrator creation,
logging, backups, and rollback procedures.

Verify current hosting options, pricing, and documentation when this stage is reached.

The application must work when the owner's computer is switched off. Authorised employees must be
able to access it through a secure URL from their own devices.

Do not launch with demo credentials, public access to protected business data, or untested
deployment procedures.

**Completion gate:** the production application is accessible to authorised users, uses the
production database, enforces access controls, and has verified backup and recovery procedures.

## Stage 9 — Operations

Teach how to maintain the live application after launch: employee onboarding and offboarding, user
roles and permissions, database backups and restoration, application and database updates, database
migrations, error logs and monitoring, security updates, hosting costs and usage, troubleshooting,
deployment rollback, incident response, documentation and handover.

Create a practical maintenance checklist and an administrator's guide for MRD.

**Completion gate:** the owner understands the routine operational responsibilities, knows how to
diagnose common problems, and has a documented recovery process.

## Rules for moving between stages

1. Follow the nine stages in order. Do not skip architecture and database planning to start writing
   large amounts of code.
2. Do not assume a stage is complete because a document has been written or code has been generated.
3. Define measurable completion criteria for each stage and verify them against the actual project.
4. If a problem discovered in a later stage requires revisiting an earlier stage, explain why and
   update the relevant documentation.
5. Keep a persistent project status record (`docs/PROJECT_STATUS.md`) showing the current stage,
   completed work, outstanding decisions, test results, and next action.
6. At the end of each stage, summarise what was learned and what was accomplished.
7. Explain trade-offs and obtain the owner's agreement before major architectural, database,
   security, or hosting decisions.
8. Do not overwhelm with all nine stages at once. Guide through the next relevant task, explain it
   clearly, and let the owner complete and understand it before proceeding.

**Objective:** finish all nine stages with a reliable production application while the owner
develops the knowledge to understand, maintain, and extend it themselves.
