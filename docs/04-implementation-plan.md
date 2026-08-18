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
  BDM their reporting sub-tree, and an Admin anyone. A manager
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

### Phase 5 — Product Sales, Digital Marketing & money — **done**
Demos and quotations with line items. Contracts. Invoices, payments, the four
payment statuses, and the overdue sweep. Won / Collected / Pending revenue
computed everywhere it appears.

*Ends with:* all eight verticals live and revenue is real.

Delivered: `/quotations` (+ `/new`, `/[id]` with its line-item editor),
`/contracts` (+ `/new`, `/[id]`), `/invoices` (+ `/new`, `/[id]` with
record-payment), three new lead tabs — Demos, Quotations and Commercials —
`/api/jobs/overdue-invoices` for a scheduler, placement reversal on
`/placements`, and quotation, contract and invoice numbers in global search.

**Q11 is now in the database, not only on paper.** `usesInvoicing` is `true` for
all eight verticals — a seed change *and* a data migration, because the seed
only runs where somebody re-seeds it and the flag had to move on databases
already carrying leads. Nothing reads a list of vertical codes: the switch is
the only thing that decides whether a lead exposes invoicing, so an
administrator turning it off for one vertical stays a supported act.

**Six decisions taken during the build:**

- **Money is added up in integer cents, never in floats.**
  [`src/lib/commercials/money.ts`](../src/lib/commercials/money.ts) is four
  functions long and exists because of one bug: three payments of `33.33`
  against a total of `99.99` leave a `PARTIALLY_PAID` invoice a cent short for
  ever, and nobody can see why. Every sum and comparison in this area goes
  through it, and only the result becomes a decimal again.
- **Invoice status is derived twice, on purpose.** It is written to the column
  on every payment so the indexed queries the dashboard will use in Phase 6 stay
  honest, *and* recomputed at render time so a screen never says Pending about
  an invoice that fell due overnight. The two agree except inside that window —
  and a collections register that is wrong for a morning because a cron missed a
  night is worse than one with no chip at all. `OVERDUE` beats `PARTIALLY_PAID`
  in the precedence, because [`01` §3](01-data-model.md) defines it on
  `amountPending > 0` rather than on nothing having been received.
- **The overdue sweep is an endpoint, not an in-process schedule.** The plan puts
  node-cron in Phase 7 with the follow-up and aging jobs, and Q7 — the hosting
  target — is what decides whether a process-resident timer can run at all.
  `POST /api/jobs/overdue-invoices` takes a `CRON_SECRET` bearer token or an
  administrator's session, and the same function sits behind a button on the
  register. It is idempotent, so running it twice and missing a night come out
  the same. Phase 7 can call it in-process without this route changing.
- **Overpayment is refused rather than clamped.** `amountPending` feeds Pending
  Revenue for the whole company, and an invoice recording more received than it
  ever billed would quietly reduce that number by the difference — a figure
  nobody could trace back to a keying error on one row. If the client really did
  send more, the invoice is what was wrong.
- **Accepting a quotation fills the lead's deal value, but only if it is
  blank.** Product Sales books Won Revenue off `Lead.dealValue`
  ([`02` §5](02-funnels-and-metrics.md)), and the accepted quote is the only
  place that number was ever agreed; left to be re-typed later it gets re-typed
  differently, or not at all, and the vertical reports a won deal worth nothing.
  Overwriting a value somebody set by hand would be this action deciding
  something it was not asked to decide, so it only ever fills a blank — and it
  needs `lead.commercial`, which is a separate permission, so the acceptance
  still succeeds without it and the screen says the deal value was left alone.
- **A quotation's figures freeze once it is accepted, rejected or expired; a
  contract's never do.** They are different documents. A quote is an offer that
  was sent on a particular day, and editing its lines afterwards rewrites what
  the client saw — the honest move is a new quotation. A contract on new terms in
  month seven is the same agreement, and the invoices already raised keep their
  own amounts, which is why contract value is not a sum of its invoices and the
  register shows both columns side by side.

