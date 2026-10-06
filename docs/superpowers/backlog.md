# Backlog

Decisions and deferred work carried over from Phase 1 (Foundation) and the Studio redesign. Each item says where it should land. Read this before writing the Phase 2 plan.

## Done in Phase 2

Reset script, Studio form controls, token test, priority meter, delete-flow tests (contact and company; deal cases below) and card focus rings are done.

## Carried into Phase 3 and 4

- **Deal delete-flow tests (Phase 4).** Add tests with the deal UI: a deal delete clears `activities.deal_id` (schema-level case already tested); contact delete detaches a company deal and removes an angel deal; company delete removes all its deals (tested at the data layer).
- **Companies UI (Phase 4).** Companies have a scoped data layer, validation and delete flow, but no screens; they arrive with the Restaurants and Investors Companies views.
- **Section config and per-section `details` schemas** (`src/lib/sections.ts`) land with the first section that needs them (Phase 4).
- **Contact actions assume the General section.** `saveContactAction` and friends live under `general/`; generalize them (section argument, shared form) when Restaurants and Investors get People views.
- **Owner timezone.** Reminder day counts use elapsed 24-hour periods and the contact page formats dates in UTC, so an evening touch can show tomorrow's date. Add an owner timezone setting (Settings, Phase 5) and use it for both.
- **"Log a touch" is minimal.** The contact page logs a call, email or meeting with a fixed summary; Phase 3 replaces it with the real activity form and timeline.

## Phase 3 (activities, tasks, side panel)

- The Home line "Nothing needs you yet." is static text; make it data-driven once tasks exist.

## Phase 5 (Home, ⌘K, CSV, deploy) — deploy hardening

- Anchor the proxy matcher exclusions in `src/proxy.ts` as `login(?:/|$)` and `api/auth(?:/|$)` (today they match by prefix, for example `/loginfoo`).
- Rate limiting is production-only and in-memory per serverless instance. Switch to `rateLimit.storage: "database"`, generate its table with `npx auth generate`, and add a migration.
- Trusted origins: only `BETTER_AUTH_URL` is trusted, so sign-in from a preview deployment fails the origin check. Set `BETTER_AUTH_URL` per Vercel environment or add a wildcard `trustedOrigins`.
- Seeding production: `DATABASE_URL=<main pooled string> npm run seed:owner` works because shell variables win over `--env-file`. Document it; do not add a flag.
- Vercel needs all four env vars in both Production and Preview scopes, because `src/lib/env.ts` parses at import and `next build` fails without them. **Do not** set `NEON_BRANCH` in Vercel: it is a local safety label for the integration tests.
- When the Neon store is connected to the Vercel project, `vercel env pull` overwrites `.env.local` with the `main` branch URLs. Point `.env.local` back at the `dev` branch and re-add `NEON_BRANCH=dev`; the integration tests refuse to run otherwise.
- Tune the `pg` pool for Vercel Fluid compute (`attachDatabasePool`, short idle timeouts) at deploy time.
- Decide how CI treats skipped integration suites (they skip silently when no database is configured).
- Add shadcn `sidebar` / `chart` tokens back only if the dashboard needs those components.
- Cleanup: delete the unused `public/*.svg` files and add `"engines": { "node": ">=22" }`.

## Later polish

- Windows high-contrast mode (`forced-colors`): the desktop active bar (a background) and the phone active ring (a box-shadow) disappear. Add a `forced-colors` outline or border.
- Safe area: set `viewport-fit=cover`, give `MobileHeader` a top inset, and change the tab bar to `bottom-[calc(env(safe-area-inset-bottom)+0.75rem)]` when the app is installed to a home screen.
- The primary Button's focus indicator is only about 2.9:1 (dark) because its border and fill share one color; consider a stronger ring.
- Extract an `IconChip` component when the icon-in-tinted-circle pattern gets a third use.
- Greeting fallback reads "Welcome back, there" if the account has no name (cosmetic).

## Operational notes

- The Neon account is managed by Vercel, so the Neon CLI cannot create projects there. Create databases from Vercel (Storage → Create Database → Neon, or `vercel integration add neon --no-connect`), then add a `dev` branch.
- An older, unrelated Neon project (`neon-rose-plank`) and an older GitHub repo (`Risus-Pieces/personal-crm`, the previous Supabase-based app) exist; leave them alone or archive them deliberately.
- Visual checks without a browser extension: drive headless Google Chrome over the DevTools protocol against the dev server, signed in as a throwaway user that is deleted afterwards. (The script lived in `node_modules/.cache/visual-check/` and is not part of the repo.)
