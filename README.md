# Sales CRM

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

## Local setup

Requires Node 20+ and a reachable PostgreSQL server.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — your PostgreSQL connection string. Percent-encode any
  reserved characters in the password.
- `AUTH_SECRET` — 32+ characters. Generate with
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — the first administrator account.
  The password must be at least 10 characters.

Then create the schema and master data:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The Prisma client is generated into `src/generated/` and is **not** committed,
so `npm run db:generate` is required after a fresh clone.

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
