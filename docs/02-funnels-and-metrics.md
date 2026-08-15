# Funnels, Stages & Metric Definitions

Everything in this document is seed data or a formula. Nothing here is hard-coded
in the application — stages, counters and lost reasons are all editable from
Master Data (README §33).

---

## 1. The two-layer model

Each vertical's funnel is split at one line: **the point where a real Lead record
is created** (decision D1).

```
   ABOVE THE LINE                        BELOW THE LINE
   ProspectingActivity                   Lead + LeadStageHistory
   (daily counts per BDE)                (one record per opportunity)

   850 pitches, 2,500 calls,             145 Upwork leads,
   1,200 emails, 700 outreach            110 cold-calling leads
              │
              └──── the "bridge" conversion % ────┘
```

- **Above the line:** a BDE logs `Rahul — Upwork — 12 Aug — Pitches Submitted — 40`.
  No client record, no lead record, no noise.
- **Below the line:** the moment a prospect responds, a Lead is created and
  carries a client, a contact, an owner and a stage from then on.
- The **bridge %** (Pitch → Response, Call → Interested, Email → Response) is
  `leads created in period ÷ counter total in period`.

`Lead.sourceActivityId` optionally points back at the counter batch the lead came
from, so the bridge is auditable rather than purely statistical.

---

## 2. Per-vertical configuration — PLEASE CONFIRM (open question Q1)

You confirmed the principle. This table is where I've drawn the line for each
vertical. **This is the one thing I most need you to check**, because it decides
what your BDEs type in every day.

| Vertical | Logged as counters (above the line) | A Lead record is created when… |
|---|---|---|
| **Upwork** | Pitches Submitted | the client replies to a pitch |
| **LinkedIn** | Prospects Identified, Outreach Sent | the prospect replies |
| **Email** | Emails Sent | the recipient replies |
| **Cold Calling** | Calls Made, Calls Connected | the prospect shows interest |
| **Staffing** | Client Outreach | the client responds |
| **Digital Marketing** | Campaigns Run, Service Inquiries | the inquiry is qualified into a lead |
| **Product Sales** | *(none)* | a product inquiry is received |
| **Other Sources** | *(none)* | the referral/website inquiry arrives |

Notes on the two exceptions:

- **Product Sales** has no counters because your dashboard shows *120 demos
  against 60 leads* — demos outnumber leads, so the inquiry itself must be the
  lead and demos hang off it as repeatable child records (decision D11).
- **Digital Marketing** — README §18 starts the funnel at "Service Inquiry" but
  your dashboard's input column says "15 Campaigns". I've kept both as counters.
  Tell me if service inquiries should instead create leads directly.

---

## 3. Stage seed data

`Common` = the bucket each stage rolls up to for the all-vertical pipeline chart.

### 3.1 Upwork — `UP-0001`

| # | Stage | Common |
|---|---|---|
| 1 | Client Response | NEW |
| 2 | Requirement Gathering | REQUIREMENT_GATHERING |
| 3 | Estimation Shared | PROPOSAL |
| 4 | Negotiation | NEGOTIATION |
| 5 | Won | WON |
| 6 | Lost | LOST |

### 3.2 LinkedIn — `LI-0001`

| # | Stage | Common |
|---|---|---|
| 1 | Response Received | NEW |
| 2 | Opportunity Created | CONTACTED |
| 3 | Requirement Gathering | REQUIREMENT_GATHERING |
| 4 | Proposal Shared | PROPOSAL |
| 5 | Negotiation | NEGOTIATION |
| 6 | Won | WON |
| 7 | Lost | LOST |

### 3.3 Email — `EM-0001`

Identical to LinkedIn (README §11 defines the same chain from "Response" onward).

### 3.4 Cold Calling — `CC-0001`

| # | Stage | Common |
|---|---|---|
| 1 | Interested Prospect | NEW |
| 2 | Opportunity Created | CONTACTED |
| 3 | Requirement Gathering | REQUIREMENT_GATHERING |
| 4 | Proposal Shared | PROPOSAL |
| 5 | Negotiation | NEGOTIATION |
| 6 | Won | WON |
| 7 | Lost | LOST |

### 3.5 Digital Marketing — `DM-0001`