**Reversing a placement is defined**, which is what Phase 4 left open.
[`src/lib/staffing/placement.ts`](../src/lib/staffing/placement.ts) writes a
reversal rather than deleting the row: `reversedAt`, a mandatory reason and who
did it, with every revenue query reading `reversedAt: null`. So Won Revenue
drops by the right amount and the reason it dropped is a row anybody can open.
Three things follow — the opening comes back and the requirement's status is
re-derived from it; the reversal is **refused while any non-cancelled invoice
stands against the placement**, because un-booking revenue that is still being
billed would leave Collected Revenue pointing at work the system says never
happened; and it is terminal for that submission, since `Placement.submissionId`
is unique. A candidate who joins, leaves and rejoins is submitted again, which
is the honest reading anyway. It takes `staffing.requirement.manage` *and*
`commercial.manage`: a recruiter can record the join, but taking money back off
the board is the account owner's call.

**One latent hole closed while extending attachments.** `Document` has a
nullable column for all eight parents and `Activity` has four, so
`ACTIVITY_KINDS` now names the difference and `logActivityAction` refuses a
parent it cannot write. Only a hand-crafted request ever reached it — no screen
offers a timeline on the other four — but it previously arrived at Prisma as an
unknown column and came back as "something went wrong" to someone who had done
nothing wrong. Quotations, contracts and invoices joined as documents-only
parents, gated on `commercial.manage` and scoped through their lead by the new
`leadChildVisibilityFilter`, which all four commercial record types share.

### Phase 6 — Dashboard, reports & analytics — **done**
The Sales Head dashboard exactly as your flowchart draws it. All eleven reports.
Full drill-down chain with filter state in the URL. Excel and PDF export.

*Ends with:* the Sales Head stops using spreadsheets — README §40's success test.

Delivered: `/` (the dashboard, replacing the Phase 0 placeholder), the nine
reports that were missing — `/reports/vertical`, `/reports/lead-source`,
`/reports/bde`, `/reports/bdm`, `/reports/aging`, `/reports/won-lost`,
`/reports/revenue`, `/reports/payments`, `/reports/product-demos` — a `/reports`
index that now links all eleven and carries the filter state into them, and
`/reports/export` behind Excel, PDF and CSV buttons on every one of them plus the
dashboard.

**Deviation D16 — server-rendered SVG, not Recharts.** The stack table names
Recharts and this phase does not use it. Every chart here is a static picture of
numbers the server already has: a donut of leads by vertical, horizontal bars for
the pipeline, the funnels Phase 3 already drew as divs. There is nothing to
hover, zoom or animate, so a client charting runtime would buy no behaviour and
cost a bundle, a client boundary through the middle of the dashboard, and charts
that do not print. Inline SVG and flex bars keep the whole dashboard a server
component and let each slice and bar be a real `<a>` into the filtered lead list
— which is the one interaction that matters (README §37). **Say the word if you
want Recharts**; it is a component-level swap, not a rework.

**Q5 is answered by measurement rather than by pre-aggregation.** The question was
whether the dashboard needs live queries or a materialised summary. It is live,
with three things that make that a decision rather than an omission: `reached()`
is now a real `COUNT(DISTINCT) … GROUP BY` at all three levels (below), every
per-vertical figure is one grouped query rather than eight, and the four reads
that cannot be aggregated in SQL are explicitly capped with the cap stated on
screen. Nothing is pre-computed, so nothing can be stale, and there is no refresh
job to go wrong. Revisit when the open pipeline passes a few thousand leads — the
caps are where it will show first, and each is one query away from a `GROUP BY`.

**Six decisions taken during the build:**

- **One filter parser, and its keys are the lead list's keys.**
  [`src/lib/reports/filters.ts`](../src/lib/reports/filters.ts) parses `from`,
  `to`, `vertical`, `source`, `bde`, `bdm`, `team`, `status`, `priority` — the
  same strings `/leads` already understood — so the drill-down chain is a query
  string that carries over verbatim rather than a translation table between two
  vocabularies. Every KPI card, donut slice, bar and table row on twelve screens
  links onward through the same builder, which is what makes the number and the
  rows behind it agree. The person filters stay two, never one: README §6.3 keeps
  "generated by" and "assigned to" apart everywhere else, and a single "person"
  filter here would credit a BDM's conversion to the BDE who sourced the lead.
