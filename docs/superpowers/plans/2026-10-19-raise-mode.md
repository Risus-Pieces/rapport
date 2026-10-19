# Raise Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rapport's Radar into a weekly, low-effort pre-seed raise workflow: a Monday shortlist with drafted asks, one-click approval, drafts delivered to Gmail Drafts, advice-call tracking, monthly updates and a launch ask.

**Architecture:** Two new tables (`shortlist`, `outreach_messages`) plus an `outreach.gmail_ok` flag. Existing hand-added CRM investors get a synthetic radar item (`task_id = 'crm'`) so every outreach row still keys on a radar item. New `rr_*` SECURITY DEFINER functions serve the routines (shortlist, Gmail push/watch, updates, launch asks); the app adds a `/week` page, advice-call flag, raise settings and progress.

**Tech Stack:** Next.js 16.3 App Router, TypeScript, Drizzle 0.45 on Neon Postgres, Vitest (integration on the Neon dev branch).

**Spec:** `docs/superpowers/specs/2026-10-19-raise-mode-design.md` (builds on `2026-10-14-radar-merge-design.md`).

## Global Constraints

- Raise target default 75000 (USD); phases `building` | `raising`; settings live in `app_settings` keys `raise.target`, `raise.launch_date`, `raise.phase`, `month.progress`, `month.ask`, `month.next`.
- Weekly shortlist size: 4 investors (kinds angel, nextgen) + 2 buyers (kind buyer). Skipped people are not re-proposed for 56 days.
- First notes never mention the round, amount, instrument or terms. Launch asks and monthly updates go only to investors whose deal has `details.adviceCallAt`.
- Follow-ups: day 5 then +7 days, max 3 touches (existing). Launch ask: one follow-up after 7 days. Monthly updates: no follow-ups.
- Never send email automatically; the routine only calls Gmail `create_draft` and read/search tools. One Gmail draft per message (unique per outreach row + kind + period).
- Routines run as `radar_routine`; every new routine-callable function gets EXECUTE in a re-runnable grants migration.
- Work on branch `raise-mode`; commit per task with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.

## Review Focus

1. Approving the shortlist twice (double submit) must not create duplicate CRM records or flip skipped rows back — idempotent per (week, item).
2. A person already emailed by hand (deal past Target, or a sent activity) must never get a first-touch Gmail draft.
3. Gmail push retried after a partial failure must not create a second draft for the same message.
4. A launch ask or monthly update must never be queued for an investor without `adviceCallAt`, even if the routine asks for it.
5. Changing the launch date or target with garbage input (empty, negative, non-number) keeps the previous valid value.

Each line has a test in the owning task (Tasks 2, 1, 3, 3, 4).

---

### Task 1: Data model and CRM investor sync

**Files:** Modify `src/db/schema.ts`; create `drizzle/0006_raise_tables.sql` (generated) and `drizzle/0007_raise_functions.sql` (custom); test `tests/integration/raise-sync.test.ts`.

**Interfaces — Produces:**
- `shortlist` table: `id uuid`, `user_id`, `week date` (Monday), `radar_item_id uuid` FK cascade, `bucket text` check in (`investor`,`buyer`), `rank int`, `reason text`, `ask text`, `status text` check in (`proposed`,`approved`,`skipped`) default `proposed`, timestamps; unique `(user_id, week, radar_item_id)`.
- `outreach_messages` table: `id uuid`, `user_id`, `outreach_id uuid` FK cascade, `kind text` check in (`first`,`followup_1`,`followup_2`,`update`,`launch_ask`,`launch_followup`), `period text not null default ''`, `subject`, `body`, `status text` check in (`ready`,`in_gmail`,`sent`,`replied`,`skipped`) default `ready`, `gmail_draft_id`, `gmail_thread_id`, `pushed_at`, `sent_at`, `replied_at`, timestamps; unique `(outreach_id, kind, period)`.
- `outreach.gmail_ok boolean not null default false`.
- SQL `rr_sync_crm_investors(p_user text default rr_owner()) returns int`: for each non-archived investors contact with no radar item linked (`radar_items.contact_id`), insert a radar item (feed `sooz`, kind `angel`, title = contact name, url null, score 70, status `approved`, `task_id 'crm'`, dedupe_key `crm:<contact_id>`, contact_id, deal_id = their open investors deal) and an outreach row (purpose `invest`, contact/deal ids). If that deal's stage is past `target`, or the contact has an `email` activity, the outreach row is `stage 'sent'`, `touches 1`, `next_followup_at null`. Returns rows inserted. Idempotent.

