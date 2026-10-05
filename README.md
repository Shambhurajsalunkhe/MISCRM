# MISCRM (Sales CRM)

MISCRM is an internal Management Information System and CRM that centralizes
customer, lead, sales, and business data. It streamlines data management,
tracks business activities, and provides reports and operational insights.

Multi-vertical sales management, pipeline tracking, conversion analytics and
revenue visibility for eight acquisition channels: Upwork, LinkedIn, Email,
Cold Calling, Staffing, Digital Marketing, Product Sales and Other Sources.

## Documentation

Read these before changing the data model or funnel logic.

| Document | Contents |
|---|---|
| [docs/05-project-overview.md](docs/05-project-overview.md) | **Start here.** What the product is, the user roles, the lead flow and the architecture, in plain language |
| [docs/00-decisions.md](docs/00-decisions.md) | Every design decision, with its source, plus the open questions |
| [docs/01-data-model.md](docs/01-data-model.md) | ERDs, ownership model, staffing hierarchy, visibility rules, indexing |
| [docs/02-funnels-and-metrics.md](docs/02-funnels-and-metrics.md) | Stage lists per vertical and the formula for every metric |
| [docs/03-screens-and-roles.md](docs/03-screens-and-roles.md) | Screen inventory, routes, permission matrix |
| [docs/04-implementation-plan.md](docs/04-implementation-plan.md) | Phased build plan and dependency order |
| [Sales CRM – README.md](Sales%20CRM%20%E2%80%93%20README.md) | The original business specification |

## Stack

Next.js 15 (App Router) · TypeScript · PostgreSQL 18 · Prisma 7 with
`@prisma/adapter-pg` · Tailwind CSS 4 · `jose` + `bcryptjs` sessions.

## Quick Start

Requires **Node.js 20+** and **PostgreSQL** (or **Docker**).

### 🚀 Option 1: Quickstart with Docker (Recommended)

1. **Clone & Install Dependencies:**
   ```bash
   git clone https://github.com/Shambhurajsalunkhe/MISCRM.git
   cd MISCRM
   npm install
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env
   ```
   Set `AUTH_SECRET` to a random value of at least 32 characters, and set
   `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before running setup. The seed
   password must be at least 10 characters.

3. **Start PostgreSQL Database:**
   ```bash
   docker compose up -d
   ```

4. **Initialize Database & Seed Master Data:**
   ```bash
   npm run setup
   ```

5. **Start Development Server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### 💻 Option 2: Quickstart with Local PostgreSQL

1. **Clone & Install:**
   ```bash
   git clone https://github.com/Shambhurajsalunkhe/MISCRM.git
   cd MISCRM
   npm install
   cp .env.example .env
   ```

2. **Configure `.env`:**
   Update `DATABASE_URL` in `.env` with your local PostgreSQL credentials:
   ```env
   DATABASE_URL="postgresql://<user>:<password>@localhost:5432/dmcrm?schema=public"
   ```

3. **Initialize Database & Run:**
   ```bash
   npm run setup
   npm run dev
   ```

---

Configure the initial administrator email and password in `.env` before running
`npm run setup`. Use a unique password of at least 10 characters.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Seed master data (idempotent) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drop, re-migrate and re-seed |

## Build status

| Phase | State |
|---|---|
| 0 — Foundation: auth, RBAC, visibility, app shell | Complete |
| 1 — Org and master data | Complete |
| 2 — Clients, leads, the stage engine and search | Complete |
| 3 — Prospecting counters and the vertical funnels | Complete |
| 4 — Staffing: requirements, candidates, submissions, placements | Complete |
| 5 — Product Sales, Digital Marketing and money | Complete |
| 6 — Dashboard, reports and analytics | Complete |
| 7 — Notifications, imports, hardening, deployment | Partly — the staffing fence landed; the rest is open |
| 8 — Automation rules, targets and quotas, integrations | Not started — optional |

Uploaded documents are written to `storage/uploads/`, outside `public/` and
git-ignored, and are served only through `/api/documents/[id]` after the same
visibility check the parent record itself gets — a lead, client, requirement,
candidate or submission. See `src/lib/storage.ts` to point this at S3 instead.
