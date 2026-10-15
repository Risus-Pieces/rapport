# Radar in Rapport — Design

Date: 2026-10-14
Status: Approved by the owner in conversation ("once you finish planning, just go ahead")

## Intent

The owner runs two apps: **Query** (`Risus-Pieces/Query`, opportunity-query.vercel.app), a research radar that
finds angels, brand partners, buyers, press, events, programs and internships every week, and **Rapport**
(this repo, rapport-liard.vercel.app), a single-owner CRM. Today a promising person found by Query has to be
carried into Rapport by hand, and Query has its own separate outreach pipeline.

The owner wants **one app**: research lands in a review feed; they approve a person **one at a time**; the person
lands directly in the CRM, where they reach out and track everything together. "I should not need Query at all
anymore." Rapport is the home; Query's features move into it and Query is retired.

## Goals

- A **Radar** area in Rapport that shows research findings in four feeds: Sooz people, Sooz opportunities
  (events, sampling, funding, resources), Personal, Career. Same filters Query has (type, search, Rice only,
  sort, inbox/saved/dismissed).
- **Approve** on any person card (one at a time) creates the CRM records in the right section and links them back
  to the finding. Non-people are saved/dismissed only; they never become CRM records.
- **Outreach lives on the CRM record.** Drafts (email, LinkedIn note, intro request, two follow-ups), purpose,
  Gmail compose link, mark-sent, follow-up timing and reply detection attach to the contact/deal and write into
  Rapport's activities, tasks and pipeline stages.