- [ ] **Step 1: Failing tests** (`raise-sync.test.ts`, per-test owner pattern from `radar-outreach.test.ts`): hand-added investor contact with a Target deal → one approved radar item `task_id='crm'` linked to contact+deal and an outreach row `prospect`; contact whose deal is at `intro` → outreach `sent`, touches 1, no follow-up date (Review Focus 2); contact with an `email` activity but deal at target → `sent`; contact already linked from a Radar approval → nothing new; run twice → second returns 0; General contacts and archived investors ignored.
- [ ] **Step 2:** `npx vitest run tests/integration/raise-sync.test.ts` → FAIL (function missing).
- [ ] **Step 3:** Add tables to `schema.ts`, `npm run db:generate -- --name raise_tables`, `npx drizzle-kit generate --custom --name raise_functions`, write `rr_sync_crm_investors` (SECURITY DEFINER, `search_path = public, pg_temp`, revoke from public), `npm run db:migrate`.
- [ ] **Step 4:** Test → PASS; `npx vitest run` all pass.
- [ ] **Step 5:** Commit `feat(raise): shortlist and message tables, CRM investor sync`.

### Task 2: Weekly shortlist (SQL + approval)

**Files:** Modify `drizzle/0007_raise_functions.sql` (or add `0008_…` if 0007 was applied to production — never edit an applied migration); create `src/db/queries/raise.ts`; test `tests/integration/raise-shortlist.test.ts`.

**Interfaces — Produces:**
- `rr_week_start(d date) returns date` (ISO Monday).
- `rr_shortlist_candidates(p_user default rr_owner()) returns jsonb`: `{week, phase, raise:{target, launch_date}, pitch:{...}, investors:[...], buyers:[...]}`; candidates are sooz items of kind angel/nextgen (investors) or buyer (buyers), not dismissed, with no `shortlist` row for the current week, no `skipped` row in the last 56 days, and either not in the CRM or in the CRM with outreach stage `prospect`/`drafted` and `gmail_ok = false`; each with radar_item_id, name, kind, approved, score, summary, why_relevant, details, tags, warm_paths (`network` matches by firm key plus General contacts whose company name matches a firm key: `{name, via}`). Calls `rr_sync_crm_investors` first.
- `rr_shortlist_set(p_rows jsonb, p_user default rr_owner()) returns int`: rows `{radar_item_id, bucket, rank, reason, ask}`; replaces this week's `proposed` rows (never touches `approved`/`skipped`); caps 4 investor + 2 buyer rows; ensures an outreach row (default purpose) for each; ignores ids that are not candidates.
- Drop `rr_outreach_queue(int, text)`; new `rr_outreach_queue(p_user default rr_owner()) returns int`: outreach rows for this week's shortlist and approved items (no score clause). `rr_outreach_todo` adds `shortlist_ask` and `shortlisted bool`, orders shortlisted first.
- TS `listShortlist(userId, week?: string): Promise<ShortlistRow[]>` (row = shortlist + item title/kind/details/summary + outreach subject/body) and `approveShortlist(userId, week: string, approveIds: string[]): Promise<{approved: number; skipped: number}>`: each id in `approveIds` → `approveRadarItem` (if not in CRM), status `approved`, `outreach.gmail_ok = true`; every other `proposed` row of that week → `skipped`.

- [ ] **Step 1: Failing tests:** candidates exclude dismissed, skipped-within-56-days, already-shortlisted-this-week and people with `gmail_ok`; include a hand-added CRM investor (via sync) with warm path from a General contact at the same firm; `rr_shortlist_set` keeps 4+2 max and ignores a non-candidate id; `approveShortlist` approves checked rows into the CRM with `gmail_ok`, skips the rest; calling it twice changes nothing (Review Focus 1); a skipped person is not a candidate next week but is again after 57 days (insert a backdated shortlist row).
- [ ] **Step 2–4:** FAIL → implement → PASS; full suite.
- [ ] **Step 5:** Commit `feat(raise): weekly shortlist and approval`.

### Task 3: Gmail drafts, monthly updates, launch asks (SQL)

**Files:** SQL in the raise functions migration; test `tests/integration/raise-gmail.test.ts`.

