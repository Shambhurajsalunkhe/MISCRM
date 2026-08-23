# Project Overview — Read This First

A plain-language walkthrough of what this CRM is, who uses it, how a lead moves
through it, and how the code is put together. Written for a developer joining the
project and for a stakeholder who wants to know what was built.

The deeper documents are listed in the [README](../README.md). This one is the
map that tells you which of them you need.

---

## 1. What the product is, in one paragraph

DigiMantra sells through **eight different acquisition channels** — Upwork,
LinkedIn, Email, Cold Calling, Staffing, Digital Marketing, Product Sales and
Other Sources. Each channel works differently: an Upwork deal starts with a
pitch, a staffing deal starts with a job requirement, a product deal starts with
a demo. Without a CRM that meant eight different spreadsheets and no way to
answer "how are we doing overall".

This application gives every channel **its own funnel and its own screens**,
while rolling all of them up into **one shared pipeline** so the management
dashboard can compare them side by side. Sales people work in the vocabulary of
their own channel; leadership reads one set of numbers.

A channel is called a **vertical** throughout the code and the UI.

| Vertical | Code | Lead codes look like |
|---|---|---|
| Upwork | `UP` | `UP-0001` |
| LinkedIn | `LI` | `LI-0001` |
| Email | `EM` | `EM-0001` |
| Cold Calling | `CC` | `CC-0001` |
| Staffing | `ST` | `ST-0001` |
| Digital Marketing | `DM` | `DM-0001` |
| Product Sales | `PR` | `PR-0001` |
| Other Sources | `OT` | `OT-0001` |

---

## 2. The three user roles

The role set is fixed — three values in the `UserRole` enum — but what each role
is *allowed* to do is stored in the database (`RolePermission`) and editable by an
administrator at `/admin/permissions`. So opening a capability up is a toggle, not
a deployment.

| Role | Who they are | What they mainly do |
|---|---|---|
| **BDE** | Business Development Executive | Generates leads. Logs daily outreach counters, creates leads, adds activities and documents, hands a lead over to a BDM |
| **BDM** | Business Development Manager | Closes leads. Everything a BDE does, plus moving stages, setting deal value, marking Won/Lost, quotations, contracts, invoices, payments, and all reports |
| **ADMIN** | Administrator | Everything, org-wide. Plus users, teams, master data, the permission matrix and the audit log |

The important line between BDE and BDM: **a BDE cannot change a stage or mark a
deal Won/Lost.** That is deliberate, and it is a single row in `RolePermission`
if the business wants it opened.

### Two separate ownership fields, permanently

Every lead carries **two** people, not one:

- `generatedById` — who *sourced* it (the BDE)
- `assignedToId` — who is *working* it now (usually a BDM)

These are two columns with two foreign keys and two indexes, and they must never
be merged. They are the entire reason the **BDE Lead Generation** report and the
**BDM Conversion** report can both be honest: one queries `generatedById`, the
other queries `assignedToId`. Reassigning a lead writes a
`LeadAssignmentHistory` row, so handing a lead to someone else never erases who
originally brought it in.

### Who can see which records

Role decides *what you may do*. A separate rule decides *which rows you see*
(`src/lib/visibility.ts`):

```
ADMIN  ->  every record in the company
BDM    ->  self + everyone below them in the reporting chain
           + anyone in a team they manage
BDE    ->  self only
```

A lead is visible to you if **you generated it or it is assigned to you** (or to
someone in your scope). Clients are slightly wider on purpose — you can see a
client if you own it *or* if you can see one of its leads, otherwise a BDE could
open lead `UP-0042` but not the company it belongs to.

Everything downstream of a lead — its demos, quotations, contracts, invoices,
payments — gets its scope **from the lead**, not from a separate owner field. An
invoice is not worked by anybody; it belongs to the deal that produced it. One
rule, one place for it to be wrong.

### The one extra fence: Staffing

Recruitment is one vertical's work, so the staffing module needs **two** ticks,
not one:

1. the role permission (`staffing.requirement.manage` / `staffing.candidate.manage`), **and**
2. the user actually works the Staffing vertical (`User.verticalId` → code `ST`)

Admin is exempt — it administers the module. The check is `hasStaffingAccess` in
`src/lib/authz.ts`, applied *inside* `can()`, which is why the sidebar, all the
staffing pages, their server actions, the lead's Requirements tab, global search
and the report exports all close together. None of them can be the one that
forgot.

Staffing *numbers* still appear in the dashboard KPIs and the company-wide
reports. The fence is around the module, not around the totals.