- **Three date rules, stated on every screen that uses them.** Counts are the
  *creation cohort*, so Open + Won + Lost equals Total and the conversion has a
  denominator anybody can point at. Won and Collected revenue are *flows*, dated
  by the day the deal closed, the candidate joined or the money arrived. Pipeline
  and Pending are *stocks*, as at today, and deliberately ignore the date range.
  Mixing the first two produces a row whose parts exceed its whole; hiding the
  third makes a card that visibly ignores the date filter look like a bug. The
  Won/Lost report is the one screen dated by close date throughout, and it says so
  in its first paragraph — "12 won in August" and "12 of August's leads have been
  won" are different sentences, and a sales review goes wrong when nobody knows
  which is on screen.
- **`reached()` became an aggregate at all three levels**, which is what Phases 3
  and 4 carried forward. `COUNT(DISTINCT leadId) … GROUP BY` in
  [`src/lib/reports/aggregate.ts`](../src/lib/reports/aggregate.ts), raw SQL
  because Prisma's `groupBy` cannot express a distinct count — `by: ['toStageId',
  'leadId']` returns exactly the row-per-pair shape we were trying to get away
  from. Every filter value is a bound parameter; the only thing that becomes SQL
  text is the grouping column, from a closed list of five. The lead, requirement
  and submission versions were converted together, so the funnel and the staffing
  report got the same speed-up without a change to either screen. The
  product-demos report's two reads went the same way — demos grouped by vertical
  *and* status, and accepted quotation value summed **in cents inside Postgres**,
  because `SUM` over a `numeric` is exact while a `float8` cast would reintroduce
  the rounding error `money.ts` exists to prevent, in the one place nobody would
  think to look for it.
- **Four reads are capped, and each cap is on screen.** Pipeline value needs
  `COALESCE(dealValue, expectedBudget)` inside a `SUM`; the aging report needs to
  compare each lead against *its own stage's* threshold; the sales-cycle average
  spans two columns; the ageing ladder needs per-invoice due dates. None is
  expressible in a Prisma aggregate, so each reads rows and reduces in memory
  behind a limit — 1,000 open leads, 1,000 invoices, 2,000 closes — and says when
  the limit bit. A silent truncation on a report reads as a complete answer, which
  is the one failure mode worth spending a paragraph of UI on.
- **One export route for eleven reports and three formats.**
  [`src/lib/reports/registry.ts`](../src/lib/reports/registry.ts) holds each
  report's title, permission and table builder, and every builder calls *the same
  loader the screen calls with the same parameters* — so a file cannot drift from
  the page it came from, and since the loaders are where the data scope is
  applied, there is no second query that could widen it. Cells stay typed rather
  than pre-formatted: a money column exported as `"$12,500"` is a column nobody
  can sum, and a percentage exported as text sorts 9% after 12%. Excel gets
  number formats, a frozen header and the filter set on a second sheet; the PDF
  gets a repeating header, a page count and the filters printed on the page,
  because a PDF outlives the URL that made it. Both permissions are checked —
  `data.export` and the report's own — so a BDM without `report.revenue` cannot
  pull the revenue report by URL. Exports are audited as `EXPORT` with their
  filter string, as Phase 2's lead export established.
- **Every screen's money reads one definition, and so does every export.** The
  Won/Lost report's won value comes from the shared `revenueTotals` rather than
  from a `SUM(dealValue)` of its own — otherwise a won staffing account would have
  read as worth nothing there while the revenue report showed its placements, which
  is exactly the disagreement this phase exists to end. The same rule covers the
  exports: a viewer without `report.revenue` gets the report with its amount
  columns removed and a line saying so, rather than an export that walks around a
  permission the screen enforces.
- **Requirement outcomes stay out of the lead KPIs**, as docs/02 §5 insists. The
  dashboard counts leads and only leads, so a staffing lead with two filled
  requirements is one won lead; the requirement-level figures live on the staffing
  report, in their own units. The revenue report is where the two meet, and it
  names the rule per vertical — placements for Staffing, deal value everywhere
  else — because a reader comparing the two columns needs to know they are
  computed differently.

### Phase 7 — Notifications, imports & hardening
Notification centre and rules, email delivery, follow-up and aging jobs.
CSV/Excel import for clients, leads and candidates. Performance pass on the
dashboard queries. Backup and restore procedure. Deployment.

**Staffing is fenced to the staffing team** — the first thing built in this
phase. The permission matrix had handed staffing to all five roles, which was
right when it described what a role *may* do and wrong as a description of who
does recruitment: one team inside the single Sales department. So `Team` gained a
`staffingAccess` flag, toggled at `/admin/teams`, and `can()` now requires it on
top of the matrix tick for the two staffing capabilities. Admin and Sales Head
bypass it.

Three things follow from putting the test inside `can()` rather than on the
screens. The sidebar, all sixteen staffing pages, their server actions, the lead
Requirements tab, global search and the report exports close together — none of
them can be the one that forgot. Turning the flag on for a team grants its
members nothing their role did not already have, because both tests must pass.
And the flag defaults to false, so the migration closes staffing for everyone and
an administrator opens it for the one team that works it — defaulting to true
would have preserved the state the change exists to end. It is deliberately
independent of `Team.isActive`: deactivating a team already leaves its members
where they are, and revoking their screens as a side effect of tidying the org
chart would be a surprise.

Staffing numbers stay in the dashboard and the vertical, revenue and won/lost
reports for anyone who may read those reports. The fence is around the module,
not around the company's totals — a Manager reading Won Revenue still sees what
staffing contributed to it without being able to open a candidate.

**The lead form loses two fields and gains five sources.** Three changes asked
for together, all of them about what a person is made to type before a lead
exists.

*Contact name is gone from the new-client branch.* The client name directly above
it is that person's name whenever the client is a person, which outside Staffing
and Product Sales it usually is — so the field asked most people to type the same
thing twice. What made this more than deleting a `<Field>` is that
`resolveClient` created the primary contact **only if a contact name was given**:
removing the field alone would have thrown away the email and phone beside it and
left every new client with no contact at all. The condition is now "an email or a
phone was given", and the contact is named after the client. A separately-named
contact is still added on the client page, where a company can have several.

*Service is gone from both lead forms.* The requirement line and its description
are how the work gets described, and a second fixed taxonomy on top of them was
one more list to keep current without letting any report answer anything new.
Product Sales keeps its product picker. `serviceId` was removed from `leadSchema`
rather than merely from the forms, because the update action parses that same
object — leaving it in would have made an absent field resolve to null and blank
the service on every legacy lead the next time somebody saved an unrelated edit,
which is the trap the file already documents for `sourceActivityId`. Nothing
writes the column now, so existing values stay readable in the database; the
`Service` fact on the lead page and the `Service` column in the leads CSV are
gone, since neither could ever be filled again. `/admin/master/services` still
exists and now edits a catalogue nothing consumes — worth deciding on.

*The global source list is now* Direct Inquiry, Existing Client, LinkedIn,
Marketing, Others, Partner, Referral, Upwork, Website and YouTube. "Event /
Conference" was retired by setting `isActive: false` rather than deleting the
row: a lead recorded against it still points at it, and deleting would either
fail on the foreign key or rewrite history somebody has reported on. The seed
gained a `RETIRED_SOURCES` list for that, and the create branch now re-activates
a name that returns to the list — without which a once-retired source could never
come back, because the row already exists. Note that four of the new names are
also verticals, so the Upwork form offers "Upwork" as a source; that is what a
source means here — where the enquiry came in from — and it is per-lead rather
than per-vertical, so nothing stops it.

Every picker reads active sources from the database, so the lead form, the edit
form, the leads filter bar, the dashboard filters and the lead-source report all
changed together with no code edit. The dev database was updated by a targeted
script rather than by re-running the seed, because a re-seed resets any
`/admin/permissions` toggles an administrator has made — the seed itself carries
the new list for fresh installs.

**Five roles became three.** `MANAGER` and `SALES_HEAD` are gone; `ADMIN`, `BDM`
and `BDE` remain. Neither departing role named a distinct job. `visibleUserIds`
had always walked BDM and MANAGER down the same branch — full reporting sub-tree
plus any team they manage — so the two differed only by `lead.delete` and
`commercial.payment`, which is a permission difference rather than a role. And
the Sales Head signs in as an administrator and creates further administrators,
which left `SALES_HEAD` distinguished from `ADMIN` by `admin.master` alone.

Both permissions the Manager tier held moved to BDM, which is the one part of
this with a consequence rather than a simplification: `commercial.manage` and
`commercial.payment` now sit with the same role, so raising an invoice and
recording the money against it are one person's job. The tier boundary used to
enforce that separation. The keys stay distinct so it can be re-drawn from
`/admin/permissions` without a deployment — but by default it is not drawn.

This also narrows the staffing fence recorded above: `STAFFING_EXEMPT_ROLES` is
now `['ADMIN']`, because the role it used to also name no longer exists. The
fence itself is unchanged — a BDM still needs a team flagged for staffing.

Removing a value from a PostgreSQL enum needs the type rebuilt, so
`20260818120000_three_roles` recreates `UserRole` and re-points the three columns
that carry it (`User.role`, `RolePermission.role`, `NotificationRule.role`). It
re-points any surviving `MANAGER` user to BDM and any `SALES_HEAD` to ADMIN
first. Nobody held either role when it ran — BDM 3, BDE 2, ADMIN 1, MANAGER 0,
SALES_HEAD 0 — but the cast fails outright on a surviving row, so the re-pointing
is what stops the migration corrupting the first database where the set is not
empty.

The matrix rows are data, not code: the seed writes all twenty permissions per
role and carries the answer in `allowed`, so BDM's two new capabilities were two
flags to flip rather than rows to insert, and the departing roles' forty rows
were deleted. That had to happen inside the migration — running the seed would
have reset every permission toggle an administrator had made.

**The service catalogue is gone entirely.** The lead form stopped offering a
service, which left `/admin/master/services` editing a table no screen read.
Removed rather than left as furniture: a master-data screen that changes nothing
visible is worse than no screen, because somebody eventually curates it and
wonders why the work never appears. The screen, the registry entry, the audit
model mapping, the `Service` table and `Lead.serviceId` all go
(`20260818140000_drop_service_catalogue`). Safe outright — 0 services, 0 leads
carrying one, 0 audit rows referencing one. `EntityType.SERVICE` stays in the
enum: `AuditLog` is append-only history, and a deployment that had recorded a
service edit would need that history deleted to drop the value.

**The dashboard is narrower than the role's data scope.** A BDM's scope covers
their reporting sub-tree and any team they manage, and the lead list, the reports
and search all still honour it. The dashboard does not: it answers "how am I
doing", so everybody except an Admin sees only leads they generated or own.
`resolveDashboard` in [`src/lib/reports/filters.ts`](../src/lib/reports/filters.ts)
holds the rule, as one `ownOnly` flag on the scope rather than a second set of
loaders.

Three things had to follow it, or the page would have contradicted itself. The
header names whose leads are being counted, since a BDM whose lead list is longer
than their dashboard total needs to know why. Every tile links through with
`mine=1` — a new lead-list filter, because the narrowing is a disjunction
(generated by me OR assigned to me) that `bde` and `bdm` cannot express together;
set both and they are ANDed, listing only what one person both sourced and owns.
And the two person pickers in the filter bar are narrowed to the same set, so
neither offers a colleague whose leads can never appear.

`mine` is a visible checkbox on `/leads`, not a hidden parameter: the dashboard
links there with it set, and an active filter with no control to see or clear it
makes a short list read as missing data. The dashboard export uses
`resolveDashboard` too, so a forwarded file matches the screen it came from; the
eleven real reports keep the role scope.

Worth stating plainly: this is the one place in the app where two screens
deliberately disagree about the same question. The alternative — narrowing a
BDM's scope everywhere — was considered and not taken, because a BDM still needs
to work their team's pipeline.

**A BDM can now arrange a call without opening a lead.** Scheduling was only
possible from a lead's own timeline, so "what am I doing tomorrow" was a question
you could answer one lead at a time and no other way. `/leads` gained a Timeline
panel below the list: the viewer's arranged calls and meetings, soonest first,
with the lead, client and subject on each row, and Adjust / Mark done beside it.
Scheduling a new one from the panel picks the lead rather than starting from it.

`Activity` grew one column, `isPlanned`, rather than gaining a table
(`20260818160000_planned_activities`). A planned call and a logged call carry
identical fields, and completing one is a state change rather than a copy:
clearing the flag turns the arrangement into the history entry for the call that
happened, at the time it was arranged for. The cost of one column is that every
timeline reading history must filter `isPlanned: false` -- all four were updated
in the same commit, and the schema comment says so, because a plan listed as
history reads as a call that already took place.

Two decisions worth keeping:

- **The panel is the viewer's own diary, not their data scope.** A BDM sees their
  sub-tree's leads in the list above it, but a colleague's arrangements are not
  theirs to work from, and the question the panel answers is "what am I doing
  next". Lead visibility is applied as well, so a plan on a lead that has moved
  out of scope drops out rather than leaking a lead code. Adjusting and completing
  are owner-only for the same reason, and deliberately not widened to
  `LEAD_DELETE` the way deleting a note is: moving somebody else's call changes a
  commitment they made rather than correcting a record.
- **A past date is accepted, and shown.** Overdue plans stay in the list and sort
  to the top, since soonest-first puts them there and they are what needs
  attention. Rejecting a backdated entry would also refuse somebody writing up
  Monday's diary on Tuesday.

Nothing on the lead's own page shows its plans yet -- the fence is that history
excludes them, so a scheduled call is visible in the panel and in no other place.
That is the next small thing to add if it bites.

**The Vertical column is gone from the lead list.** The lead code prefix already
carries it, so `UP-0001` in the first column and "Upwork" in the third said the
same thing twice, on the screen with the most columns in the application. It
stays on the lead's own page, and stays as a filter on the list.

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
| ~~Phase 6~~ — **answered** | ~~**Q5** — user and lead volumes, which decides live queries vs pre-aggregation~~. Built **live**, with `reached()` converted to a real `GROUP BY` at all three levels and the four unaggregatable reads capped with the cap stated on screen — see Phase 6 above. Nothing is pre-computed, so nothing is stale; revisit when the open pipeline passes a few thousand leads |
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
- ~~**Exports are CSV.**~~ Closed: every report exports to Excel, PDF and CSV
  through one route (Phase 6 above). The **lead and client list** exports are
  still CSV only — they are row dumps rather than formatted reports, and the
  `ReportTable` model is there whenever one of them wants a workbook.
- **The two check-then-write races from Phase 1 are still open**, both guards
  rather than data paths: the last-active-administrator check in
  `admin/users/actions.ts` and the one-winning-stage-per-vertical check in
  `admin/master/stages/actions.ts`. They were blocked on interactive
  transactions, which Phase 2 built — each is now a matter of moving the body
  into `auditedTransaction`.

### Carried into Phase 4 from the Phase 3 build

- ~~**`reached()` fetches distinct `(stage, lead)` pairs and counts them in
  memory.**~~ Closed in Phase 6: it is a `COUNT(DISTINCT leadId) … GROUP BY` in
  [`src/lib/reports/aggregate.ts`](../src/lib/reports/aggregate.ts), and the
  funnel calls it unchanged.
- **Leads are bucketed by day in JavaScript** on the counter summary, for the
  reason in the code comment: the day a timestamp belongs to is the day where
  the reader is, which Postgres cannot know without being told the zone. If it
  ever needs to be SQL, the zone has to become an explicit input rather than an
  assumption.
- **Weeks start on Monday, with no setting behind it.** `startOfWeek` is the one
  function that knows; a team that wants Sunday-first needs a setting and that
  one edit.
- ~~**The funnel has no export.**~~ Closed: Excel, PDF and CSV, through the
  shared route. Its builder parses the funnel's own narrower filter set rather
  than pretending every screen shares one vocabulary.
- ~~**`/reports` lists ten reports and links one.**~~ Closed: it links all
  eleven, hides the ones the viewer's permissions do not reach, and carries the
  filter state into the nine that share it. Still a hard-coded list — each new
  report is added there as well as routed and registered for export.

### Carried into later phases from the Phase 4 build

- ~~**`subReached()` has the same shape as `reached()`, and the same caveat.**~~
  Closed with the other two in Phase 6: all three levels are `GROUP BY`
  aggregates now, and the staffing report calls them unchanged.
- ~~**Reversing a placement is Phase 5's to define.**~~ Closed: it writes its own
  record, keeps the row, and refuses while an invoice still stands against the
  placement — see Phase 5 above. The submission board still refuses the stage
  move, but it now refuses *towards somewhere*.
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
- ~~**The staffing report has no export**, same as the funnel.~~ Closed: its
  three levels are flattened into a metric / unit / value / conversion table, so
  the requirement and submission units stay distinguishable in a spreadsheet.
- **The requirement list's ageing filter asks a coarser question than the
  detail page.** Per-stage `agingThresholdDays` is master data, so "past its own
  threshold" is not one number the list can filter on in SQL; the filter offers
  "not moved in 14 days" instead, and the requirement header shows the real
  per-stage threshold. Phase 6 solved the same problem one level up by comparing
  in memory behind a cap — `/reports/aging` flags each lead against its own
  stage's threshold and shows the days, the limit and the overrun. The requirement
  list can take the same approach whenever somebody wants it there.

### Carried into Phase 6 from the Phase 5 build

- **No commercial list paginates**, matching every other list in the app: 100
  quotations, 100 contracts, 100 invoices, and a footer that says so. Q5 was
  answered in favour of live queries with stated caps (Phase 6 above), so this
  stays as it is — the filters are how a list is narrowed, and the reports are
  where a whole period is read.
- **The invoice register's totals are four aggregate queries per render.**
  Correct and indexed. The dashboard's version of the same three figures is one
  grouped pass in [`src/lib/reports/kpis.ts`](../src/lib/reports/kpis.ts), which
  the register could call instead — it would be one query rather than four, and
  the two would then be the same code as well as the same definition.
- **`/invoices/new` only offers the "bills for" picker once a lead is fixed**,
  because the answers come from that lead. Starting from the register with no
  lead in hand raises an invoice against the deal itself. The full route in is
  the lead's Commercials tab, a contract, a quotation or a placement — each of
  which pre-selects itself. A lead typeahead would collapse the two paths, and
  is the same missing control the lead form's client picker wants.
- **A quotation has no expiry job.** `validUntil` is shown, and a quote past it
  is flagged on the detail page, but nothing moves it to `EXPIRED` — that stays
  a decision somebody takes, because a client coming back a week late is
  normal and auto-expiring the document would refuse an order that is still
  live. If it should be automatic, it belongs beside the overdue sweep.
- ~~**No commercial screen exports.**~~ Half closed: `/reports/revenue` and
  `/reports/payments` are built and export in all three formats, and the payments
  report is the invoice register with its ageing worked out — so there is now a
  route to an invoice extract. The registers themselves still have no export
  button of their own, which is a link away rather than a query away.
- **`Payment` has no partial-refund shape.** A receipt can be removed if it was
  keyed in error, and an invoice can be cancelled before anything is collected,
  but money that arrived and then went back out has nowhere to go. Nothing needs
  it yet; the placement reversal is the case that would have, and it refuses
  while a live invoice exists precisely so this gap cannot be reached silently.

### Carried into Phase 7 from the Phase 6 build

- **Four reads are capped rather than aggregated**, each for a reason SQL cannot
  express through Prisma: `COALESCE` inside a `SUM` for pipeline value, a
  per-stage threshold comparison for the aging list, a two-column average for the
  sales cycle, and per-invoice due dates for the ageing ladder. Every one states
  its cap on screen when it bites. The performance pass in Phase 7 is where they
  become raw aggregates if the volumes ask for it.
- **The dashboard renders eight to twelve queries per load**, all indexed and
  several grouped, none cached. That is deliberate — nothing stale, no refresh job
  — but it is the first thing to measure in Phase 7's performance pass, and
  `unstable_cache` around the vertical and stage master data would take a third of
  them off without introducing staleness anybody would notice.
- **No chart is interactive.** Deviation D16 above: SVG and flex bars, no
  Recharts. If a chart ever needs a tooltip, a zoom or a drag, that component is
  where the library goes in — the data loaders would not change.
- **The funnel and staffing reports keep their own filter vocabulary.** They parse
  `user` where everything else parses `bde`/`bdm`, because a counter is logged by
  one person and a lead has both a generator and an owner. The reports index
  therefore does not carry filter state into those two, and says so. Unifying them
  means teaching the funnel what an assignee is, which is a change to what it
  measures rather than to how it is filtered.
- **The lost-reason breakdown counts leads, not money.** "At stake" is the
  expected budget on the lost leads, which is the only figure that exists — nothing
  was ever agreed on a lost deal. If the value of what was lost needs to be a
  real number, it needs a field somebody fills in at the point of losing.
- **`/reports/export` is one route with a registry**, which is the right shape but
  means a report is exportable only once it is registered. Adding a twelfth report
  is three edits: route it, list it on the index, register its table builder.
