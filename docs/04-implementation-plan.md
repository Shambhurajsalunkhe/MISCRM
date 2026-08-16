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

### Phase 2 — Clients & Leads core — **done**
Client and contact CRUD with de-duplication. The lead creation form rendering by
vertical. Lead list with filters, saved views and export. Lead detail with
Overview / Timeline / Documents / History tabs. The stage engine — transitions
writing `LeadStageHistory`, updating `commonStage` and `status`, enforcing
`isWon`/`isLost`. Assignment and reassignment with history. Global search.

*Ends with:* the whole common pipeline works end to end for every vertical.
This is the phase that de-risks the project.

Delivered: `/clients` (+ `/new`, `/[id]`, `/[id]/edit`), `/leads` (+ `/new`,
`/[id]` with its four tabs, `/[id]/edit`, `/export`), `/search`, and
`/api/documents/[id]` for authorised downloads.

**The Phase 1 carry-over is fixed first.** `auditedTransaction` in
[`src/lib/db.ts`](../src/lib/db.ts) buffers audit rows and flushes them only
after the transaction commits, and routes the writer's pre-image reads through
the transaction client. Both halves of the problem the Phase 1 review flagged
are gone: a rolled-back stage change now leaves no trail, and a row changed
twice in one transaction is diffed against what the transaction actually did to
it. Everything multi-row in this phase — issuing a lead code, recording a
transition, handing a lead over — goes through it.

**Four decisions taken during the build:**

- **`NumberSequence` added**, a generic `key -> lastNumber` counter, because
  clients need `CL-0001` codes and `LeadSequence` is keyed on
  `(verticalId, year)`. Folding client codes into it would have meant a nullable
  year meaning two different things. Phase 4's `REQ-` and Phase 5's `INV-` codes
  have a table waiting for them.
- **De-duplication is one hard rule and several soft ones.** `Client.dedupeKey`
  (normalised company name + email domain) stays a unique constraint with no
  switch — two rows for one account break every per-client roll-up. Matching
  contact email, phone, website and LinkedIn only *warn*, and the user saves past
  them with a reason that is written to the audit trail, which is what
  [`01-data-model.md`](01-data-model.md) §1 asks for. The key is recomputed
  whenever the company is renamed or its primary contact changes, so it keeps
  catching what it exists to catch.
- **The lead form's vertical sections come from the module switches**, not from
  a map of the eight verticals — see
  [`src/lib/leads/vertical-form.ts`](../src/lib/leads/vertical-form.ts). A ninth
  vertical added in Master Data gets a working form immediately. Only the label
  on the single free-text URL field is keyed by vertical code, because there is
  no flag behind "this one is an Upwork job URL".
- **Documents are served by a route handler, never from `public/`.** A
  `storageKey` is not a capability: `/api/documents/[id]` re-checks that the
  reader can see the parent lead, and answers 404 rather than 403 so the
  existence of a lead outside their scope is not confirmed. Storage itself is
  local disk behind an interface an S3 adapter drops into — the Q9 emphasis
  recorded in [`00-decisions.md`](00-decisions.md) §3.

**The two check-then-write races carried from Phase 1 are now fixable.** They
were blocked on interactive transactions, which now exist —
`admin/users/actions.ts` and `admin/master/stages/actions.ts` can each be moved
inside `auditedTransaction`. Neither is on a data path and both are guards
rather than corruption risks, so they are listed here rather than done in this
phase.

### Phase 3 — Prospecting counters & the outbound verticals — **done**
Daily counter entry and the weekly grid. Counter summary screen. Vertical funnel
views for Upwork, LinkedIn, Email, Cold Calling and Other Sources, with the
bridge conversion %.

*Ends with:* five of the eight verticals are fully live.

Delivered: `/prospecting` (the weekly grid), `/prospecting/summary`,
`/reports/funnel`, and a `/reports` index so the sidebar link that has pointed
there since Phase 0 resolves. The funnel is built for *every* vertical, not the
five named above — it reads each one's own metrics and stages, so Staffing and
Digital Marketing already have theirs, and Product Sales and Other Sources draw
correctly with the above-the-line half empty.

**Q1 was answered by accepting the table in [`02` §2](02-funnels-and-metrics.md),
which the seed already encodes.** Nothing in this phase hard-codes it: the
cut-off is the `VerticalMetric.isLeadTrigger` flag, editable in Master Data, and
the bridge % divides by whichever metric carries it. Changing where the line
falls for a vertical is now a checkbox rather than a deployment — which is the
right place for a question the plan flagged as most likely to need revisiting.