**Interfaces — Produces (all SECURITY DEFINER, `p_user default rr_owner()`):**
- `rr_message_save(p_item uuid, p_kind text, p_period text, p_subject text, p_body text) returns text`: only kinds `update`/`launch_ask`; returns `'not ready'` unless the item is approved and its deal has `details ? 'adviceCallAt'` (Review Focus 4); upserts only while the message is `ready`.
- `rr_gmail_todo() returns jsonb`: `{sender_email, messages:[{key, radar_item_id, kind, period, to, subject, body, thread_id}]}` for outreach rows with `gmail_ok`, email present, item approved: `first` when stage `drafted` and no `first` message; `followup_1`/`followup_2` when stage `sent`, `next_followup_at <= current_date`, touches 1/2, no message of that kind, body from `followup_1`/`followup_2`, thread from the `first` message; `launch_followup` 7 days after a sent `launch_ask` with no reply; plus `ready` `update`/`launch_ask` rows. `key` = `<outreach_id>:<kind>:<period>`.
- `rr_gmail_record(p_key text, p_draft_id text, p_thread_id text) returns text`: inserts or marks the message `in_gmail` with ids; a second call for the same key returns `'exists'` and changes nothing (Review Focus 3).
- `rr_gmail_watch() returns jsonb`: messages `in_gmail` or `sent` (not replied) with to/subject/thread/draft id/kind.
- `rr_gmail_observe(p_key text, p_event text, p_at timestamptz) returns text`: `sent` → message `sent`; for `first` → `rr_outreach_record(item,'sent')`, `followup_*` → `'followup'`, `launch_ask` → email activity "Sent launch ask"; `replied` → message `replied`; for first/followups → `rr_outreach_record(item,'replied')`, `launch_ask`/`launch_followup` → email activity "Replied to launch ask" and investors deal stage moved to `pitched` if earlier, `update` → email activity "Replied to update".
- `rr_update_todo() returns jsonb`: `{due bool, reason, period, facts:{progress, ask, next}, people:[{radar_item_id, name, email}]}`; due only in phase `building`, on or after the first Monday of the month, when `month.*` facts changed after the last update period was drafted; people = ready investors (adviceCallAt) with email.
- `rr_launch_todo() returns jsonb`: phase `raising` → ready investors without a `launch_ask` message, plus pitch, raise target.
- Also: `rr_outreach_watch`/`rr_outreach_observe` stay for compatibility; the daily task uses the gmail ones.

- [ ] **Step 1: Failing tests:** first-note message appears only with `gmail_ok`, email and stage drafted; never for an outreach row synced as `sent` (Review Focus 2); recording the same key twice → `'exists'`, one row; follow-up appears on its due date with the first message's thread id and not before; observing `sent` on `first` runs the existing effects (activity, task, Target→Intro); `rr_message_save` refuses a person without `adviceCallAt`; update todo not due when facts unchanged since last period, due after they change; launch reply moves deal to `pitched` but not backwards from `term_sheet`.
- [ ] **Step 2–4:** FAIL → implement → PASS; full suite.
- [ ] **Step 5:** Commit `feat(raise): gmail drafts, updates and launch asks`.

### Task 4: Raise settings, advice calls, progress, templates (TS)

**Files:** Modify `src/db/queries/raise.ts`, `src/lib/radar/drafts.ts` (+ `drafts.test.ts`), create `src/lib/raise.ts` (+ `raise.test.ts`); test `tests/integration/raise-settings.test.ts`.

