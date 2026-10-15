# Rapport

Rapport is a single-owner CRM for three areas of your life: **Restaurants** (accounts you sell to), **Investors** (angels and institutions in a fundraising pipeline) and **General** (friends, family and professional contacts you want to stay in touch with).

## Radar (research → approve → CRM)

The **Radar** tab is the research feed that used to be a separate app (Query). Weekly research routines find people and
opportunities and write them into four feeds: **Sooz people** (angels, celebrities and athletes, next-gen investors,
creators and college athletes, retail buyers, press), **Sooz** (events, sampling slots, funding, resources),
**Personal** and **Career**. Review them like an inbox (save, dismiss, notes, filters, search).

- **Approve** a person (one at a time) and they land in the CRM: angels and next-gen investors as an Investors angel deal
  at Target; buyers as a Restaurants company + contact + Lead deal (a second buyer at the same store joins the same
  deal); celebrities, creators and press as a General contact with high priority. The research (source, why, contact
  route) is kept on the contact, and an "Added from Radar" note starts the timeline.
- **Outreach** lives on the deal or contact page: purpose (investor, ambassador, buyer, press, intro), drafts, *Open in
  Gmail* (nothing is ever sent for you), *Mark sent* (logs an email, adds a follow-up task in 5 days, moves Target →
  Intro or Lead → Contacted), follow-ups (+7 days, 3 touches max), *They replied*.
- **Settings** holds your pitch facts (the only facts drafts use), LinkedIn connections (warm paths), a people CSV
  import into the Radar, and a Radar CSV export.

### Routines

Five Claude desktop scheduled tasks run on the owner's Mac (they read `routines/*.md` from this folder at run time):

| Task | When (Central) | Does |
|---|---|---|
| Sooz research | Mon ~8:00 | every `sooz-*` task in `src/lib/radar/briefs.ts` → `rr_ingest()` |
| Outreach prep | Mon ~9:15 | queues approved people and strong (75+) finds, enriches public contacts (≤5 Apollo lookups), drafts per purpose, watches Gmail for sends/replies to approved people |
| Digest | Mon ~10:30 | `rr_digest_email()` → one email to the owner → `rr_mark_digested()` |
| Personal & Career research | Thu ~8:00 | every `personal-*` and `career-*` task |
| Digest | Thu ~10:30 | same digest |

Regenerate the prompts after editing briefs: `npm run routine-prompt -- research sooz` (or `personal,career`,
`outreach`, `digest`) > `routines/<file>.md`.

**Database access for routines.** Routines connect through the Neon connector as `radar_routine`, a role that can only
execute the `rr_*` functions (`drizzle/0003`–`0005`); it cannot read contacts, deals or auth tables. Create it in SQL,
not through the Neon API (API roles join `neon_superuser` and can read everything), on each branch before migrating:
`create role radar_routine login password '<random>';`.

**Moving data from Query** (done once on 2026-10-14; idempotent): `QUERY_DATABASE_URL=… DATABASE_URL=… npm run import:query`.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · Neon Postgres · Drizzle ORM · Better Auth · Vitest

## Setup

1. Create a Neon project with two branches: `main` (production) and `dev` (local). If your Neon account is managed by Vercel, the Neon CLI cannot create projects there; create the database from Vercel instead (Storage → Create Database → Neon), then add a `dev` branch in the Neon console.
2. Copy `.env.example` to `.env.local` and fill in the `dev` branch's pooled and direct connection strings, a `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL`. The file also needs `NEON_BRANCH=dev`, a safety label that confirms `DATABASE_URL` is the Neon dev branch (see the `npm test` row below).
3. Install, migrate, create the owner, run:

```bash
npm install
npm run db:migrate
npm run seed:owner   # interactive: asks for the owner's email, display name and password (entered twice)
npm run dev
```

Public sign-up is closed; the seed script is the only way to create the owner.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Unit tests, plus integration tests that write to the database in DATABASE_URL. They run only when the three env vars are set and `NEON_BRANCH=dev` confirms it is the Neon dev branch; they refuse to run otherwise. Never point `.env.local` at `main`. |
| `npm run reset:owner-password` | Interactive. Sets a new owner password (also repairs a missing credential row) and signs out every session. |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the branch in `DATABASE_URL_UNPOOLED` |

## Deploying (Vercel)

These steps are for you to run; they need your Vercel and Neon accounts.

1. **Database.** Create the production data in the Neon `main` branch. Apply migrations to it with the direct connection string: `DATABASE_URL_UNPOOLED=<main direct string> npm run db:migrate`. Shell variables win over `.env.local`, so this does not touch the `dev` branch.
2. **Owner account.** `DATABASE_URL=<main pooled string> npm run seed:owner` creates the single owner on `main` the same way.
3. **Environment variables.** Set `DATABASE_URL` (pooled), `BETTER_AUTH_SECRET` (a new secret, not the dev one) and `BETTER_AUTH_URL` (the production origin, for example `https://rapport.example.com`) in **both** the Production and Preview scopes, because the build parses them at import. Do **not** set `NEON_BRANCH` in Vercel: it is only a local label for the integration tests. Preview deployments trust their own `VERCEL_URL` and `VERCEL_BRANCH_URL` automatically.
4. **Connecting the Neon store to the Vercel project** makes `vercel env pull` overwrite `.env.local` with the `main` branch URLs. Point `.env.local` back at the `dev` branch and re-add `NEON_BRANCH=dev`, or the integration tests will refuse to run.
5. **Sign-in rate limiting** is stored in the database (`rate_limit` table) so it holds across serverless instances; it is active in production only.
6. **Backups.** Open Settings and export the CSV files now and then. The free Neon restore window is short.
7. **Hobby plan.** Vercel Hobby is for non-commercial personal use; see the risks in the design doc.

## Design

See `docs/superpowers/specs/2026-10-02-crm-overhaul-design.md`. Build plans live in `docs/superpowers/plans/`.
