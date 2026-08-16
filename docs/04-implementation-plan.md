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

### Phase 0 — Foundation — **done**
Project setup, Postgres, Prisma migration from the written schema, `jose` +
`bcryptjs` login (deviation D15 above — Auth.js was the original plan),
role guard middleware, the visibility helper (recursive CTE), app shell with
sidebar navigation, seed script for all master data in
[`02-funnels-and-metrics.md`](02-funnels-and-metrics.md) §3.

*Ends with:* you can log in as each of the five roles and see an empty shell.

### Phase 1 — Org & master data — **done**
Users, teams, departments, reporting hierarchy. Every master-data screen from
`/admin/master/*`, including the stage editor with common-stage mapping. Role
permission matrix. Audit log writer wired in at the ORM layer.

*Ends with:* your real org chart and your real stage lists are in the system.

Delivered: `/admin/users` (+ `/new`, `/[id]`), `/admin/teams`,
`/admin/permissions`, `/admin/master` and its eight lists, `/admin/settings`,
`/admin/audit`.

**Three decisions taken during the build**, each of which changed a table:

- **The audit writer sits in a Prisma client extension**, not in each server
  action — see [`src/lib/audit/`](../src/lib/audit/). Anything that writes
  through `prisma` is recorded with a per-field diff and no call site to
  remember, which is what makes the trail worth trusting in later phases. It
  needed `EntityType` extending with the seventeen master-data entities;
  without those names, editing a stage list would have been unrecorded.
  Bulk `updateMany`/`deleteMany` resolve their target ids first and log one row
  each, up to 200, then fall back to a summary row.
- **`Tag.isActive` added.** Every other master list deactivates rather than
  deletes (open question Q10), and a tag already applied to leads cannot be
  removed without rewriting history. Tag was the only list with no way to
  retire a row.
- **Pipeline stages enforce outcome/common-stage agreement.** A stage flagged
  `isWon` must map to the `WON` common stage and vice versa, and each vertical
  gets exactly one winning and one losing stage. Otherwise the conversion count
  and the cross-vertical pipeline chart can disagree with no visible cause —
  decision D5 only holds if the mapping and the flags say the same thing.

Two lockouts are blocked by construction: the last active administrator cannot
be demoted or deactivated, and `admin.master` / `admin.users` cannot be removed
from the ADMIN row of the permission matrix.

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

## 4. Open questions

**Nothing here blocks Phase 2 any more.** On 16 Aug 2026 the proposed default
was accepted for every open question, so Q1, Q2, Q3, Q9, Q10 and Q11 are
settled as tabled in [`00-decisions.md`](00-decisions.md) §3 and Phase 2 is
being built against them.

Still worth revisiting before the phase that depends on it:

| Re-check before | Question |
|---|---|
| Phase 3 | **Q1** — the counter-vs-lead cut-off per vertical ([`02` §2](02-funnels-and-metrics.md)). Decides what counts as a lead at all, and so every conversion % on the dashboard |
| Phase 5 | **Q11** — collected/pending revenue for the four non-invoicing verticals ([`02` §5](02-funnels-and-metrics.md)) |
| Phase 6 | Q5 — user and lead volumes, which decides live queries vs pre-aggregation |
| Phase 7 | Q4 — real integrations, or manual + CSV only? |
| Phase 7 | Q8 — existing data to migrate? |
| Phase 8 | Q6 — targets and quotas needed? |
| Deployment | Q7 — hosting target |

Also worth a look: the two permission rows flagged in
[`03-screens-and-roles.md`](03-screens-and-roles.md) §2 — whether a BDE may
change stage and mark a deal Won. Both are now single toggles in
`/admin/permissions`, so this is a decision you can make and reverse yourself
without a deployment.

### Carried into Phase 2 from the Phase 1 review

- **The audit writer does not participate in interactive transactions.** Its
  pre-image reads go through the base client and its rows are written
  immediately, so inside a `prisma.$transaction(...)` the pre-image cannot see
  uncommitted changes and a rollback leaves the audit rows behind. Nothing in
  Phase 1 uses an interactive transaction, so the limitation is latent — but
  Phase 2 issues lead codes and writes stage history transactionally, so this
  must be fixed first: buffer rows and flush on commit, or pass the transaction
  client through. See `src/lib/audit/extension.ts`.
- **Two check-then-write races are accepted for now**, both in guards rather
  than in data paths: the last-active-administrator check in
  `admin/users/actions.ts`, and the one-winning-stage-per-vertical check in
  `admin/master/stages/actions.ts`. Each reads, validates, then writes without
  a transaction, so two simultaneous administrators could defeat them. Fixing
  them properly means interactive transactions, which is blocked on the point
  above.