**Four decisions taken during the build:**

- **One counter row per person, per metric, per day**, enforced by a unique
  index. It is what makes the weekly grid an upsert: re-submitting a week
  corrects Tuesday rather than adding a second Tuesday, and a double-clicked
  Save cannot invent forty pitches. A cleared or zeroed cell deletes its row —
  "no pitches on Wednesday" and "nobody has said what happened on Wednesday" sum
  to the same thing in every query here, and keeping the row would only lengthen
  the audit trail. The cost is that the itemised use of `referenceUrl` the schema
  comment imagines — one row per individual pitch — no longer fits; it would need
  the index narrowed to a partial one. Nothing needs it yet.
- **Counter dates are UTC, lead dates are local.** `activityDate` is a
  `@db.Date`: a calendar day with no zone. Built from local midnight it lands on
  the previous day everywhere east of UTC, so
  [`src/lib/prospecting/dates.ts`](../src/lib/prospecting/dates.ts) works in UTC
  throughout. `Lead.createdAt` is a real instant and stays local, because
  "created on the 16th" means the 16th where the user is. Every query that spans
  both — and the bridge % is exactly that query — expresses the same range twice.
  The rule is written at the top of that module; it is the kind of thing that is
  invisible from IST and wrong in New York.
- **The funnel is assembled from master data, never from a list of verticals.**
  `buildFunnel` walks the vertical's own metrics and stages and reads each
  conversion as "this step ÷ the step above", which reproduces every table in
  [`02` §4](02-funnels-and-metrics.md) without naming any of them. A renamed
  stage renames itself here; a ninth vertical gets a funnel with no code change.
  The losing stage is deliberately outside the chain — a lead does not pass
  *through* Lost on the way to Won, and including it would make the
  Negotiation → Won conversion divide by the wrong number. It is reported beside
  the funnel instead.
- **Logging on someone else's behalf reuses the D7 data scope**, not a new
  permission. The matrix has one prospecting row, held by everyone, and says
  nothing about whose counters you may enter — so a BDE gets themselves, a
  BDM/Manager their reporting sub-tree, and Sales Head/Admin anyone. A manager
  catching up a week for someone who was travelling is normal; a BDE editing a
  colleague's pitch count is not, and BDE Performance (README §27) is read off
  precisely these numbers.

**`Lead.sourceActivityId` is now wired**, which is what decision D1 means by the
bridge being *auditable rather than purely statistical*. The lead form offers the
recent counter batches for its vertical, the choice is re-validated against the
creator's scope on save, and the lead's Overview names the day's work it answered.
It stays optional — a lead nobody can trace back to a specific Tuesday is still a
lead.

### Phase 4 — Staffing — **done**
Requirements under a lead with `REQ-001` codes and their own stage list.
Candidate master with resume upload and skill search. Submission board per
requirement. Interview rounds. Placements and the derived lead outcome. Staffing
metrics and report.

*Ends with:* the hardest vertical is done — one client, many requirements, many
candidates, part-won leads.

Delivered: `/requirements` (+ `/new`, `/[id]` with its four tabs, `/[id]/edit`,
`/[id]/submissions/[submissionId]`), `/candidates` (+ `/new`, `/[id]`,
`/[id]/edit`), `/placements`, `/reports/staffing`, a Requirements tab on the
lead, a requirements section on the client page, and requirements and candidates
in global search.

**The three levels each got the stage engine the level above already had.**
`changeRequirementStage` and `changeSubmissionStage` are
[`src/lib/leads/stage.ts`](../src/lib/leads/stage.ts) applied one and two levels
down: pointer, status, history row, timeline entry and audit line in one
transaction, because the staffing report reads the history table and not the
pointer (decision D12). The lead engine's write half was extracted as
`applyLeadStage` so the derived outcome below goes through the same code rather
than a second implementation that would drift.

**Six decisions taken during the build:**

- **Requirement codes run on one company-wide counter.** README §14 draws them
  as `REQ-001, REQ-002, REQ-003` under a single lead, which reads as per-lead
  numbering — but a requirement is linked to, searched for and discussed on its
  own, and two leads each holding a `REQ-001` is a code that identifies nothing.
  The three-under-one-lead reading survives in the lead's Requirements tab,
  which is where the grouping actually belongs. `NumberSequence`, waiting since
  Phase 2, needed no change.
