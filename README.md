# Personal CRM

A single-owner CRM for three areas of your life: **Restaurants** (accounts you sell to), **Investors** (angels and institutions in a fundraising pipeline) and **General** (friends, family and professional contacts you want to stay in touch with).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · Neon Postgres · Drizzle ORM · Better Auth · Vitest

## Setup

1. Create a Neon project with two branches: `main` (production) and `dev` (local). If your Neon account is managed by Vercel, the Neon CLI cannot create projects there; create the database from Vercel instead (Storage → Create Database → Neon), then add a `dev` branch in the Neon console.
2. Copy `.env.example` to `.env.local` and fill in the `dev` branch's pooled and direct connection strings, a `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL`.
3. Install, migrate, create the owner, run:

```bash
npm install
npm run db:migrate
npm run seed:owner   # interactive: email and password for the one owner account
npm run dev
```

Public sign-up is closed; the seed script is the only way to create the owner.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Unit tests, plus integration tests against the Neon `dev` branch when `.env.local` is present |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the branch in `DATABASE_URL_UNPOOLED` |

## Design

See `docs/superpowers/specs/2026-10-02-crm-overhaul-design.md`. Build plans live in `docs/superpowers/plans/`.