**A user's vertical also fences what they can create.** Someone in Upwork
creates Upwork leads and nothing else — a lead filed under the wrong vertical
takes its code prefix and its stage history with it and cannot be moved
afterwards, so the server refuses rather than silently substituting. It does
**not** fence what they can *see*: a lead handed to somebody from another
vertical stays visible and workable.

---

## 3. The lead flow — the heart of the system

### 3.1 The two-layer funnel

The single most important design decision (D1). Every vertical's funnel is split
at one line: **the point where a real Lead record is created.**

```
   ABOVE THE LINE                          BELOW THE LINE
   ProspectingActivity                     Lead + LeadStageHistory
   just daily counts per person            one record per real opportunity

   "Rahul — Upwork — 12 Aug —              UP-0001, with a client, a contact,
    Pitches Submitted — 40"                an owner, a stage and a value
              |
              +------ the "bridge" conversion % ------+
```

**Why:** a BDE sends 850 pitches a month. Creating 850 lead records — 845 of
which nobody ever replied to — would drown the pipeline in noise. So outreach
volume is logged as **counters**, and a Lead is created only **when the prospect
responds**.

The **bridge %** is `leads created in period ÷ counter total in period`. And
because `Lead.sourceActivityId` optionally points back at the counter batch the
lead came from, that percentage is auditable rather than merely statistical.

What sits above the line per vertical:

| Vertical | Counters logged daily | A Lead is created when… |
|---|---|---|
| Upwork | Pitches Submitted | the client replies to a pitch |
| LinkedIn | Prospects Identified, Outreach Sent | the prospect replies |
| Email | Emails Sent | the recipient replies |
| Cold Calling | Calls Made, Calls Connected | the prospect shows interest |
| Staffing | Client Outreach | the client responds |
| Digital Marketing | Campaigns Run, Service Inquiries | the inquiry is qualified |
| Product Sales | *(none)* | a product inquiry arrives |
| Other Sources | *(none)* | the referral / website inquiry arrives |

Product Sales has no counters because demos *outnumber* leads there — the inquiry
itself is the lead, and demos hang off it as repeatable children (D11).

Counters are stored one row per **person, per metric, per day**
(`@@unique([userId, verticalId, metricId, activityDate])`). That is what makes
the weekly grid an *upsert*: re-submitting a week corrects the numbers instead of
doubling them, and a double-clicked Save cannot invent 80 pitches out of 40.

### 3.2 One lead's journey, end to end

```
  1. BDE logs outreach          /prospecting      -> ProspectingActivity
             |
             |  prospect responds
             v
  2. BDE creates the lead       /leads/new        -> Lead  (code UP-0001)
       - client picked from the list or created inline
       - vertical is FIXED at creation and can never move
       - the form's sections render per vertical
             |
             v
  3. BDE hands it to a BDM      lead header       -> LeadAssignmentHistory
             |
             v
  4. BDM works it               /leads/[id]
       - Timeline tab: calls, emails, meetings, notes, follow-up dates
       - Documents tab: typed uploads
       - stage-advance control in the header
             |
             v
  5. Stage moves                the stage engine  -> LeadStageHistory
       Client Response -> Requirement Gathering -> Estimation Shared
                       -> Negotiation -> Won / Lost
             |
             v
  6. Won                        status = WON, closedAt stamped
             |
             v
  7. Money                      Quotation (PR) / Contract (DM)
                                -> Invoice -> Payment  (every vertical)
```

The lead detail screen has seven tabs — Overview, Timeline, Requirements
(Staffing), Demos / Quotations (Product Sales), Commercials, Documents and
History. The header carries the lead code, the client, the vertical badge, the
current stage, **Generated By and Assigned To side by side**, the deal value and
the stage-advance control.

### 3.3 The lead code

`UP-0001`. Prefix from the vertical, counter restarting each **calendar year per
vertical** (`LeadSequence`), zero-padding configurable in `/admin/settings`.

Two details that matter if you touch `src/lib/codes.ts`:

- The code is issued **inside the same transaction** that inserts the lead. A code
  issued outside it survives a rolled-back insert and shows up later as an
  unexplained gap in the sequence.
- Allocation is a single `UPDATE … RETURNING`, so two people creating a lead at
  the same instant serialise on a row lock instead of racing a
  `SELECT max(...) + 1`.

The prefix also carries the vertical, which is why the lead list has no Vertical
column — the code already says it.

### 3.4 The stage engine — understand this before changing anything

Every vertical has **its own stage list** (editable master data at
`/admin/master/stages`), and every one of those stages **maps to one shared
bucket** — the `CommonStage` enum:

```
NEW -> CONTACTED -> REQUIREMENT_GATHERING -> PROPOSAL -> NEGOTIATION -> WON / LOST
```

