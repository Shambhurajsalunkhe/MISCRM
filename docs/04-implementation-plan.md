# Implementation Plan

---

## 1. Stack (decision D2)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript | One codebase for UI and API; server components keep the dashboard queries on the server |
| Database | PostgreSQL 16 | Relational integrity matters here — the staffing hierarchy and revenue roll-ups are not document-shaped |
| ORM | Prisma **7** + `@prisma/adapter-pg` | Typed queries and migrations. See deviation D14 below |
| UI | Tailwind CSS v4 + shadcn/ui | Fast, accessible, consistent tables and forms |
| Charts | Recharts | Donut, bars and funnels for the dashboard |
| Auth | `jose` (JWT) + `bcryptjs`, httpOnly cookie | See deviation D15 below |
| Validation | Zod, shared client and server | One schema per form, no drift |
| Server logic | Next.js server actions + route handlers | Type-safe end to end |
| Background jobs | node-cron in-process (v1) | Overdue invoice sweep, follow-up reminders, aging alerts |
| Files | S3-compatible storage, local-disk adapter | Pending open question Q9 |
| Exports | ExcelJS, React PDF | Every report exportable |
| Testing | Vitest (unit), Playwright (E2E on the critical flows) | Stage transitions and revenue maths need real tests |

### Deviations from the approved plan

**D14 — Prisma 7, not 6.** npm resolved Prisma to 7.9.1. Prisma 7 removed `url`
from the datasource block and requires a driver adapter. Rather than pin to an
older major on a greenfield project, the schema now uses the `prisma-client`
generator with `prisma.config.ts` holding the connection URL, and the client is
constructed with `@prisma/adapter-pg`. Validated: all 40 models parse.

**D15 — `jose` + `bcryptjs` instead of Auth.js.** Auth.js v5, the version that
works with the App Router, is still beta. Since this app needs credentials
login only — no OAuth providers — a signed httpOnly JWT cookie is about 150
lines, has no beta dependency, and makes the role/permission plumbing explicit.
Sessions carry only the user id; role and active status are re-read from the
database on every request, so deactivating a user takes effect immediately
rather than whenever their token expires. **Tell me if you'd rather have
Auth.js** — it is a contained swap at this stage, and gets harder later.

---

## 2. Phases

Each phase ends in something you can log into and use. Nothing is "integration
work at the end".

### Phase 0 — Foundation
Project setup, Postgres, Prisma migration from the written schema, Auth.js login,
role guard middleware, the visibility helper (recursive CTE), app shell with
sidebar navigation, seed script for all master data in
[`02-funnels-and-metrics.md`](02-funnels-and-metrics.md) §3.

*Ends with:* you can log in as each of the five roles and see an empty shell.

### Phase 1 — Org & master data
Users, teams, departments, reporting hierarchy. Every master-data screen from
`/admin/master/*`, including the stage editor with common-stage mapping. Role
permission matrix. Audit log writer wired in at the ORM layer.

*Ends with:* your real org chart and your real stage lists are in the system.

### Phase 2 — Clients & Leads core
Client and contact CRUD with de-duplication. The lead creation form rendering by
vertical. Lead list with filters, saved views and export. Lead detail with
Overview / Timeline / Documents / History tabs. The stage engine — transitions
writing `LeadStageHistory`, updating `commonStage` and `status`, enforcing
`isWon`/`isLost`. Assignment and reassignment with history. Global search.

*Ends with:* the whole common pipeline works end to end for every vertical.
This is the phase that de-risks the project.

### Phase 3 — Prospecting counters & the outbound verticals
Daily counter entry and the weekly grid. Counter summary screen. Vertical funnel
views for Upwork, LinkedIn, Email, Cold Calling and Other Sources, with the
bridge conversion %.

*Ends with:* five of the eight verticals are fully live.

### Phase 4 — Staffing
Requirements under a lead with `REQ-001` codes and their own stage list.
Candidate master with resume upload and skill search. Submission board per
requirement. Interview rounds. Placements and the derived lead outcome. Staffing
metrics and report.

*Ends with:* the hardest vertical is done — one client, many requirements, many
candidates, part-won leads.

### Phase 5 — Product Sales, Digital Marketing & money
Demos and quotations with line items. Contracts. Invoices, payments, the four
payment statuses, and the overdue sweep. Won / Collected / Pending revenue
computed everywhere it appears.

*Ends with:* all eight verticals live and revenue is real.

### Phase 6 — Dashboard, reports & analytics
The Sales Head dashboard exactly as your flowchart draws it. All eleven reports.
Full drill-down chain with filter state in the URL. Excel and PDF export.

*Ends with:* the Sales Head stops using spreadsheets — README §40's success test.

### Phase 7 — Notifications, imports & hardening
Notification centre and rules, email delivery, follow-up and aging jobs.
CSV/Excel import for clients, leads and candidates. Performance pass on the
dashboard queries. Backup and restore procedure. Deployment.

### Phase 8 — Optional, on your word
Automation rules engine, targets and quotas (open question Q6), external
integrations (Q4), mobile-responsive refinements.

---

## 3. Order of dependencies

```
Phase 0 ──> Phase 1 ──> Phase 2 ──┬──> Phase 3 ──┐
                                  ├──> Phase 4 ──┼──> Phase 6 ──> Phase 7
                                  └──> Phase 5 ──┘
```

Phases 3, 4 and 5 are independent of each other once Phase 2 lands. Phase 6 needs
all three, because the dashboard aggregates across every vertical.

---

## 4. What I need from you before Phase 2

The schema is stable enough to start Phases 0 and 1 immediately. Before Phase 2 I
need answers to these, from [`00-decisions.md`](00-decisions.md) §3:

| Blocking | Question |
|---|---|
| **Yes** | **Q1** — confirm the counter-vs-lead cut-off per vertical ([`02` §2](02-funnels-and-metrics.md)) |
| **Yes** | **Q11** — collected/pending revenue for the four non-invoicing verticals ([`02` §5](02-funnels-and-metrics.md)) |
| Yes | Q2 — backward stage movement allowed? |
| Yes | Q3 — Sales Head reassignment between BDMs? |
| Before Phase 7 | Q4 — real integrations, or manual + CSV only? |
| Before Phase 6 | Q5 — user and lead volumes |
| Before Phase 8 | Q6 — targets and quotas needed? |
| Before Phase 0 | Q7 — hosting target |
| Before Phase 7 | Q8 — existing data to migrate? |
| Before Phase 2 | Q9 — S3 or local disk for attachments |
| Before Phase 2 | Q10 — soft delete recoverable by Admin? |

Also worth a look: the two permission rows I flagged in
[`03-screens-and-roles.md`](03-screens-and-roles.md) §2 — whether a BDE may
change stage and mark a deal Won.
