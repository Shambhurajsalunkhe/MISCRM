# Sales CRM — Confirmed Decisions & Open Questions

This document records every decision the design is built on. If any line here is
wrong, tell me before implementation starts — most of them change the schema.

---

## 1. Confirmed by you

| # | Decision | Choice |
|---|---|---|
| D1 | Top-of-funnel volume | **Activity counters.** Pitches, calls, emails and outreach are logged as periodic counts per user. A Lead record is created only when the prospect responds / shows interest. |
| D2 | Technology stack | **Next.js 15 (App Router) + TypeScript + Prisma + PostgreSQL + Tailwind + shadcn/ui.** |
| D3 | First delivery | **Schema and plan documents first**, for approval before application code. |
| D4 | Currency | **USD only.** All monetary values stored and reported in USD. |
| D5 | Lead status model | **One vertical stage per lead + a derived common stage.** Users pick from their vertical's own stage list; each stage maps to a common bucket so the all-vertical pipeline chart works with no double entry. |
| D6 | Invoicing & payment tracking | **Digital Marketing, Product Sales and Staffing.** Other verticals record deal value only. |
| D7 | Visibility | **Team hierarchy.** BDE sees own; BDM/Manager sees own + their team's; Sales Head/Admin sees all. |

---

## 2. Decided by me from the README / flowchart

Each of these is traced to the source rather than assumed.

### D8 — Staffing outcome and revenue live at Requirement level

**Decision:** A Requirement is won or lost independently. A Lead can be partly won.
Revenue is booked **per placement** (per candidate who joins).

**Source:**
- §17 lists `Lost Requirements` as a metric, and `Requirement → Placement %` as a conversion.
- §14 shows one client holding three simultaneous requirements with separate IDs.
- §17 counts `Openings`, `Selections` and `Placements` as three separate numbers.
- §16 gives every candidate its own status ending at `Joined / Placed`.

**Consequence:** `Lead.status` for Staffing is *derived*: WON if ≥1 requirement filled,
LOST if all requirements lost, otherwise OPEN.

### D9 — Candidates are a reusable master, not rows under a requirement

**Decision:** `Candidate` is a master record; `CandidateSubmission` joins a candidate to a
requirement and carries the per-requirement stage.

**Source:** §16 shows candidate statuses per requirement, but §36 requires candidate
profile documents to be stored and §17 requires `Candidates Sourced` as a distinct count
from `Profiles Shared`. A person sourced once and submitted to two clients must not be
counted as two people.

### D10 — Post-Won steps are records, not pipeline stages

**Decision:** Contract, Invoice and Payment are separate entities attached to a won Lead,
not stages in the funnel. The funnel view still renders them as milestones below WON,
exactly as the flowchart draws them.

**Source:** §19 treats them as tracked commercial data with their own statuses
(`Pending / Partially Paid / Paid / Overdue`), independent of the sales stage.

### D11 — Product Sales: a lead can have many demos

**Decision:** A Product Sales lead is created at Product Inquiry. `Demo` is a child record,
so one lead can hold several demos.

**Source:** The dashboard shows Product Sales with **120 Demos against 60 leads** — demos
must be repeatable per lead for that arithmetic to work.

### D12 — Conversion % is measured on "ever reached", not "currently at"

**Decision:** `Estimations Shared = 85` means 85 leads *passed through* that stage, not 85
sitting there now. Every stage entry is written to `LeadStageHistory`.

**Source:** §26 and the funnel metrics in §9.8, §10, §11, §12, §17, §18, §20 are all
stage-to-stage conversions, which are only computable from transition history.
This also powers the Pipeline Aging report (§29).

### D13 — Roles are a fixed set with a configurable permission matrix

**Decision:** Five system roles (`ADMIN`, `SALES_HEAD`, `MANAGER`, `BDM`, `BDE`) with a
`RolePermission` table so Admin can toggle individual capabilities without code changes.

**Source:** §32 defines three role groups; §33 requires Roles to be manageable; the
flowchart's master-data panel lists `Roles & Permissions`.

---

## 3. Open questions — defaults accepted 16 Aug 2026

You accepted the proposed default for every question below rather than
answering them individually, so **the defaults in the right-hand column are now
what is being built**.

**Q11 was then answered explicitly on 16 Aug 2026, and not with its default:**
invoicing is enabled for **every** vertical rather than for Digital Marketing,
Product Sales and Staffing only. That makes `Collected + Pending` reconcile to
`Won Revenue` across all eight, and removes the caveat every revenue report
would otherwise have had to carry. See
[`02-funnels-and-metrics.md`](02-funnels-and-metrics.md) §5.

Each is still a decision rather than a fact about your business. The ones that
would be most expensive to reverse later, and so are worth a second look before
Phase 3 lands:

- **Q1 — the counter-vs-lead cut-off per vertical.** This decides what counts
  as a lead at all, and therefore every conversion percentage on the dashboard.
  Changing it later re-bases historical numbers.
- **Q2 — backward stage movement is allowed**, with a mandatory reason recorded
  in stage history. If your process forbids it, say so: "ever reached" metrics
  (decision D12) read differently when a lead can revisit a stage.
- **Q3 — a Sales Head may reassign between BDMs**, with full history and a
  notification to both parties.
- **Q10 — soft delete**, recoverable by Admin. This is already how Phase 1
  behaves: nothing in the admin area hard-deletes, everything deactivates.

Cheaper to change, decided and moving on: Q4, Q5, Q6, Q8 and Q9 as tabled
below. Note the Q9 row's default reads "S3-compatible, local disk fallback";
what is being built is the reverse emphasis — **local disk first**, behind a
storage interface an S3 adapter slots into without touching call sites. Same
interface either way, so the hosting answer (Q7) can still decide it.

| # | Question | My proposed default |
|---|---|---|
| Q1 | **Exact counter-vs-lead split per vertical.** You confirmed the principle (D1); I need the cut-off line confirmed per vertical. My proposal is in `02-funnels-and-metrics.md` §2. | See table there |
| Q2 | Can a lead move **backwards** in the funnel or skip stages? | Allowed, with a mandatory reason note, recorded in stage history |
| Q3 | Can a Sales Head **reassign** a lead between BDMs? | Yes, with full assignment history and a notification to both |
| Q4 | Any **real integrations** for v1 — Upwork API, LinkedIn, email inbox parsing? | No. Manual entry + CSV/Excel import only for v1; integration hooks stubbed |
| Q5 | Expected **users and leads per month**? | Assumed <100 users, <5,000 leads/month → live queries, no pre-aggregation |
| Q6 | Do you need **targets/quotas** (actual vs target per BDE/BDM/vertical)? Not in the README. | Not built in v1; schema leaves room |
| Q7 | **Hosting** — your VPS, AWS/Azure, or Vercel + managed Postgres? | Affects file-storage choice only |
| Q8 | Is there **existing spreadsheet data** to migrate? | Assumed no; a CSV importer covers it if yes |
| Q9 | **Attachments** — local disk or S3-compatible object storage? | S3-compatible; local disk fallback for on-prem |
| Q10 | Should **deleted leads** be recoverable? | Soft delete only; Admin can restore |