So an Upwork user picks "Estimation Shared", a LinkedIn user picks "Proposal
Shared", and the cross-vertical pipeline chart reads `PROPOSAL` for both. **The
user types one thing; the chart reads the other.** Nobody enters a status twice
(D5).

There is exactly **one entry point** for a stage change —
`src/lib/leads/stage.ts` — because five things must happen together or the
numbers stop agreeing with each other:

1. `Lead.currentStageId` moves.
2. `Lead.commonStage` is **rewritten from the new stage's mapping**. It is never
   editable by hand — that is the whole point of a derived bucket.
3. `Lead.status` follows the stage's `isWon` / `isLost` flags, so "how many did we
   win" never depends on someone remembering a second field.
4. A `LeadStageHistory` row is written.
5. An `Activity` row appears on the timeline, so the move shows up in the same
   list as the calls around it.

All five in one transaction. A stage change that moved the pointer but lost its
history row would silently under-count every funnel it appears in, and nothing
downstream would flag it.

**`LeadStageHistory`, not `currentStageId`, is the source of truth for every
conversion percentage** (D12). Conversion is measured on *ever reached*, not
*currently at* — a lead that passed through Negotiation on its way to Won has to
keep saying so.

Each stage also carries an **aging threshold** in days, which is what Pipeline
Aging and the idle-deal notifications read.

### 3.5 Where Staffing differs: the outcome is derived, never typed

A staffing lead is one client engagement holding **many requirements**
(`REQ-001`, `REQ-002`…), each with its own openings, candidates and status. So
"did we win the client" is not the same question as "did we fill the Java role".

The lead's outcome is therefore **computed** from its requirements (D8):

- **WON** once at least one requirement is `FILLED` or `PARTIALLY_FILLED`
- **LOST** when all of them are closed and at least one is `LOST`
- **OPEN** otherwise

Two things to know:

- The lead's *stage* moves too, not just its status — it goes through the same
  `applyLeadStage` code, so `commonStage`, `status` and `currentStageId` can never
  disagree. A lead whose status flipped to WON while its stage stayed at Active
  Account would appear as won in the KPI row and as open in the chart beside it.
- The lead still **counts once**. Two filled requirements is one won lead.
  Requirement-level outcomes are reported separately.

`CANCELLED` is deliberately **not** `LOST`. A requirement the client withdrew is
not a deal lost to a competitor, so a lead whose every requirement was cancelled
stays OPEN — nobody has said what happened to the account, and inventing an
answer is worse than leaving the question visible.

The staffing chain in full:

```
Client -> Lead -> many Requirements -> many Candidate submissions
                                     -> Interviews -> Placement (revenue)
```

Candidates are a **reusable master** (D9), not rows under a requirement — the same
person can be submitted to several clients.

### 3.6 After Won: records, not stages

Contracts, invoices and payments are **child records of a won lead**, not extra
pipeline stages (D10). The funnel ends at Won; the money starts there.

**Invoicing is enabled for every vertical.** The original position (D6) was
Digital Marketing, Product Sales and Staffing only, but that left five verticals
showing Won Revenue with no Collected or Pending behind it, so
`Collected + Pending` would never reconcile to `Won Revenue` on the dashboard.
Q11 settled this on 16 Aug 2026 and the seed now sets `usesInvoicing: true`
everywhere. It stays a per-vertical column, not a constant, so an administrator
turning it off for one vertical remains a supported act.

The two steps *before* the invoice are narrower:

| Step | Verticals |
|---|---|
| Quotation | Product Sales |
| Contract | Digital Marketing |
| Invoice → Payment | all eight |

All money is **USD** (D4).

The per-vertical extras are driven by module switches on `SalesVertical`
(`usesRequirements`, `usesCandidates`, `usesDemos`, `usesQuotations`,
`usesContracts`, `usesInvoicing`) — not by a hard-coded list of eight verticals.
Add a ninth vertical in master data and it gets a working form immediately.

---

## 4. Application architecture

### 4.1 Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15, App Router, React 19 — Server Components + Server Actions |
| Language | TypeScript, strict |
| Database | PostgreSQL 18 |
| ORM | Prisma 7 via `@prisma/adapter-pg` (driver adapter, not the schema URL) |
| Styling | Tailwind CSS 4 |
| Auth | `jose` (signed JWT in an httpOnly cookie) + `bcryptjs` |
| Validation | Zod, with `react-hook-form` on the client |
| Export | ExcelJS for `.xlsx`, `@react-pdf/renderer` for PDF |