| # | Stage | Common |
|---|---|---|
| 1 | Lead Generated | NEW |
| 2 | Qualified Lead | CONTACTED |
| 3 | Requirement Gathering | REQUIREMENT_GATHERING |
| 4 | Proposal Shared | PROPOSAL |
| 5 | Negotiation | NEGOTIATION |
| 6 | Won | WON |
| 7 | Lost | LOST |

After WON, the lead gains Contract → Invoice → Payment records (decision D10).
The funnel view still draws them below WON exactly as your flowchart does.

### 3.6 Product Sales — `PR-0001`

| # | Stage | Common |
|---|---|---|
| 1 | Product Inquiry | NEW |
| 2 | Demo Scheduled | CONTACTED |
| 3 | Demo Completed | REQUIREMENT_GATHERING |
| 4 | Quotation Shared | PROPOSAL |
| 5 | Negotiation | NEGOTIATION |
| 6 | Order / Won | WON |
| 7 | Lost | LOST |

*Mapping "Demo Completed" to the Requirement Gathering bucket is my call — it is
the point where the client's needs become known. Say the word if you'd rather it
sat under CONTACTED.*

### 3.7 Other Sources — `OT-0001`

The plain common pipeline: New → Contacted → Requirement Gathering → Proposal →
Negotiation → Won / Lost (README §21).

### 3.8 Staffing — `ST-0001` (three levels)

**Lead level** — the client engagement. Its outcome is *derived*, never typed:

| # | Stage | Common |
|---|---|---|
| 1 | Client Responded | NEW |
| 2 | Active Account | CONTACTED |
| — | Won *(≥1 requirement filled)* | WON |
| — | Lost *(all requirements lost)* | LOST |

**Requirement level** — `REQ-001`, where won/lost actually lives (decision D8):

| # | Requirement Stage | Flag |
|---|---|---|
| 1 | Requirement Received | |
| 2 | Requirement Qualified | |
| 3 | Candidate Sourcing | |
| 4 | Profiles Shared | |
| 5 | Client Shortlisted | |
| 6 | Interview | |
| 7 | Selection / Offer | |
| 8 | Placement | **isWon** |
| 9 | Lost / Not Selected | **isLost** |

**Candidate level** — per submission (README §16):

Sourced → Profile Shared → Client Reviewing → Shortlisted → Interview Scheduled →
Interview Completed → Selected → Offer → **Joined / Placed** *(isPlaced)* /
**Rejected** *(isRejected)*

---

## 4. Metric formulas

Two primitives, both scoped by date range and any active filter (vertical, BDE,
BDM, team, client, country, priority):

```
counter(v, KEY)  = SUM(ProspectingActivity.count)
                   WHERE verticalId = v AND metric.key = KEY

reached(v, CODE) = COUNT(DISTINCT leadId) FROM LeadStageHistory
                   WHERE toStage.code = CODE AND lead.verticalId = v
```

`reached()` counts leads that **ever passed through** a stage, not leads sitting
there now (decision D12). A lead that went Requirement Gathering → Negotiation →
Won counts once in each of those three stages. This is why every conversion
number needs `LeadStageHistory` and cannot be read off `Lead.currentStageId`.

`currentlyAt(v, CODE)` — a plain count on `Lead.currentStageId` — is used only by
the Kanban board and the "open pipeline" widget.

### 4.1 Upwork (README §9.8)

| Metric | Formula |
|---|---|
| Pitches Submitted | `counter(UP, PITCHES_SUBMITTED)` |
| Client Responses | `leads created (UP)` |
| Pitch → Response % | `responses ÷ pitches` |
| Response → Requirement % | `reached(REQUIREMENT_GATHERING) ÷ responses` |
| Requirement → Estimation % | `reached(ESTIMATION_SHARED) ÷ reached(REQUIREMENT_GATHERING)` |
| Estimation → Negotiation % | `reached(NEGOTIATION) ÷ reached(ESTIMATION_SHARED)` |
| Negotiation → Won % | `reached(WON) ÷ reached(NEGOTIATION)` |
| Pitch → Won % | `reached(WON) ÷ pitches` |

### 4.2 LinkedIn (README §10)