- **The candidate master is the one list in the application with no data
  scope.** Decision D9 exists so that the same person submitted to three clients
  stays one candidate; a master where a recruiter cannot see the profile a
  colleague sourced produces exactly the duplicate rows it was built to prevent,
  and `Candidates Sourced` then counts one person three times. What a candidate
  row does *not* carry is any client's information — that lives on the
  submission, which is scoped through its requirement like everything else. The
  candidate page's submission table is scoped accordingly and says how many rows
  it is not showing.
- **A requirement cannot be moved to its winning stage by hand.** Decision D8
  makes `Placement` the revenue unit, so a requirement marked Placement with no
  placement behind it would count in Requirements Filled while contributing
  nothing to Won Revenue. Marking the submission Joined on the board is the only
  route: it creates the placement, increments `positionsFilled`, moves the
  requirement to its winning stage — `FILLED` or `PARTIALLY_FILLED` depending on
  whether that was the last opening — and re-derives the lead. The stage
  dropdown omits the entry and says where to go instead.
- **`CANCELLED` is not `LOST`.** A requirement the client withdrew is not a deal
  lost to a competitor, and folding them together would put withdrawals into the
  lost-reason breakdown with no reason attached. So `deriveLeadStatus` treats
  them differently, and a lead whose every requirement was cancelled stays OPEN
  — nobody has said what happened to the account, and inventing an answer is
  worse than leaving the question visible.
- **Reversing a placement is refused, with the reason on screen.** A candidate
  who withdraws after joining is a real event, but it changes booked revenue and
  Phase 5 will have invoiced against the row. Deleting a `Placement` from a
  stage dropdown would move a dashboard number with nothing to explain it.
- **Stage codes appear in the staffing report and nowhere else.** A deliberate
  exception to the rule the funnel builder follows:
  [`02` §4.7](02-funnels-and-metrics.md) defines its metrics *by* code, so a
  report reproducing that table has to name them. Everything reads through
  `byCode`, which returns zero for a code an administrator removed rather than
  throwing, so a renamed stage list degrades to a blank row instead of a broken
  screen. The two funnels beside those numbers are assembled from master data in
  the usual way and name nothing.

**Two schema gaps closed**, both pre-existing rather than new:

- **`Candidate.phoneNormalised`**, the same fix `ClientContact` got in Phase 2.
  Duplicate detection and the candidate search normalise a typed number to
  digits while `phone` keeps what the user typed, so the index on `phone` served
  a lookup that could never match. Backfilled in SQL with the rule
  `normalisePhone` applies on write.
- **`RequirementStageHistory.changedBy` and `CandidateStageHistory.changedBy`.**
  Both carried `changedById` from the initial schema with no relation behind it,
  so neither history tab could name who moved a stage — the one question a
  transition log exists to answer. `LeadStageHistory` has had the foreign key
  since the start; the migration is an `ADD CONSTRAINT` with no backfill.

`AttachmentTarget` grew the three parents its Phase 2 comment promised, and the
activity and upload forms now take a `{ kind, id }` parent instead of a widening
list of optional props. Requirements, candidates and submissions got timelines,
documents and authorised downloads with no change to either server action beyond
the parent lookup.

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
settled as tabled in [`00-decisions.md`](00-decisions.md) §3, and Phase 2 was
built against them. Three are now visible in the running application rather than
only on paper, which makes them cheaper to look at again: **Q2** is the reason
field the stage control demands on a backward move, **Q3** is the reassignment
control in the lead header, and **Q10** is why deleting a lead or a client hides
it rather than removing it.

Still worth revisiting before the phase that depends on it:

| Re-check before | Question |
|---|---|
| ~~Phase 3~~ — **settled** | ~~**Q1** — the counter-vs-lead cut-off per vertical~~. Built as tabled, and now a per-metric checkbox in Master Data rather than a code decision — see Phase 3 above |
| ~~Phase 5~~ — **settled** | ~~**Q11** — collected/pending revenue for the non-invoicing verticals~~. Answered 16 Aug 2026: **invoicing is enabled for every vertical**, so `Collected + Pending` reconciles to `Won Revenue` everywhere and no report carries a "covers three verticals" asterisk. It is a seed change plus a master-data flag, not a schema change — see [`02` §5](02-funnels-and-metrics.md). Note the count was five verticals, not the four this table used to say |
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

### Still open from the Phase 2 build

Everything here survived Phase 3 untouched except the phone scan, which the
Phase 2 review fixed before this phase started.