**There is no separate API server and no REST or GraphQL layer.** Pages are Server
Components that query the database directly; mutations are Server Actions. The
only HTTP routes that exist are the two that genuinely need to be routes:
document download and the scheduled-job endpoint.

### 4.2 Directory map

```
prisma/
  schema.prisma      47 models — the executable spec
  seed.ts            master data: verticals, stages, metrics, permissions, admin user
  migrations/

src/
  middleware.ts      session gate: no cookie -> /login (preserving ?next=)
  env.ts             validated environment

  app/
    login/           the only public route
    (app)/           everything behind auth, sharing the sidebar shell
      page.tsx         role-aware dashboard
      leads/           list, new, detail (7 tabs), export, saved views
      clients/         accounts and contacts
      prospecting/     daily counter entry + summary
      requirements/    Staffing: requirements and candidate submissions
      candidates/      Staffing: candidate master
      placements/      Staffing: placement register
      quotations/      Product Sales
      contracts/       Digital Marketing
      invoices/        invoices + record payment
      reports/         11 reports, each with filters + Excel/PDF export
      admin/           users, teams, permissions, master data, audit log
      search/          global search
    api/
      documents/[id]   the only way an upload is served
      jobs/            scheduled sweeps (Bearer token, not cookie)

  lib/               all business logic — server-only, no React
    db.ts              the Prisma clients + auditedTransaction
    auth/              jwt, password, session
    authz.ts           can() / requirePermission() + the staffing fence
    visibility.ts      which rows this user may see
    permissions.ts     the permission catalogue and per-role defaults
    action.ts          withAudit() — the wrapper every mutation uses
    codes.ts           UP-0001 / CL-0001 / REQ-001 sequences
    leads/             stage engine, assignment, vertical form layout
    staffing/          requirements, submissions, placements, derived outcome
    commercials/       quotations, invoices, payments, revenue, overdue
    prospecting/       counter metrics and date handling
    reports/           report registry, aggregation, Excel and PDF export
    audit/             the Prisma extension that writes AuditLog

  components/        UI — ui/ primitives, charts, filters, activity, documents
  generated/         Prisma client output — NOT committed, run db:generate
```

### 4.3 The rule that keeps the codebase honest

Business logic lives in `src/lib/`, and **each rule has exactly one home**:

| Question | The one place it is answered |
|---|---|
| May this role do this? | `authz.ts` — `can()` |
| Which rows may they see? | `visibility.ts` |
| How does a stage change? | `leads/stage.ts` |
| What is this record's code? | `codes.ts` |
| Who changed what, and when? | `audit/extension.ts` |

A screen never re-implements one of these. This is why a new page cannot
accidentally be the one that leaks a row or skips the audit trail.

### 4.4 How a mutation actually runs

Every mutating Server Action is wrapped in `withAudit(permission, body)`
(`src/lib/action.ts`), which does three jobs that are each wrong to get wrong
individually:

```
  form submit
      |
      v
  withAudit(PERMISSIONS.LEAD_CREATE, ...)
      |
      +-- 1. requirePermission() -- THROWS before the body runs,
      |      so a forgotten `if` cannot leave the action open
      |
      +-- 2. establishes the audit actor (user id, IP, user agent)
      |      so no call site has to pass a user id around
      |
      +-- 3. body(user)
      |        Zod parse -> reject with field-level form errors
      |        vertical fence, ownership checks
      |        auditedTransaction(tx => { ...all related writes... })
      |
      +-- 4. converts thrown auth errors into a renderable ActionState
             instead of a 500 page, and logs the rest generically
             (a Prisma constraint message names tables and columns —
              that does not belong in a user-facing string)
```

`auditedTransaction` — never a bare `prisma.$transaction` — is used for anything
that writes more than one row. Audit rows are held until the transaction commits,
so a rollback leaves no trail of changes that never happened.

Auditing itself is a **Prisma client extension**: writes through the `prisma`
export are recorded in `AuditLog` automatically. Nobody has to remember. (There is
a second, unextended `prismaBase` client — it exists only so the audit
extension's own reads and writes are not themselves audited, and nothing else
should import it.)

### 4.5 Sessions

The JWT holds only **who** is asking. Role, vertical, team and active status are
read fresh from the database on every request (`getCurrentUser`, deduped to one
query per request with React `cache()`), so **deactivating a user or changing
their role takes effect on their next click** rather than whenever their token
happens to expire.

`middleware.ts` bounces an unauthenticated request to `/login`, keeping the query
string so returning from a filtered lead list doesn't lose your place. The
`/api/jobs/*` routes are exempt because a scheduler has no cookie jar — they
authenticate with `Authorization: Bearer <CRON_SECRET>` and answer **401 rather
than redirecting**, so a cron cannot record a `302 -> /login` as a successful run.