| Metric | Formula |
|---|---|
| Prospect → Outreach % | `counter(OUTREACH_SENT) ÷ counter(PROSPECTS_IDENTIFIED)` |
| Outreach → Response % | `leads created ÷ counter(OUTREACH_SENT)` |
| Response → Opportunity % | `reached(OPPORTUNITY_CREATED) ÷ leads created` |
| Opportunity → Proposal % | `reached(PROPOSAL_SHARED) ÷ reached(OPPORTUNITY_CREATED)` |
| Proposal → Negotiation % | `reached(NEGOTIATION) ÷ reached(PROPOSAL_SHARED)` |
| Negotiation → Won % | `reached(WON) ÷ reached(NEGOTIATION)` |
| Prospect → Won % | `reached(WON) ÷ counter(PROSPECTS_IDENTIFIED)` |

### 4.3 Email (README §11)

| Metric | Formula |
|---|---|
| Email → Response % | `leads created ÷ counter(EMAILS_SENT)` |
| Response → Opportunity % | `reached(OPPORTUNITY_CREATED) ÷ leads created` |
| Opportunity → Proposal % | `reached(PROPOSAL_SHARED) ÷ reached(OPPORTUNITY_CREATED)` |
| Proposal → Negotiation % | `reached(NEGOTIATION) ÷ reached(PROPOSAL_SHARED)` |
| Negotiation → Won % | `reached(WON) ÷ reached(NEGOTIATION)` |
| Email → Won % | `reached(WON) ÷ counter(EMAILS_SENT)` |

### 4.4 Cold Calling (README §12)

| Metric | Formula |
|---|---|
| Call → Connected % | `counter(CALLS_CONNECTED) ÷ counter(CALLS_MADE)` |
| Connected → Interested % | `leads created ÷ counter(CALLS_CONNECTED)` |
| Interested → Lead % | `reached(OPPORTUNITY_CREATED) ÷ leads created` |
| Lead → Proposal % | `reached(PROPOSAL_SHARED) ÷ reached(OPPORTUNITY_CREATED)` |
| Proposal → Negotiation % | `reached(NEGOTIATION) ÷ reached(PROPOSAL_SHARED)` |
| Negotiation → Won % | `reached(WON) ÷ reached(NEGOTIATION)` |
| Call → Won % | `reached(WON) ÷ counter(CALLS_MADE)` |

### 4.5 Digital Marketing (README §18)

| Metric | Formula |
|---|---|
| Inquiry → Lead % | `leads created ÷ counter(SERVICE_INQUIRIES)` |
| Lead → Qualified % | `reached(QUALIFIED_LEAD) ÷ leads created` |
| Qualified → Proposal % | `reached(PROPOSAL_SHARED) ÷ reached(QUALIFIED_LEAD)` |
| Proposal → Negotiation % | `reached(NEGOTIATION) ÷ reached(PROPOSAL_SHARED)` |
| Negotiation → Won % | `reached(WON) ÷ reached(NEGOTIATION)` |
| Lead → Won % | `reached(WON) ÷ leads created` |

### 4.6 Product Sales (README §20)

| Metric | Formula |
|---|---|
| Product Inquiries | `leads created (PR)` |
| Demos Scheduled | `COUNT(Demo)` |
| Demos Completed | `COUNT(Demo WHERE status = COMPLETED)` |
| Inquiry → Demo % | `leads with ≥1 demo ÷ leads created` |
| Demo → Proposal % | `reached(QUOTATION_SHARED) ÷ leads with ≥1 completed demo` |
| Proposal → Negotiation % | `reached(NEGOTIATION) ÷ reached(QUOTATION_SHARED)` |
| Negotiation → Won % | `reached(WON) ÷ reached(NEGOTIATION)` |
| Demo → Won % | `reached(WON) ÷ leads with ≥1 completed demo` |
| Inquiry → Won % | `reached(WON) ÷ leads created` |
| Order Value | `SUM(Quotation.totalAmount WHERE status = ACCEPTED)` |
| Average Order Value | `order value ÷ won leads` |

### 4.7 Staffing (README §17)

Counts come from three tables. `subReached(CODE)` is the candidate-submission
equivalent of `reached()`, read from `CandidateStageHistory`.

