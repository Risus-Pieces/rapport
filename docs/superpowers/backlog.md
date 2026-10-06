# Backlog

Decisions and deferred work carried over from Phase 1 (Foundation) and the Studio redesign. Each item says where it should land. Read this before writing the Phase 2 plan.

## Phase 2 (contacts, companies, General) — do these first

1. **`scripts/reset-owner-password.ts`.** The spec promises a password-reset script and none exists; there is no change-password screen either. Implement it as an upsert of the owner's `credential` account row, so it also repairs a user left without a credential by the non-atomic `createOwner`. Do this before any real data is entered.
2. **Studio form controls.** Restyle the components the redesign left alone, following `## Studio design rules` in the spec: `textarea.tsx` and `select.tsx` (stale `bg-input` fills, `h-8`, `rounded-lg`, translucent ring), `dialog.tsx` (`rounded-xl`, close button below 44px), `dropdown-menu.tsx` (`shadow-md`; `focus:bg-accent` is only 1.23:1, so add an inset ring or outline), and the Sonner default shadow. Controls should be `h-11 rounded-xl border-input bg-secondary text-base` with the opaque 2px ring.
3. **Token test.** Add a test that reads `src/app/globals.css` and asserts every `--color-section-*` mapping and its value in both themes exists. It replaces the weak "maps each style" assertion in `src/lib/nav.test.ts`.
4. **Priority meter.** Four steps, on-steps `bg-primary`, off-steps `bg-accent`, always with a text label. Priority never uses color hues (color belongs to sections).
5. **Delete-flow tests, written with the delete flows themselves.** A contact or company that still has deals is refused; deleting a deal clears `activities.deal_id` and keeps the activity; `contacts.company_id` and `tasks.*` become null; deleting a company cascades its activities. (Deal-specific cases land in Phase 4.)
6. **Card focus rings.** `Card` has `overflow-hidden`; full-bleed list rows inside a card need padding or an `overflow-visible` card so focus rings are not clipped.

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
