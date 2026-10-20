# Relationships and Opportunities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every person lives in the CRM with a relationship status (To reach out / Know them / Ghosted / On hold / Dismissed); everything else the research finds lives in an Opportunities tab (To apply / Applied / On hold / Dismissed).

**Architecture:** A `relationship` column on `deals` (Investors, Restaurants) and `contacts` (General), kept current by SQL and TS hooks. Approval moves into SQL (`rr_approve_item`) so research ingest adds people straight to the CRM. The Radar page becomes `/opportunities`, showing only non-people.

**Tech Stack:** Next.js 16.3, Drizzle 0.45 on Neon Postgres, Vitest (integration on the Neon dev branch).

**Spec:** `docs/superpowers/specs/2026-10-20-relationships-and-opportunities-design.md`.

## Global Constraints

- Relationship values: `to_reach_out`, `known`, `ghosted`, `on_hold`, `dismissed`; labels "To reach out", "Know them", "Ghosted", "On hold", "Dismissed". Default `known`.
- For contacts, `on_hold`/`dismissed` set `archived_at`; other values clear it. Reminders only for `known`.
- Ghosted: outreach stage `sent`, `next_followup_at is null`, `last_touch_at < now() - 7 days`, no reply.
- Opportunity statuses: `new`/`seen`/`saved` = To apply (saved shows a star), `applied`, `on_hold`, `dismissed`.
- New migrations only (never edit 0002–0011). Grants for any new routine-callable function in the same migration.
- Branch `relationships`; commit per task with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.

## Review Focus

1. A Dismissed or On hold person must never get a draft, a shortlist slot, a follow-up or a launch ask.
2. Logging a call/meeting by hand on a To reach out person moves them to Know them, so no cold first note follows.
3. Try again must not leave stale Gmail message records that block a new first note, nor reuse old draft text.
4. Moving 113 Radar people into the CRM is idempotent and keeps every dismissal.
5. An old `/radar?...` link still lands somewhere sensible.

Each line has a test in the owning task (Tasks 2, 1, 2, 5, 3).

---

### Task 1: Relationship columns, backfill, transitions, reminders

**Files:** `src/db/schema.ts`; `drizzle/0012_*.sql` (generated) + `drizzle/0013_relationships.sql` (custom); create `src/lib/relationships.ts` (+ test), `src/db/queries/relationships.ts`; modify `src/db/queries/activities.ts` (logActivity), `src/db/queries/deals.ts` (moveDeal, update*Deal), `src/db/queries/contacts.ts` (withReminder, setContactArchived); test `tests/integration/relationships.test.ts`.

**Produces:** `RELATIONSHIPS`, `type Relationship`, `RELATIONSHIP_LABELS`, `isRelationship` (lib); `setDealRelationship(userId, dealId, r): Promise<boolean>`, `setContactRelationship(userId, contactId, r): Promise<boolean>`, `relationshipCounts(userId, section)`; SQL `rr_mark_known(p_contact uuid, p_company uuid, p_deal uuid)` (to_reach_out/ghosted → known for that contact, its deals, the deal), used by logActivity for touch types and by `rr_outreach_record`.

- [ ] Tests: backfill on fixture rows (Target deal without touches → to_reach_out; Intro → known; Target with a logged call → known; Radar-added General contact never contacted → to_reach_out with priority null; archived contact → on_hold); logActivity call on a to_reach_out angel → contact and deal known (Review Focus 2); note activity changes nothing; moveDeal Target→Intro → known; setContactRelationship dismissed sets archived_at, known clears it; reminder is `none` for a to_reach_out contact with priority high. FAIL → implement → PASS → commit.

### Task 2: Approve in SQL, ingest straight to CRM, Ghosted, Try again

**Files:** `drizzle/0014_crm_people.sql`; modify `src/db/queries/radar.ts` (approveRadarItem wraps SQL), `src/db/queries/raise.ts` (tryAgain, refreshGhosted); tests `tests/integration/crm-people.test.ts` (+ existing radar-approve tests must still pass).