- **Neither list paginates.** `/leads` and `/clients` each show the first 100
  rows and say so in the footer; the filters are how a list is narrowed. That
  holds at the volumes assumed in Q5 and stops being true if it turns out to be
  wrong — revisit alongside Q5 before Phase 6, which is where the same query
  shapes get reused under the dashboard.
- **The lead form's client picker caps at 500.** Past that, the route in is the
  client page's own "New lead" button, and the form says so. A typeahead is the
  real answer, and is worth building once there is a second screen that needs
  one.
- ~~**The phone-match duplicate warning is a suffix `contains` scan.**~~ Closed:
  `ClientContact.phoneNormalised` is a stored, indexed column now.
- **Exports are CSV.** README §29 asks for Excel and PDF as well; those arrive
  with the reports in Phase 6, where there is enough formatting to justify
  ExcelJS and React PDF.
- **The two check-then-write races from Phase 1 are still open**, both guards
  rather than data paths: the last-active-administrator check in
  `admin/users/actions.ts` and the one-winning-stage-per-vertical check in
  `admin/master/stages/actions.ts`. They were blocked on interactive
  transactions, which Phase 2 built — each is now a matter of moving the body
  into `auditedTransaction`.

### Carried into Phase 4 from the Phase 3 build

- **`reached()` fetches distinct `(stage, lead)` pairs and counts them in
  memory.** Correct, and indexed on the transition date, but it is a read of
  every history row in the period rather than an aggregate. Fine at the volumes
  Q5 assumes and the obvious thing to convert to a `GROUP BY` when the dashboard
  reuses this query shape in Phase 6 — which is also when the funnel numbers
  start being computed for eight verticals at once instead of one.
- **Leads are bucketed by day in JavaScript** on the counter summary, for the
  reason in the code comment: the day a timestamp belongs to is the day where
  the reader is, which Postgres cannot know without being told the zone. If it
  ever needs to be SQL, the zone has to become an explicit input rather than an
  assumption.
- **Weeks start on Monday, with no setting behind it.** `startOfWeek` is the one
  function that knows; a team that wants Sunday-first needs a setting and that
  one edit.
- **The funnel has no export.** Same answer as the lead list: Excel and PDF
  arrive with the reports in Phase 6.
- ~~**`/reports` lists ten reports and links one.**~~ It links two now. Still a
  hard-coded list, and each new report has to be added to it as well as routed.

### Carried into later phases from the Phase 4 build

- **`subReached()` has the same shape as `reached()`, and the same caveat.** It
  fetches distinct `(stage, submission)` pairs and counts them in memory —
  correct, indexed on the transition date, and a read of every history row in
  the period rather than an aggregate. Phase 6 is where all three levels get
  converted to `GROUP BY` together, because that is when they start being
  computed for eight verticals at once.
- **Reversing a placement is Phase 5's to define.** The refusal above is the
  right answer today; it stops being one once there are invoices to credit.
  Whatever Phase 5 builds should be a reversal that writes its own record, not a
  delete.
- **`Requirement` has no assignment-history table**, so a handover shows in the
  audit trail as a field change rather than in a table of its own — which is why
  the requirement's History tab has two sections where the lead's has three. A
  requirement changes hands far less often than a lead, and the audit row is
  enough until somebody asks for the report.
- **Submission stage moves land on the requirement's timeline**, because
  `Activity` has no submission column. That is the right place to read them, but
  it means a busy requirement's timeline mixes per-candidate moves with
  account-level notes and there is no filter to pull them apart.
- **Neither new list paginates**, matching `/leads` and `/clients`: 100
  requirements, 100 candidates, and a footer that says so. Same answer as
  before — revisit alongside Q5 before Phase 6.
- **The candidate skill search is a `contains` scan on a free-text column.**
  Multiple terms are ANDed, which is what the field's placeholder promises, but
  each is an unindexed substring match. A trigram index or a proper skills table
  is the real answer, and is worth building when the master is big enough for
  the scan to be felt rather than in advance of it.
- **The staffing report has no export**, same as the funnel. Excel and PDF
  arrive with the reports in Phase 6.
- **The requirement list's ageing filter asks a coarser question than the
  detail page.** Per-stage `agingThresholdDays` is master data, so "past its own
  threshold" is not one number the list can filter on in SQL; the filter offers
  "not moved in 14 days" instead, and the requirement header shows the real
  per-stage threshold. Worth unifying with the Pipeline Aging report in Phase 6,
  which faces the same problem one level up.