- **Pre-drafting (owner's decision):** the weekly outreach job drafts for strong unapproved finds too (score ≥ 75),
  so drafts are ready the moment the owner approves. Drafts are never sent automatically.
- The weekly **routines** (research Mon/Thu, outreach prep Mon, digest Mon/Thu) write to Rapport's database and
  the digest links into Rapport.
- **One-time data move** of everything useful from Query's database into Rapport's production database.
- Query is retired: its URL redirects to Rapport's Radar, its scheduled tasks point at Rapport.

## Non-goals

- No change to Rapport's existing sections, stages, sign-in or look beyond what the Radar needs.
- No automatic sending of any message, ever. No new email provider.
- No editing of research briefs in the UI (they stay code in `src/lib/radar/briefs.ts`).
- Career/Personal items do not become a job-application tracker.

## Anti-goals (would be a failure even if it works)

- Two places to track the same person (a finding with its own pipeline *and* a CRM contact).
- A finding approved twice creating duplicate contacts or deals.
- Routines gaining broad database access: they must still only call a fixed set of SQL functions.
- Losing Query data the owner has triaged (dismissals, notes) in the move.

## Constraints

- Rapport stack: Next.js 16.3 (read `node_modules/next/dist/docs/` before writing Next code — see AGENTS.md),
  TypeScript, Tailwind v4 + shadcn, Drizzle on Neon Postgres, Better Auth, Vitest. Every table is owner-scoped by
  `user_id` and every query takes `userId` (no RLS).
- Databases: Rapport = Neon project `little-lake-33520023` (`personal-crm`), branches `main`
  (`br-spring-unit-b86mju41`, production, database `neondb`) and `dev` (`br-misty-wildflower-b8jxwulh`, used by
  integration tests with `NEON_BRANCH=dev`). Query = Neon project `green-hall-60323582`, branch
  `br-billowing-band-an46gq84`, database `opportunity_query` (read-only source for the move; never modified or
  dropped). Never touch other Neon projects.
- Rapport production currently has the owner user and no CRM rows.
- Migrations are Drizzle SQL migrations in `drizzle/`, applied with `npm run db:migrate`. SQL functions for the
  routines go in a custom migration (`drizzle-kit generate --custom`).
- Rules carried over from Query: public professional information only; never guess emails/phones; adults only;
  first notes relationship-first (SEC Reg D note); never offer equity to ambassadors; FTC disclosure and school NIL
  rules noted; Apollo ≤ 5 `apollo_people_match` lookups per run (team account), no other Apollo tools; digest goes
  only to boxuanzhao1128@gmail.com.

## The design

### Data model (new tables, all with `id`, `user_id`, `created_at`, `updated_at` like the rest of Rapport)

- **radar_items** — a finding. Port of Query `items`: `feed` (`sooz` | `personal` | `career`; named feed, not
  section, to avoid clashing with Rapport's `section`), `kind`, `title`, `url`, `source`, `summary`,
  `why_relevant`, `score` 0–100, `tags text[]`, `details jsonb` (firm, role, rice_connection, check_size,
  contact_path), `event_date`, `deadline`, `location`, `dedupe_key` (unique per user), `status`
  (`new` | `seen` | `saved` | `dismissed` | `approved`), `notes`, `task_id`, `first_seen`, `last_seen`,
  `digested_at`, and after approval `contact_id` / `company_id` / `deal_id` (nullable FKs, set null on delete).
  Kinds and person kinds exactly as in Query's `lib/types.ts` (person kinds: angel, celebrity, nextgen, creator,
  buyer, media).
- **radar_runs** — port of Query `runs` (task_id, feed, started/finished, found, inserted, error).
- **outreach** — one row per person being worked, keyed to a radar item (`radar_item_id` unique) and, after
  approval, to `contact_id` / `deal_id`. Fields from Query: `purpose` (invest | ambassador | buyer | press |
  intro), `email`, `email_source`, `linkedin_url`, `warm_path`, `subject`, `body`, `linkedin_note`,
  `intro_request`, `followup_1`, `followup_2`, `drafted_by`, `drafted_at`, `stage` (`prospect` | `drafted` |
  `sent` | `replied` | `closed`), `sent_at`, `touches`, `next_followup_at`, `replied_at`. This is draft and
  cadence state only; the relationship itself is tracked by the contact/deal/activities.
- **network** — port of Query's LinkedIn connections table (warm-intro matching).
- **app_settings** — key/value per user; holds the pitch facts (`pitch.*`) from Query.

### Owner resolution for routines

Routines call SQL functions through the Neon connector, without a session. Every `rr_*` function takes no
user argument from the routine and resolves the owner with `rr_owner()` = the single row of `"user"` (raise if
there is not exactly one owner — production has one). Integration tests call the same functions with an explicit
`p_user` override (a defaulted trailing parameter) so they can run on the dev branch, which has test users.

### SQL functions (prefix `rr_`, ports of Query's `oq_*`, same validation, caps, dedupe and escaping)

- `rr_ingest(feed, task, kinds[], upcoming, findings jsonb)` → `radar_items` (+ `radar_runs`), never touching
  status/notes/approval of existing rows. Same dedupe keys as Query (`angel:` / `<kind>:` for people,
  `<feed>:url:` otherwise) so moved rows keep their keys.
- `rr_known_titles(feed)` → for the routine's "don't repeat these" step (replaces raw SELECT).
- `rr_outreach_queue(min_score)` → creates outreach rows for **approved people and unapproved people with
  score ≥ min_score** that are not dismissed (pre-drafting), purpose from kind.
- `rr_outreach_todo(limit)` → pitch facts + prospects needing enrichment/drafts, one person per firm (as in
  Query), approved people first, each with kind, purpose, approval flag, network matches.
- `rr_outreach_save(radar_item_id, jsonb)` → enrichment + drafts, frozen once sent. When the item is approved,
  a saved email/LinkedIn URL is also copied onto the contact if the contact's field is empty.
- `rr_outreach_watch()` / `rr_outreach_observe(radar_item_id, 'sent'|'replied', at)` → Gmail detection; for an
  approved person this also writes the activity/stage effects below.
- `rr_digest_email(min_score, base_url)` → same rendered, escaped digest, sections: coming up, Sooz — new
  people, Sooz — events/funding/resources, Personal, Career, Outreach (drafts ready for approved people, drafts
  waiting on approval, follow-ups due, new replies). Links go to `<base_url>/radar`.
- `rr_mark_digested(ids[])`.

### Approving a person (one at a time)

`Approve` on a person card (feed `sooz`, person kind, not yet approved) runs one transaction:

| Kind | Rapport records |
|---|---|
| angel, nextgen | Investors **angel** deal (contact only, per Rapport's angel rule), stage Target |
| buyer | Restaurants: company = first firm (reuse an existing restaurants company with the same name, case-insensitive), contact at that company, and a Lead deal unless the company already has an open deal |
| celebrity, creator, media | General contact, priority `high` (so reminders apply) |

- Contact fields: name = title; `title` = role (+ firm for people without a company); `email` / `linkedin_url`
  from the outreach row if present; tags from the finding; `details` gets the provenance (source URL, why
  relevant, contact path, Rice connection, check size, radar item id) and, for angels, `background` = summary.
- If a non-archived contact with the same name already exists in the target section, link to it instead of
  creating another (and do not create a second open deal for it).
- A `note` activity "Added from Radar" with the summary and source link (notes do not count as touches).
- The radar item becomes `approved` with the ids set; its outreach row (if any) gets `contact_id` / `deal_id`.
  Approving an already-approved item is a no-op that returns the existing records.
- After approving, the UI goes to the new record's page.

### Outreach on the record

A **Outreach** panel on investor/restaurant deal pages and general contact pages (only when an outreach row is
linked): purpose select, drafts (editable), *Draft from template* (Query's per-purpose templates), *Open in
Gmail* (compose link, never sends), *Copy LinkedIn note*, *Ask for intro*, *Mark sent*, *Follow-up sent*,
*They replied*, *Not pursuing*. Effects:

- Mark sent → `email` activity "Sent intro email" on the contact (and deal); outreach `sent`, touch 1; a task
  "Follow up with <name>" due in 5 days; first-stage deals move one stage (Investors Target → Intro,
  Restaurants Lead → Contacted).
- Follow-up sent → `email` activity; touches + 1; next task due in 7 days; stops after 3 touches.
- Replied (button or Gmail detection) → `email` activity "Replied"; outreach `replied`; open follow-up task for
  this outreach marked done.
- Not pursuing → outreach `closed` (the deal itself is moved by the owner on the board as usual).

Unapproved people with pre-drafts show a small "Draft ready" badge on their radar card; the card's expand shows
the draft read-only, with Approve as the next step.

### Navigation and pages

- Sidebar/bottom tabs: add **Radar** (between Home and Restaurants) with a count of new items. `/radar` with
  feed tabs (Sooz people · Sooz · Personal · Career) and Query's filters; cards show score ring, badges, summary,
  why, facts, Save / Dismiss / Restore, notes, Approve (people) or "In CRM →" (approved).
- Home: a Radar line (new finds, drafts ready) alongside the existing snapshot.
- Settings: **Pitch facts**, **LinkedIn connections** import (warm paths on cards and in drafts), **Import
  people to Radar** (Query's CSV format with kind/purpose), and the existing CSV export gains radar items.
- Command palette search includes radar items by title.

### Routines

Port `lib/briefs.ts`, `lib/routine.ts` (prompt builders) and `scripts/routine-prompt.ts` into Rapport
(`src/lib/radar/`, `scripts/`), with the database constants pointed at Rapport (`little-lake-33520023`,
`br-spring-unit-b86mju41`, `neondb`) and the SQL shapes renamed to `rr_*`. Regenerate `routines/*.md` in this
repo. The desktop scheduled tasks (`query-research-sooz`, `query-outreach-prep`, `query-digest-monday`,
`query-research-personal-career`, `query-digest-thursday`) are updated to read `/Users/risus_zhao/rapport/routines/`
and keep their schedules. The digest's dashboard URL becomes the Rapport production URL.

### One-time move from Query

A script (`scripts/import-query.ts`, run once against production, idempotent) reads Query's database and writes:
all `items` → `radar_items` (keeping status, notes, dedupe keys, digested_at; `seen`/`saved`/`dismissed`
preserved; nothing is auto-approved), `runs` → `radar_runs`, `network`, `settings` → `app_settings`, and the
`outreach` rows that hold enrichment (email/LinkedIn/warm path/drafts) → `outreach` linked by radar item. Rows
without any enrichment are not carried (the queue recreates them). It reports counts.

### Retiring Query

- opportunity-query.vercel.app redirects every path to Rapport's `/radar` (a minimal redirect deploy; the Query
  repo gets a note in its README; its database is left untouched as a backup).
- Old scheduled task prompts stop referencing the Query folder.

## Testing

Follow Rapport's conventions: pure logic as `src/lib/**/*.test.ts`; database behaviour as
`tests/integration/*.test.ts` against the Neon dev branch (needs `.env.local` with `NEON_BRANCH=dev`). Port
Query's tests for dedupe parity, ingest validation, digest rendering/escaping, outreach queue/todo/save/observe,
drafts per purpose and routine prompts; add tests for approve (each kind, dedupe by name, idempotency), the
outreach effects (activities, tasks, stage moves), owner resolution, and the import script on fixture data.

## Calls made after the builder check (mine, not the owner's)

1. **Already-contacted people in Query.** Checked the data: Query has no `contacted` items and no outreach beyond
   `prospect` (108 new, 1 saved, 6 dismissed; 40 prospects, 4 enriched). So the import has no history to rebuild:
   it maps `new`/`seen`/`saved`/`dismissed` straight across, carries the 4 enriched outreach rows, and drops
   `outreach_events` (only "added"/"routine_saved" logs). As a guard, the import refuses to run if it ever finds a
   `contacted` item or an outreach row past `drafted`.
2. **Routine access is enforced by the database, not only the prompt.** Rapport's database also holds Better
   Auth's sessions and accounts, so the routines get a dedicated Neon role `radar_routine` (created through the
   Neon API so the connector can log in as it) with no table privileges and `EXECUTE` only on the `rr_*`
   functions, which are `SECURITY DEFINER` with a pinned `search_path`. Routine prompts pass
   `role_name="radar_routine"` to `run_sql`. If the connector cannot use that role, fall back to prompt-level rules
   as in Query and say so in the README.
3. **Owner emails an unapproved person.** Pre-drafts on unapproved cards are read-only and have no Gmail button;
   sending happens from the CRM record after approval. So `rr_outreach_watch` returns only approved people's
   rows, and `rr_outreach_observe` ignores unapproved ones. Routines never approve anyone.

## Left to the builder

Component structure, exact copy, Drizzle schema details, how the SQL migration is organised, and visual details
within Rapport's existing "Studio" look.