**Produces:** `rr_approve_item(p_item uuid, p_user text default rr_owner()) returns jsonb` (same behaviour as today's approveRadarItem, plus `relationship = 'to_reach_out'` on new contact/deal and no priority for General); `rr_ingest` approves new sooz person items; `rr_already_contacted(i)` = the deal's (or contact's) relationship is not `to_reach_out` (Dismissed/On hold/Known/Ghosted all count); `rr_outreach_record` sent/replied → `rr_mark_known`; `rr_refresh_ghosted(p_user) returns int`; `rr_outreach_todo` adds `retry bool` (person has touch activities); `rr_sync_crm_investors` skips contacts whose company has an investors deal, and the migration removes untouched synced partner items; digest lists new people added to To reach out. TS `tryAgain(userId, itemId): Promise<boolean>` (only from ghosted) and `refreshGhosted(userId)`.

- [ ] Tests: ingesting a new angel creates a To reach out contact + Target deal and marks the item approved; Dismissed/On hold person is not a shortlist candidate and gets no first-note, follow-up or launch message (Review Focus 1); ghosted after cadence ends +7 days, not before, not for rows without last_touch_at; tryAgain resets outreach, deletes old messages, todo shows `retry: true`, and a new first note is offered after re-approval (Review Focus 3); synced partner at an institution is removed when untouched, kept when in Gmail. FAIL → implement → PASS → commit.

### Task 3: Opportunities tab

**Files:** `drizzle/0015_opportunity_statuses.sql` (status check adds `applied`, `on_hold`); create `src/db/queries/opportunities.ts`, `src/app/(app)/opportunities/{page,actions}.tsx|ts`, `src/components/opportunities/opportunity-card.tsx`; replace `src/app/(app)/radar/page.tsx` with a redirect; modify `src/lib/nav.ts`, `src/lib/palette.ts`, `src/app/(app)/layout.tsx` (badge = new opportunities), `src/app/(app)/page.tsx` (home card), `src/db/queries/search.ts` + `src/lib/radar/types.ts` (`opportunityHref`), `src/db/queries/raise.ts` (applications due = To apply), digest link base.

**Produces:** `listOpportunities(userId, {feed, view: "to_apply"|"applied"|"on_hold"|"dismissed", kind?, q?, sort})`, `opportunityCounts(userId, feed)`, `newOpportunityCounts(userId)`, `setOpportunityStatus(userId, id, "seen"|"saved"|"applied"|"on_hold"|"dismissed")` (people never), `opportunityHref(item)`.

- [ ] Tests: lists exclude people; views map statuses; To apply hides past-dated; status changes refuse person items; nav `/`, `/week`, `/opportunities`, `/restaurants`, `/investors`, `/general`, `/tasks`; `/radar?tab=career&q=x` maps to `/opportunities?feed=career&q=x` (pure `radarRedirect(params)`; Review Focus 5). FAIL → implement → PASS; build; commit.

### Task 4: CRM relationship views and actions

**Files:** modify `src/components/pipeline/section-page.tsx` (relationship tabs: To reach out list, Pipeline of known deals, Ghosted, On hold, Dismissed), `src/db/queries/deals.ts` (`listDeals` relationship filter), `src/app/(app)/general/page.tsx` (tabs), `src/db/queries/contacts.ts` (`listContacts` relationship filter), deal detail + contact page status control (Know them / On hold / Dismiss / Restore / Try again), actions in `src/app/actions/relationships.ts`.

- [ ] Tests: `listDeals(..., {relationship})` and `listContacts(..., {relationship})` filters and counts; board excludes to_reach_out by default. FAIL → implement → PASS; browser check with a throwaway dev owner (deleted after); commit.

### Task 5: Move the Radar's people, routines, ship

- [ ] `drizzle/0016_move_radar_people.sql`: `select rr_approve_item(id, user_id)` for every sooz person item with status new/seen/saved (dismissed stay); idempotent. Test on fixture (Review Focus 4).
- [ ] Outreach prompt: `retry` → short circling-back note; research prompt wording (people go to To reach out). Regenerate `routines/*.md`; README.
- [ ] Final whole-branch review (fresh reviewer), fixes with RED→GREEN.
- [ ] Production: migrate (moves the people), verify counts, PR → merge, verify deploy.