**Interfaces — Produces:**
- `src/lib/raise.ts`: `type RaiseSettings = { target: number; launchDate: string | null; phase: "building" | "raising" }`, `parseRaiseForm(values: Record<string,string>, current: RaiseSettings): RaiseSettings` (invalid target/date keep current — Review Focus 5), `isStale(updatedAt: Date | null, now: Date, days = 14): boolean`.
- `raise.ts` queries: `getRaise(userId)`, `saveRaise(userId, RaiseSettings)`, `getMonthFacts(userId)` / `saveMonthFacts(userId, {progress, ask, next})` (sets `month.updated_at`), `setAdviceCall(userId, dealId, done: boolean)` (investors deals only; sets/removes `details.adviceCallAt` = today), `raiseProgress(userId): {target, committed, softCircled, ready: number}` (committed = won investors deals' amounts; soft-circled = open deals at `follow_up`/`term_sheet` with an amount; ready = open deals with `adviceCallAt`), `weekSummary(userId)` (shortlist, in-Gmail messages, follow-ups due, applications due within 30 days = sooz funding/sampling + career/personal saved items with a deadline, replies in 14 days, nudges: traction stale >14 days, month facts unchanged since last update).
- `templateDrafts`: invest purpose never mentions the raise (remove the `pitch.raise` line); `pitch.raise` field label becomes "Instrument (used only in the launch ask)".

- [ ] **Step 1: Failing tests:** `parseRaiseForm` keeps current on `""`, `"-5"`, `"abc"`, bad date; `templateDrafts` invest with `pitch.raise` set does not contain "raise", "$" or the instrument; `setAdviceCall` on a restaurants deal returns false; `raiseProgress` sums committed and soft-circled correctly; `weekSummary` lists a saved competition with a deadline in 10 days and not one in 40.
- [ ] **Step 2–4:** FAIL → implement → PASS; full suite.
- [ ] **Step 5:** Commit `feat(raise): settings, advice calls, progress and pre-launch templates`.

### Task 5: This week page, advice button, progress, nav

**Files:** Create `src/app/(app)/week/page.tsx`, `src/app/(app)/week/actions.ts`, `src/components/raise/*`; modify `src/lib/nav.ts` (+ test), `src/components/bottom-tabs.tsx`, `src/components/pipeline/deal-detail.tsx`, `src/components/pipeline/section-page.tsx` (investors progress bar), `src/components/radar/outreach-panel.tsx` (Gmail status, "Put this draft in Gmail" sets `gmail_ok`), `src/app/(app)/page.tsx` (link to This week).

- [ ] **Step 1:** Update `nav.test.ts`: `PRIMARY_NAV` hrefs `/`, `/week`, `/radar`, `/restaurants`, `/investors`, `/general`, `/tasks`; bottom tabs show all but Tasks (`mobile: false` on Tasks), so still six. FAIL.
- [ ] **Step 2:** Build `/week`: raise header (phase, target, launch date form, progress bar, "We launched" switch with confirm), nudges, shortlist with checkboxes and **Approve selected**, "In your Gmail drafts", follow-ups due, applications due, replies, This month form. Advice-call toggle on investor deal pages. Progress bar on Investors.
- [ ] **Step 3:** `npm test && npm run typecheck && npm run lint && npm run build` PASS; browser check on the dev branch with a throwaway owner (seed a shortlist through `rr_shortlist_set`): approve selected → CRM records + `gmail_ok`; advice toggle; progress bar. Delete the throwaway owner after.
- [ ] **Step 4:** Commit `feat(raise): this week page, advice calls and progress`.

### Task 6: Routines

**Files:** Modify `src/lib/radar/routine.ts` (+ test), `src/lib/radar/briefs.ts` (sooz-buyers adds Houston cafés, coffee shops and specialty stores), `scripts/routine-prompt.ts` (add `gmail`); create `routines/gmail.md`, regenerate the rest; create `drizzle/0009_raise_grants.sql` (re-runnable grants for every new routine-callable function).

- [ ] **Step 1: Failing tests:** outreach prompt lists `rr_shortlist_candidates`, `rr_shortlist_set`, `rr_outreach_queue()`, `rr_outreach_todo(8)`, `rr_outreach_save`, `rr_update_todo`, `rr_launch_todo`, `rr_message_save`; says first notes never mention the round, amount or terms; no longer contains `rr_outreach_watch`. New `buildGmailRoutinePrompt()` lists only `rr_gmail_todo`, `rr_gmail_record`, `rr_gmail_watch`, `rr_gmail_observe`; allows Gmail `create_draft`, `search_threads`, `list_drafts`/`get_draft` only; says never `send_message`; stops if the connected account differs from `sender_email`. Role test lists the new functions as executable.
- [ ] **Step 2–4:** FAIL → implement → PASS; regenerate `routines/*.md`; full suite.
- [ ] **Step 5:** Commit `feat(raise): routine prompts and grants`.

### Task 7: Final review and ship

- [ ] Final whole-branch review (fresh reviewer), fix Critical/Important with RED→GREEN tests.
- [ ] Apply migrations to production (role already exists); verify `select rr_shortlist_candidates()` works as `radar_routine`.
- [ ] PR → checks → merge (Vercel deploys); verify READY and `/week` behind sign-in.
- [ ] Scheduled tasks: outreach prep keeps its wrapper; create daily `rapport-gmail-drafts` (~7:43 CT) reading `routines/gmail.md` with the same hard-rule header style; set raise settings in production (target 75000, phase building).
- [ ] README: Raise mode section.
