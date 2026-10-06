# Backlog

Decisions and deferred work carried over from Phase 1 (Foundation) and the Studio redesign. Each item says where it should land. Read this before writing the Phase 2 plan.

## Done in Phase 2

Reset script, Studio form controls, token test, priority meter, delete-flow tests (contact and company; deal cases below) and card focus rings are done.

## Carried into Phase 3 and 4

- **Deal delete-flow tests (Phase 4).** Add tests with the deal UI: a deal delete clears `activities.deal_id` (schema-level case already tested); contact delete detaches a company deal and removes an angel deal; company delete removes all its deals (tested at the data layer).
- **Companies UI (Phase 4).** Companies have a scoped data layer, validation and delete flow, but no screens; they arrive with the Restaurants and Investors Companies views.
- **Section config and per-section `details` schemas** (`src/lib/sections.ts`) land with the first section that needs them (Phase 4).
- **Contact actions assume the General section.** `saveContactAction` and friends live under `general/`; generalize them (section argument, shared form) when Restaurants and Investors get People views.
- **Owner timezone (also tasks).** Task grouping, "Overdue" on tasks and the "Today" list use the UTC date, so from late afternoon in US time zones a task due today reads overdue and tomorrow's tasks read as today. The future-date check on activities also uses the UTC date.
- **Owner timezone.** Reminder day counts use elapsed 24-hour periods and the contact page formats dates in UTC, so an evening touch can show tomorrow's date. Add an owner timezone setting (Settings, Phase 5) and use it for both.
- **"Log a touch" is minimal.** The contact page logs a call, email or meeting with a fixed summary; Phase 3 replaces it with the real activity form and timeline.

## Done in Phase 3

Activities (full form, quick-log buttons, timeline with delete), tasks (page, per-contact tasks, complete/reopen/delete, grouped by due date) and a data-driven Home "Today" card are done.

## Done in Phase 4

Restaurants and Investors sections: pipeline board (drag between stages, optimistic with rollback), list, people and companies views, add/edit forms, deal pages (next step, tasks, activity log, timeline, people), the angel/institution rule with a stored type and All / Angels / Institutions filter, and delete flows (the delete button removes the restaurant or investor with its deals; see the confirmation text).

## Carried into Phase 5

- **Side panel still not built.** Deals and contacts open on their own pages (linkable, back button works). Decide whether a panel over the board is worth it after using the app.
- **Keyboard moves on the board** rely on dnd-kit's keyboard sensor; the Stage select on the edit page is the reliable non-pointer path. Test with a screen reader.
- **People and Companies views are read-only lists.** Add people from a deal's page; there is no standalone person form for Restaurants or Investors, and no way to move a contact between companies.
- **Investor type cannot be changed after creation** (it would break the party rule). To fix a mistake, delete and re-add.
- **Deal activities do not feed follow-up reminders** for the linked contact (reminders count activities logged on the contact itself).

## Carried from Phase 3

- **Side panel.** The spec's `?open=<kind>:<id>` panel is deferred: contacts keep dedicated routes. Build the panel with the deals board, where context switching matters, and decide then whether contact pages move into it.
- **Task creation on the Tasks page** cannot pick a contact; attach tasks from a contact page. Add a contact picker with the ⌘K palette work.
- **Task and activity edit** (rename, change due date, edit summary) is not built; delete and re-add for now.
- Activities and tasks for companies and deals arrive with their screens; the data layer already accepts them.

## Done in Phase 5

Home pipeline snapshot and recent activity, ⌘K search and jump, CSV export for every table and contact import, Settings page, anchored proxy matcher, database-backed rate limiting (migration 0001), Vercel preview trusted origins, `engines`, unused svgs removed, deploy steps in the README.

## Still open (owner or later)

- **Deploy itself** (Vercel project, Neon main migration, env vars, domain) is owner-only; see the README.
- Tune the `pg` pool for Vercel Fluid compute (`attachDatabasePool`, short idle timeouts) once deployed and measured.
- Decide how CI treats skipped integration suites (there is no CI yet; they skip silently without a database).
- Add shadcn `sidebar` / `chart` tokens back only if a later screen needs those components.
- CSV import covers contacts only; companies and deals can be exported but not re-imported. Importing restaurants and investors needs a design (company matching, stage mapping, angel/institution type).
- Owner timezone setting (see the timezone items above).
- Standalone person form and moving a person between companies for Restaurants and Investors.

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