### 4.6 Documents

Uploads are written to `storage/uploads/` — **outside `public/`** and
git-ignored — and served only through `/api/documents/[id]`, after the same
visibility check the parent record itself gets. Point `src/lib/storage.ts` at S3
when you need to.

### 4.7 Master data: almost nothing is hard-coded

Verticals, their stages, the common-stage mapping, aging thresholds, prospecting
metrics, lead sources, products, countries, lost reasons, tags, the permission
matrix and app settings are **all rows in the database**, editable under
`/admin`. The seed (`prisma/seed.ts`) is idempotent and installs the eight
verticals with their funnels.

Two things that *are* fixed in code, and why: the three roles (`UserRole`) and the
seven common stages (`CommonStage`). Both are axes that every report is built on.

Deletes are **soft** — a lead or client is hidden, and the row plus all its
history survives.

---

## 5. Reporting

Reports read `LeadStageHistory` and the counter table, not the current-state
columns, so a lead that has since moved on still counts in the stage it passed
through.

| Report | Answers |
|---|---|
| Lead Source Performance | which channels produce leads that actually close |
| BDE Lead Generation | volume and quality by the person who *sourced* the lead |
| BDM Conversion | conversion and revenue by the person who *worked* it |
| Vertical Performance | all eight verticals side by side |
| Funnel | one vertical's stage-to-stage drop-off |
| Pipeline Aging | deals sitting past their stage's threshold |
| Won / Lost | outcomes with the lost-reason breakdown |
| Revenue | pipeline / won / collected / pending |
| Payment Status | what is outstanding and what is overdue |
| Staffing | requirements, openings, profiles, interviews, selections, placements |
| Product Demos | inquiries, demos, proposals, orders, revenue |

Every one has a filter bar, drill-through to the underlying leads, and Excel and
PDF export.

The dashboard is **role-aware**. Admin gets the org view — the KPI row, Leads by
Vertical, Conversion by Vertical, the Pipeline Overview and a global filter bar
every tile respects. A BDM or BDE sees only their own leads: their own KPIs, their
own pipeline and their own follow-ups, with no vertical breakdown at all.

---

## 6. Getting the project running

Needs Node 20+ and a reachable PostgreSQL server.

```bash
npm install
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL` (percent-encode reserved
characters in the password), `AUTH_SECRET` (32+ characters), and
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` for the first administrator account.

```bash
npm run db:generate
```

`db:generate` is **required after a fresh clone** — the Prisma client is generated
into `src/generated/` and is not committed.

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Before you push: `npm run typecheck` and `npm run lint`.

---

## 7. Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 | Auth, RBAC, visibility, app shell | Done |
| 1 | Org and master data | Done |
| 2 | Clients, leads, the stage engine, search | Done |
| 3 | Prospecting counters and the vertical funnels | Done |
| 4 | Staffing: requirements, candidates, submissions, placements | Done |
| 5 | Product Sales, Digital Marketing and money | Done |
| 6 | Dashboard, reports and analytics | Done |
| 7 | Notifications, imports, hardening, deployment | Partly — the staffing fence landed; the rest is open |
| 8 | Automation rules, targets and quotas, integrations | Not started, optional |

`docs/04-implementation-plan.md` carries the detail behind each row, including
what exactly is left in phase 7.

**Screens designed in `docs/03-screens-and-roles.md` but not yet built** — worth
knowing before promising one to a stakeholder: `/leads/board` (the Kanban view),
`/notifications`, `/profile`, `/admin/import`, `/admin/email-templates`, and
password recovery (`/forgot-password`, `/reset-password`). The `Notification`,
`NotificationRule`, `EmailTemplate` and `AutomationRule` tables already exist in
the schema, so the data model is ready for them.

---

## 8. Which document to read next

| If you are… | Read |
|---|---|
| about to touch the schema | [`01-data-model.md`](01-data-model.md) |
| about to touch a funnel, stage or metric | [`02-funnels-and-metrics.md`](02-funnels-and-metrics.md) |
| adding a screen or a permission | [`03-screens-and-roles.md`](03-screens-and-roles.md) |
| wondering *why* something is built this way | [`00-decisions.md`](00-decisions.md) |
| picking up the next piece of work | [`04-implementation-plan.md`](04-implementation-plan.md) |
| looking for the original business ask | [`Sales CRM – README.md`](../Sales%20CRM%20%E2%80%93%20README.md) |

`prisma/schema.prisma` is heavily commented and is the most reliable description
of the system. When a document and the schema disagree, the schema is right.