| Metric | Formula |
|---|---|
| Client Outreach | `counter(ST, CLIENT_OUTREACH)` |
| Client Responses | `leads created (ST)` |
| Requirements Received | `COUNT(Requirement)` |
| Qualified Requirements | `requirements that reached REQUIREMENT_QUALIFIED` |
| Openings | `SUM(Requirement.openings)` |
| Candidates Sourced | `COUNT(DISTINCT CandidateSubmission.candidateId)` |
| Profiles Shared | `subReached(PROFILE_SHARED)` |
| Profiles Shortlisted | `subReached(SHORTLISTED)` |
| Interviews | `COUNT(Interview)` |
| Selections | `subReached(SELECTED)` |
| Placements | `COUNT(Placement)` |
| Lost Requirements | `COUNT(Requirement WHERE status = LOST)` |
| Outreach → Requirement % | `requirements received ÷ counter(CLIENT_OUTREACH)` |
| Requirement → Profile Shared % | `requirements with ≥1 profile shared ÷ requirements received` |
| Profiles Shared → Shortlist % | `subReached(SHORTLISTED) ÷ subReached(PROFILE_SHARED)` |
| Shortlist → Interview % | `subReached(INTERVIEW_SCHEDULED) ÷ subReached(SHORTLISTED)` |
| Interview → Selection % | `subReached(SELECTED) ÷ subReached(INTERVIEW_COMPLETED)` |
| Selection → Placement % | `placements ÷ subReached(SELECTED)` |
| Requirement → Placement % | `requirements with ≥1 placement ÷ requirements received` |
| Fill Rate | `SUM(positionsFilled) ÷ SUM(openings)` |

---

## 5. Dashboard KPIs (README §24)

| KPI | Formula |
|---|---|
| Total Leads | `COUNT(Lead)` in range |
| Open Leads | `COUNT(Lead WHERE status = OPEN)` |
| Won | `COUNT(Lead WHERE status = WON)` + `COUNT(Requirement WHERE status IN (FILLED, PARTIALLY_FILLED))` for Staffing |
| Lost | `COUNT(Lead WHERE status = LOST)` + lost requirements |
| Overall Conversion | `won ÷ (won + lost)` |
| Pipeline Value | `SUM(COALESCE(dealValue, expectedBudget)) WHERE status = OPEN` |
| **Won Revenue** | non-staffing: `SUM(Lead.dealValue WHERE status = WON)`; staffing: `SUM(Placement.placementValue)` |
| **Collected Revenue** | `SUM(Payment.amount)` |
| **Pending Revenue** | `SUM(Invoice.amountPending WHERE status ≠ CANCELLED)` |

### ⚠ One consequence of decision D6 you should be aware of

You chose invoicing for **Digital Marketing, Product Sales and Staffing only**.
That means Upwork, LinkedIn, Email and Cold Calling deals will show **Won Revenue
but no Collected or Pending Revenue** — there is nothing to collect against.

So on the dashboard, `Collected + Pending` will not reconcile to `Won Revenue`.

Three ways to handle it, your call — **this is open question Q11**:

1. Show Collected/Pending KPIs with a "covers DM, Product Sales & Staffing" note.
2. Enable invoicing for all verticals after all (a one-line master-data flag —
   `SalesVertical.usesInvoicing` is already in the schema).
3. Add a simple "Amount Received" field on won leads in the other four verticals,
   without full invoicing.

I'd suggest **option 2** — Upwork and LinkedIn projects do get paid in
instalments, and you already have the table. But it's your process, not mine.

---

## 6. Pipeline Aging (README §29)

A lead is flagged when
`now − Lead.stageChangedAt > PipelineStage.agingThresholdDays`.

Thresholds are per stage, per vertical, and editable — a lead can legitimately
sit in Negotiation longer than it should sit in Requirement Gathering.

Average time in stage, for the bottleneck report:

```
AVG(LeadStageHistory.hoursInPreviousStage)
GROUP BY fromStageId
```

---

## 7. Drill-down chain (README §37)

Every number above is a link. Clicking any of them applies the exact filter set
that produced it:

```
KPI card  →  Vertical breakdown  →  Lead list (filtered)  →  Lead detail  →  Timeline
```

The filter state lives in the URL, so any view a Sales Head is looking at can be
copied and sent to someone else.
