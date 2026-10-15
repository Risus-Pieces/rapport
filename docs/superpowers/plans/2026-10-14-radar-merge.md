# Radar in Rapport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Query's research radar and outreach into Rapport so approved people land directly in the CRM, then retire Query.

**Architecture:** New Drizzle tables (`radar_items`, `radar_runs`, `outreach`, `network`, `app_settings`) plus a custom SQL migration holding the `rr_*` functions the routines call (ports of Query's `oq_*`, `SECURITY DEFINER`, owner resolved in SQL). Approval is a TypeScript transaction that creates Rapport contacts/companies/deals. Outreach effects (activity, follow-up task, stage move) live in one SQL function used by both the UI and the Gmail-watching routine.

**Tech Stack:** Next.js 16.3 App Router, TypeScript, Drizzle ORM 0.45 on Neon Postgres, Better Auth, Tailwind v4 + shadcn, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-radar-merge-design.md`. Source being ported: `/Users/risus_zhao/Desktop/Apps/Query` (read-only reference; `lib/types.ts`, `lib/dedupe.ts`, `lib/briefs.ts`, `lib/routine.ts`, `lib/outreach.ts`, `lib/import.ts`, `db/schema.sql`, `tests/*`).

## Global Constraints

- Read `node_modules/next/dist/docs/` for any Next.js API before using it (AGENTS.md). Follow Rapport patterns: `requireSession()` in every page/action, every query takes `userId`, server actions in `src/app/actions/` or the route's `actions.ts`, `revalidatePath("/", "layout")` after writes.
- Feeds: `sooz`, `personal`, `career`. Kinds and person kinds exactly as Query `lib/types.ts` (person kinds: angel, celebrity, nextgen, creator, buyer, media). Purposes: invest, ambassador, buyer, press, intro; defaults angel/nextgen→invest, celebrity/creator→ambassador, buyer→buyer, media→press.
- Dedupe keys identical to Query's (`angel:<slug>[:<slug firm>]`, `<kind>:<slug>[:<slug first firm>]`, `<feed>:url:<norm>`, `<feed>:<kind>:<slug>:<date>`), so imported rows keep their keys.
- Pre-draft threshold: score ≥ 75. Apollo ≤ 5 lookups per run. Digest only to `boxuanzhao1128@gmail.com`. Follow-ups at +5 then +7 days, max 3 touches.
- Rapport production DB: project `little-lake-33520023`, branch `br-spring-unit-b86mju41`, database `neondb`. Dev (tests): branch `br-misty-wildflower-b8jxwulh`. Query DB (read-only source): project `green-hall-60323582`, branch `br-billowing-band-an46gq84`, database `opportunity_query`. Never modify Query's DB; never touch other Neon projects.
- Routine DB role: `radar_routine`, EXECUTE on `rr_*` only.
- Never send messages automatically; drafts and Gmail compose links only.
- Commit after each task with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer. Work on branch `radar`.

## Review Focus

1. Approving the same finding twice (double click, two tabs) must not create duplicate contacts/deals — approve is idempotent under a row lock.
2. Approving a buyer at a company that already exists in Restaurants (e.g. a second H-E-B buyer) reuses the company and its open deal.
3. A finding whose CRM contact was later deleted: radar item keeps `approved` with null ids; its card must show "Approve again" rather than a broken "In CRM" link.
4. Hostile text in findings (HTML, `$oq$`, SQL fragments) must stay inert in the radar UI, the digest HTML and Gmail compose links.
5. Routine role must not read CRM or auth tables even though functions it calls do.

Each line has a test in the owning task (Tasks 3, 4, 4, 2/3, 7).

---

### Task 1: Branch, dev database env, pure radar library

**Files:**
- Create: `.env.local` (gitignored), `src/lib/radar/types.ts`, `src/lib/radar/dedupe.ts`, `src/lib/radar/dedupe.test.ts`, `src/lib/radar/briefs.ts`, `src/lib/radar/briefs.test.ts`, `src/lib/radar/drafts.ts`, `src/lib/radar/drafts.test.ts`

**Interfaces — Produces:**
- `types.ts`: `FEEDS`, `type Feed`, `RADAR_STATUSES = ["new","seen","saved","dismissed","approved"]`, `PERSON_KINDS`, `isPersonKind`, `KINDS: Record<Feed, readonly string[]>`, `PURPOSES`, `type Purpose`, `isPurpose`, `defaultPurpose(kind)`, `interface RadarDetails {firm, role, rice_connection, check_size, contact_path}`, `interface Candidate`, `crmTargetFor(kind): "investors" | "restaurants" | "general" | null`.
- `dedupe.ts`: `normalizeUrl`, `slug`, `firstFirm`, `dedupeKey({feed, kind, title, url, event_date, firm})` — port of Query `lib/dedupe.ts` with `section`→`feed`.
- `briefs.ts`: `ResearchTask` (with `feed`), `TASKS` (all 21 Query tasks, `section`→`feed`), `PROFILES: Record<Feed,string>`.
- `drafts.ts`: `templateDrafts(p, pitch): Drafts`, `type Pitch`, `PITCH_FIELDS`, `missingPitch`, `gmailComposeUrl`, `linkedinSearchUrl` — port of Query `lib/outreach.ts` drafting/helpers (no DB).

- [ ] **Step 1:** `git checkout -b radar`. Get the dev branch pooled + direct connection strings (Neon MCP `get_connection_string`, project `little-lake-33520023`, branch `br-misty-wildflower-b8jxwulh`, database `neondb`; direct = same host without `-pooler`), write `.env.local` with `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL=http://localhost:3000`, `NEON_BRANCH=dev` (umask 077; never print values). Run `npm install && npm test` — record the baseline pass count.
- [ ] **Step 2: Port tests first.** `dedupe.test.ts` = Query `tests/dedupe.test.ts` with `section`→`feed`. `briefs.test.ts` = the "research tasks" block of Query `tests/routine.test.ts` (unique ids, kinds valid per feed, all new task ids present, people rules, career profile, `KINDS.personal` lacks `job`) plus `crmTargetFor`: angel/nextgen→investors, buyer→restaurants, celebrity/creator/media→general, event→null. `drafts.test.ts` = the `templateDrafts`/`templateDrafts by purpose`/helpers blocks of Query `tests/outreach.test.ts` that need no DB.
- [ ] **Step 3:** Run `npx vitest run src/lib/radar` — FAIL (modules missing).
- [ ] **Step 4:** Implement the four modules by porting Query code (rename `section`→`feed`, `Section`→`Feed`; drop DB imports from `drafts.ts`).
- [ ] **Step 5:** `npx vitest run src/lib/radar && npm run typecheck` — PASS.
- [ ] **Step 6:** Commit `feat(radar): types, dedupe, briefs and draft templates`.

### Task 2: Radar tables and ingest SQL

**Files:**
- Modify: `src/db/schema.ts` (new tables), `drizzle/` (generated `0002_radar_tables.sql`, custom `0003_radar_functions.sql`)
- Test: `tests/integration/radar-ingest.test.ts`

**Interfaces — Produces (tables, Drizzle names in camelCase):**
- `radarItems` (`radar_items`): columns per spec, `feed` text check in (sooz, personal, career), `status` text default `new` check in `RADAR_STATUSES`, `score` int check 0–100, unique `(user_id, dedupe_key)`, FKs `contact_id`/`company_id`/`deal_id` `on delete set null`, index `(user_id, feed, status)`.
- `radarRuns` (`radar_runs`), `network` (unique `(user_id, dedupe_key)`, `company_key` index), `appSettings` (`app_settings`, pk `(user_id, key)`).
- `outreach`: pk `id`, `radar_item_id` unique FK cascade, `contact_id`/`deal_id` set null, fields per spec, `purpose` check, `stage` check in (prospect, drafted, sent, replied, closed).
- SQL (in `0003`): `rr_owner() returns text` (the only `"user".id`; raise `'expected exactly one owner'` otherwise), `rr_slug`, `rr_norm_url`, `rr_date`, `rr_is_person`, `rr_default_purpose`, `rr_dedupe_key(feed, kind, title, url, date, firm)`, `rr_ingest(p_feed, p_task, p_kinds text[], p_upcoming bool, p_findings jsonb, p_user text default rr_owner()) returns jsonb`, `rr_known_titles(p_feed, p_user default rr_owner()) returns jsonb` (array of 150 newest titles). Functions are `security definer set search_path = public`. End of file: `revoke all on function ... from public`; if role `radar_routine` exists, `grant execute` on the routine-callable `rr_*` functions to it.

- [ ] **Step 1: Write the failing test** — port Query `tests/sql.test.ts` "parity with lib/dedupe.ts" and "oq_ingest" blocks to `rr_*` with `p_user` = a test user created in `beforeAll` (pattern from `tests/integration/deals.test.ts`), compared against `src/lib/radar/dedupe.ts`. Add: `rr_ingest` never changes `status`, `notes`, `contact_id` of an `approved` row on refresh; `rr_owner()` raises when two users exist (insert a second temp user inside a transaction and roll back); hostile title `'$oq$'); drop table radar_items; --'` is stored verbatim.
- [ ] **Step 2:** `npx vitest run tests/integration/radar-ingest.test.ts` — FAIL.
- [ ] **Step 3:** Add the Drizzle tables, `npm run db:generate -- --name radar_tables`, then `npx drizzle-kit generate --custom --name radar_functions` and write the functions (port `oq_*` from Query `db/schema.sql`, scoping every read/write by `p_user`). `npm run db:migrate` (applies to dev via `.env.local`).
- [ ] **Step 4:** Run the test — PASS. `npm test` — baseline + new all pass.
- [ ] **Step 5:** Commit `feat(radar): tables and rr_ingest`.

### Task 3: Outreach and digest SQL

**Files:**
- Modify: `drizzle/0003_radar_functions.sql` (or a new `0004_radar_outreach.sql` custom migration if 0003 is already applied anywhere but dev — prefer a new file)
- Test: `tests/integration/radar-outreach.test.ts`

**Interfaces — Produces (all `security definer`, trailing `p_user text default rr_owner()`):**
- `rr_outreach_queue(p_min_score int) returns int` — inserts outreach rows (purpose = `rr_default_purpose(kind)`) for feed `sooz` person items not `dismissed` and either `approved` or `score >= p_min_score`.
- `rr_outreach_todo(p_limit int) returns jsonb` — `{pitch, prospects[]}`; prospect fields as Query plus `approved bool`, `contact_id`; one person per first firm; approved first, then score desc; only stage `prospect`.
- `rr_outreach_save(p_item uuid, p jsonb) returns jsonb` — Query `oq_outreach_save` semantics; when the item is approved, also fills the contact's empty `email` / `linkedin_url`.
- `rr_outreach_watch() returns jsonb` — approved items only, stage `drafted`/`sent`, email present.
- `rr_outreach_record(p_item, p_event text, p_at timestamptz) returns text` — the single effect function: `'sent'` (from drafted/prospect: stage sent, touches 1, next_followup_at +5d, `email` activity "Sent intro email", task "Follow up with <name>" due +5d, first-stage deal moves one stage: investors `target`→`intro`, restaurants `lead`→`contacted`), `'followup'` (touches+1, activity, next task +7d, none after 3 touches), `'replied'` (stage replied, activity "Replied", open follow-up tasks for that contact titled "Follow up with <name>" marked done), `'closed'`. Returns `'ok'|'ignored'|'not approved'|'not found'`. Activities/tasks get `user_id`, contact and deal ids.
- `rr_outreach_observe(p_item, p_event, p_at)` — routine wrapper: only `sent`/`replied`, only approved items, delegates to `rr_outreach_record`.
- `rr_digest_email(p_min_score int, p_base_url text) returns jsonb` and `rr_mark_digested(p_ids uuid[]) returns int` — Query versions with `feed`, links to `<base>/radar`, outreach block counts: approved drafts ready, pre-drafts waiting for approval, follow-ups due, new replies.

- [ ] **Step 1: Write failing tests** — port Query's "routine functions" and "oq_digest_email" tests; add: queue includes approved people below 75 and unapproved ≥ 75 only; watch/observe ignore unapproved items (`'not approved'`); `record('sent')` creates exactly one email activity, one task due +5d and moves an investors deal from target to intro but leaves a deal already at `pitched` alone; three touches then no new task; `replied` closes the open follow-up task; digest HTML escapes `<script>` in titles and URLs (Review Focus 4); the stage keys used in SQL equal `PIPELINES[...].stages[0..1]` from `src/lib/sections.ts`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement, `npm run db:migrate`. **Step 4:** Run — PASS; `npm test` all pass.
- [ ] **Step 5:** Commit `feat(radar): outreach and digest SQL`.

### Task 4: Approve a finding into the CRM

**Files:**
- Create: `src/db/queries/radar.ts`
- Test: `tests/integration/radar-approve.test.ts`

**Interfaces — Produces:**
- `approveRadarItem(userId: string, itemId: string): Promise<{ section: "investors"|"restaurants"|"general"; contactId: string; companyId: string | null; dealId: string | null; href: string }>` — throws `RadarError` for non-people / non-sooz / missing item.
- `class RadarError extends Error`.

- [ ] **Step 1: Write failing tests:** angel → investors angel deal at `target` with contact only and `details.investorType = "angel"`, contact `details.background` = summary and `details.radar.sourceUrl` = url; nextgen same; buyer → restaurants company named first firm + contact with `companyId` + one `lead` deal; second buyer at the same firm (different case) reuses company and does not add a deal (Review Focus 2); celebrity/creator/media → general contact `priority = "high"`, no deal; existing same-name contact in the target section is linked, not duplicated; outreach email/LinkedIn copied to the contact; a `note` activity "Added from Radar"; item becomes `approved` with ids; calling twice concurrently (`Promise.all`) yields one contact and one deal (Review Focus 1, use `select ... for update` on the item); item whose contact was deleted (ids null, status approved) can be approved again (Review Focus 3); event kind throws `RadarError`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement with `db.transaction`, reusing `firstStage`, `compactDetails`, `checkInvestorParties`; insert rows directly in the transaction (do not call the non-transactional create helpers). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(radar): approve findings into the CRM`.

### Task 5: Radar reads, settings, network and CSV import

**Files:**
- Modify: `src/db/queries/radar.ts`, `src/db/queries/export.ts`, `src/db/queries/search.ts`
- Create: `src/lib/radar/import.ts` (+ `import.test.ts`)
- Test: `tests/integration/radar-queries.test.ts`

**Interfaces — Produces (in `radar.ts`):**
- `listRadar(userId, {feed, view: "inbox"|"saved"|"approved"|"dismissed", kind?, q?, rice?, sort: "score"|"date"|"newest"})` → rows with `outreach` summary (`stage`, `hasDraft`); inbox hides past-dated items (as Query).
- `radarCounts(userId, feed)`, `radarNewCounts(userId): Record<Feed, number>`, `radarKindCounts(userId, feed, view)`, `recentRadarRuns(userId)`.
- `setRadarStatus(userId, id, status: "seen"|"saved"|"dismissed")` (never touches `approved`), `setRadarNotes`, `markFeedSeen`.
- `getOutreachFor(userId, {contactId?, dealId?})`, `getOutreachForItem(userId, itemId)`, `saveOutreachEdits(userId, outreachId, DraftEdit)`, `setOutreachPurpose`, `recordOutreach(userId, outreachId, event)` (calls `rr_outreach_record` with `p_user`).
- `getPitch(userId)`, `savePitch(userId, Pitch)`, `importConnections(userId, Connection[])`, `warmMatches(userId, itemIds)`.
- `import.ts`: `parseProspectCsv(text)`, `parseLinkedInConnections(text)` — ports of Query; `importPeopleToRadar(userId, text)` goes through `rr_ingest` (feed sooz, task `import`, person kinds) and applies purpose/LinkedIn/email to outreach rows.
- Export kind `radar` (radar_items columns); search includes radar items (`href: /radar?feed=…&q=…`).

- [ ] **Step 1:** Port Query tests for CSV parsing (pure, `import.test.ts`) and for warm matches / connections / import (integration); add list filter tests (inbox hides past events, rice filter, kind filter) and that `setRadarStatus` refuses to change an approved item.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm test`).
- [ ] **Step 5:** Commit `feat(radar): queries, pitch, network and CSV import`.

### Task 6: Radar page, approve action, navigation, home

**Files:**
- Create: `src/app/(app)/radar/page.tsx`, `src/app/(app)/radar/actions.ts`, `src/components/radar/radar-card.tsx`, `src/components/radar/feed-tabs.tsx`
- Modify: `src/lib/nav.ts` (+ `nav.test.ts`), `src/components/sidebar.tsx`, `src/components/bottom-tabs.tsx` (grid cols 6), `src/app/(app)/page.tsx`, `src/lib/palette.ts` if needed

**Interfaces — Consumes:** Task 4/5 functions. **Produces:** `approveRadarAction(formData)` → redirects to `href`; `radarStatusAction`, `radarNotesAction`, `seeAllRadarAction`.

- [ ] **Step 1:** Update `nav.test.ts`: `PRIMARY_NAV` hrefs are `/`, `/radar`, `/restaurants`, `/investors`, `/general`, `/tasks`. Run — FAIL.
- [ ] **Step 2:** Add the Radar nav item (lucide `Radar` icon), page (feed tabs Sooz people · Sooz · Personal · Career; Query's view/kind/rice/sort filters as links; card with score, badges, summary, why, facts, Approve / In CRM / Approve again, Save, Dismiss/Restore, notes, "Draft ready" badge and read-only draft preview), sidebar count of new items, home "Radar" card (new finds per feed, drafts ready, link). Use existing shadcn `Card`/`Button`/`Badge` and section colors; escape nothing manually (React does).
- [ ] **Step 3:** `npm test && npm run typecheck && npm run lint && npm run build` — PASS. Run the dev server against the dev branch, sign in with a dev owner (create one with `npm run seed:owner` on dev if none; record its test credentials only in `.env.local` comments, never in chat), approve one seeded angel and one buyer, and screenshot `/radar` and the resulting deal page.
- [ ] **Step 4:** Commit `feat(radar): radar page, approve, nav and home`.

### Task 7: Outreach panel, settings, routine role

**Files:**
- Create: `src/components/radar/outreach-panel.tsx`, `src/app/actions/outreach.ts`
- Modify: `src/components/pipeline/deal-detail.tsx`, `src/app/(app)/general/[id]/page.tsx`, `src/app/(app)/settings/page.tsx`
- Test: `tests/integration/radar-role.test.ts`

- [ ] **Step 1: Failing test (Review Focus 5):** if role `radar_routine` exists: `has_table_privilege('radar_routine', t, 'select')` is false for `contacts`, `deals`, `user`, `session`, `account`, `radar_items`, `outreach`; `has_function_privilege('radar_routine', 'rr_ingest(...)', 'execute')` true for every routine-callable function; skip with a message when the role does not exist.
- [ ] **Step 2:** Create the role on dev and main with Neon MCP `create_postgres_role` (name `radar_routine`), re-run `npm run db:migrate` grants (make the grant block a re-runnable custom migration `0005_radar_grants.sql` if needed). Run — PASS.
- [ ] **Step 3:** Outreach panel (shown when `getOutreachFor` finds a row): purpose select, editable drafts (Query's edit grid), Draft from template, Open in Gmail, Copy LinkedIn note, Ask for intro, Mark sent / Follow-up sent / They replied / Not pursuing (→ `recordOutreach`), warm matches, Reg D / FTC / NIL fine print. Settings: Pitch facts, LinkedIn connections import, Import people to Radar, Radar export button.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run lint && npm run build`; in the browser, mark sent on the approved angel and confirm the activity, task and stage move appear.
- [ ] **Step 5:** Commit `feat(radar): outreach panel, settings, routine role`.

### Task 8: Routine prompts

**Files:**
- Create: `src/lib/radar/routine.ts`, `src/lib/radar/routine.test.ts`, `scripts/routine-prompt.ts`, `routines/research-sooz.md`, `routines/research-personal-career.md`, `routines/outreach.md`, `routines/digest.md`
- Modify: `package.json` (`"routine-prompt": "tsx scripts/routine-prompt.ts"`)

**Interfaces — Produces:** `buildResearchRoutinePrompt(feeds, homeBase)`, `buildOutreachRoutinePrompt({apolloBudget, minScore})`, `buildDigestRoutinePrompt(to, baseUrl)`; `DB = {project: "little-lake-33520023", branch: "br-spring-unit-b86mju41", database: "neondb", role: "radar_routine"}`.

- [ ] **Step 1:** Port Query `tests/routine.test.ts` "routine prompts" block with: every `run_sql` instruction includes `role_name="radar_routine"`; research shapes are `select rr_known_titles('<feed>')` and `select rr_ingest(...)`; outreach lists `rr_outreach_queue(75)`, `rr_outreach_todo(8)`, `rr_outreach_save`, `rr_outreach_watch`, `rr_outreach_observe`, says pre-drafts are for unapproved people too and Gmail watch covers approved people only; digest uses `rr_digest_email(55, 'https://rapport-liard.vercel.app')` and `rr_mark_digested`.
- [ ] **Step 2–4:** FAIL → port `lib/routine.ts` → PASS; generate the four `routines/*.md`.
- [ ] **Step 5:** Commit `feat(radar): routine prompts`.

### Task 9: Ship and move the data

- [ ] **Step 1:** Write `scripts/import-query.ts` (+ `tests/integration/import-query.test.ts` using a fixture shaped like Query's tables in a temp schema): reads `QUERY_DATABASE_URL`, writes via Drizzle for the owner (`rr_owner()`), idempotent on `dedupe_key`; refuses if Query has `contacted` items or outreach past `drafted`; carries enriched outreach only; prints counts.
- [ ] **Step 2:** Apply migrations to production: `DATABASE_URL_UNPOOLED=<main direct> npm run db:migrate` (connection string from Neon MCP, not printed).
- [ ] **Step 3:** Run the import against production; check counts against Query (115 items, 6 dismissed, 1 saved; 4 enriched outreach rows).
- [ ] **Step 4:** Push `radar`, open a PR, wait for checks/build, merge to `main` (Vercel deploys Rapport from git). Verify the production deployment is READY, `/radar` loads behind sign-in, and `select rr_known_titles('sooz')` works through Neon MCP with `role_name="radar_routine"`.
- [ ] **Step 5:** Update the five desktop scheduled tasks' prompts to read `/Users/risus_zhao/rapport/routines/*.md` and use the Rapport database/role; run the outreach prep task once.
- [ ] **Step 6:** Retire Query: deploy a redirect-only build of opportunity-query (every path → `https://rapport-liard.vercel.app/radar`), add a "Retired — see Rapport" note to Query's README, push. Update Rapport README (Radar, routines, import script).
