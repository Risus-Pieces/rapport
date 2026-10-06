# Personal CRM Overhaul — Design

Date: 2026-10-02
Status: Draft, awaiting owner review

## Goal

Rebuild the personal CRM as a single-owner web app with a standard CRM feature
set (contacts, companies, deals, activities, tasks, tags, search, dashboard,
CSV import/export) organised into three sections — **Restaurants**,
**Investors**, **General** — on a free, non-Supabase backend.

## Decisions already made

| Topic | Decision |
|---|---|
| Starting point | Fresh start. No data is migrated from the old Supabase project ("Connection"); its schema was used only as a guide. |
| Backend | Neon Postgres (free), Drizzle ORM, Better Auth. Supabase packages, `supabase/` folder and env vars are removed. |
| Hosting | Vercel Hobby. Chosen knowingly: Hobby is limited to non-commercial personal use and Vercel counts lead generation as commercial, so this carries a suspension risk (see Risks). |
| Architecture | One shared CRM engine; each section is a config (pipeline stages, extra fields, labels), not separate tables. |
| Users | One owner, login required, public sign-up closed. |
| Sections | Restaurants = accounts sold to (pipeline). Investors = fundraising pipeline of both **angels** and **institutions**. General = relationship-cadence tracker (friends, family, professional) with priorities. |
| Look | "Studio": dark by default with a light alternative, Plus Jakarta Sans throughout, section colors (Restaurants coral, Investors blue, General green), pill buttons, rounded cards and no shadows. Built on the shadcn components already in the repo. |

## Data model

Postgres via Drizzle. Every table has `id uuid pk default gen_random_uuid()`,
`user_id text not null` (the Better Auth user id), `created_at`, `updated_at`.
Enums: `section` (`restaurants`, `investors`, `general`), `priority`
(`very_high`, `high`, `medium`, `low`, `gone`), `activity_type` (`call`,
`email`, `meeting`, `tasting`, `note`, `other`), `deal_status` (`open`, `won`,
`lost`).

**contacts** — `section`, `company_id` (nullable fk → companies, set null),
`name` (required), `title`, `email`, `phone`, `linkedin_url`, `notes`,
`priority` (nullable; null = no reminders), `details jsonb`, `tags text[]`,
`archived_at`.

**companies** — `section`, `name` (required), `website`, `city`, `notes`,
`details jsonb`, `tags text[]`, `archived_at`.

**deals** (a pipeline card) — `section` (restaurants or investors only),
`company_id` and/or `contact_id` (at least one required), `title`, `stage`
(text; must be a key in the section's stage list), `status` (`open`/`won`/
`lost`), `amount_cents` (nullable, USD: order value or check size), `next_step`,
`next_step_date`, `closed_at`, `sort_key double precision` (order within a
stage on the board), `details jsonb`, `tags text[]`.

Deals reference `companies` and `contacts` with `NO ACTION`: deleting a party
that still has deals is refused by the database, and the delete flow removes
that party's deals first inside the same transaction. (`SET NULL` would
violate the "at least one party" check.)

**activities** (timeline) — `type`, `occurred_at` (default now), `summary`
(required), `body`, `contact_id`, `company_id`, `deal_id`. At least one of
contact or company is always set; a deal activity inherits its deal's contact
and/or company. Deleting a contact or company deletes its activities; deleting
a deal only clears `deal_id`.

**tasks** — `title`, `due_date`, `done_at`, optional `contact_id`,
`company_id`, `deal_id` (all set null on delete).

**Auth tables** (`user`, `session`, `account`, `verification`) are generated
by Better Auth.

**Indexes:** contacts `(user_id, section)`, contacts `(company_id)`, deals
`(user_id, section, status, stage)`, activities `(contact_id, occurred_at
desc)` and `(company_id, occurred_at desc)` and `(deal_id)`, tasks
`(user_id, due_date) where done_at is null`.

**Scoping:** no database RLS. All reads and writes go through one data-access
module whose functions require `userId` and add it to every query.

**Deletes:** the UI confirms hard deletes and states what goes with the record
(for example "and 14 activities"). Archiving (`archived_at`) is the default
action and hides a record without losing history.

## Section configs (code, `src/lib/sections.ts`)

Each config defines the label, pipeline stages (key, label, color, and whether
terminal won/lost), and zod schemas for the `details` of contacts, companies
and deals. Moving a deal into a terminal stage sets `status` and `closed_at`;
moving it out clears them.

**Restaurants**
- Stages: Lead → Contacted → Tasting → Negotiating → **Active** (won) · **Lost**.
- Company details: cuisine, neighborhood, current supplier, order frequency.
- Adding a restaurant creates the company and its first deal (stage Lead) in
  one step; owners and chefs are contacts attached to the company.

**Investors**
- Stages: Target → Intro → Pitched → Follow-up → Term sheet → **Committed**
  (won) · **Passed** (lost).
- Every investor gets a pipeline card on creation, with a required **Type**:
  - **Angel** — a person only. `contact_id` required, no company.
    `deals.details.investorType = "angel"`; contact details include background.
  - **Institution** — `company_id` required, with partner contacts attached.
    `deals.details.investorType = "institution"`; company details include firm
    type (VC, family office, corporate, accelerator, other), focus stage,
    check-size range, and who introduced you.
- The type is stored, never inferred from whether a company exists, so the
  Investors screen can filter All / Angels / Institutions reliably. The form
  and server action both enforce the rule above.

**General**
- No pipeline and no deals. Contacts only, with the priority cadence.

## Follow-up reminders

Carried over from the old app. Priority maps to a target gap in days:
Very High 15, High 30, Medium 90, Low 180. Gone and null mean no reminder.

- **Last touch** = latest `occurred_at` among activities of type call, email,
  meeting, or tasting for the contact (notes do not count). If there is none,
  use the contact's `created_at`.
- `daysOverdue = daysSinceLastTouch − targetDays`.
- **Overdue** if `daysOverdue > 0`; **due soon** if `−7 ≤ daysOverdue ≤ 0`;
  otherwise **on track**. The 7-day window is a constant that can be tuned.
- Reminders are available on any contact. The General contact form defaults
  priority to High; Restaurants and Investors contacts default to none (null).

Priority is shown as a 4-step signal meter plus a text label; color is
reserved for sections.

## Screens and navigation

Routes under an authenticated `(app)` group: `/` (Home), `/restaurants`,
`/investors`, `/general`, `/tasks`, `/settings`; `/login` outside it.

- **Shell:** left sidebar (bottom tab bar on phones): Home, the three sections,
  Tasks, Settings. A global **+** button and **⌘K** palette (search all
  records, jump to pages, create contact/deal/task/log activity) work anywhere.
- **Home — "what do I do today":** tasks due and overdue; overdue and due-soon
  follow-ups; a pipeline snapshot per section (count and value by stage);
  recent activity.
- **Section pages:** switchable views held in the URL (`?view=`).
  - Restaurants and Investors: **Pipeline** (kanban, drag between stages),
    **List** (sortable, filterable table), **People**, **Companies**. Investors
    adds an All / Angels / Institutions filter (`?type=`).
  - General: contact list with a priority meter and an overdue filter.
- **Record detail:** a side panel, opened via a URL param (for example
  `?open=deal:<id>`) so it is linkable and works with the back button. Header
  with key facts and next step; one-click *Log call / email / meeting / tasting*
  and *Add task*; timeline; tabs for tasks, details, and related records.
- **Settings:** CSV import and export (the real backup), tags, stage lists
  (read-only in v1, edited in `sections.ts`).
- **Empty, loading and error states** are designed for every list and panel.

Libraries: `@dnd-kit` for the kanban, shadcn `command` (cmdk) for ⌘K.
Reads are server components; writes are server actions with zod validation.
Drag-and-drop updates optimistically and rolls back on failure.

## Studio design rules

Rules for the Studio look (dark default, light alternative) that every later
screen follows:

1. Accent fill is never the sole state cue. Active, selected and focused
   states also need a shape cue (bar, ring or outline) at >= 3:1 contrast.
2. Weights are 400 and 500 only (`font-synthesis-weight: none` renders heavier
   weights as 500).
3. Touch sizing: phone primary actions use `size="lg"` or `icon-lg` (44px);
   `default` is 40px; `xs`, `sm`, `icon-xs` and `icon-sm` are desktop-only.
4. Section color comes only through `SECTION_STYLES` in `src/lib/nav.ts`.
   Extend the map and its literal-class test; never interpolate class names.
5. The priority meter uses `bg-primary` for on-steps and `bg-accent` for
   off-steps, and is always paired with a text label.
6. Form controls are `h-11 rounded-xl border-input bg-secondary text-base`
   with the opaque 2px ring and offset. Textarea and Select get this in
   Phase 2's first task.
7. `Card` has `overflow-hidden`: full-bleed list rows inside a card need
   padding, or an `overflow-visible` card, so focus rings are not clipped.
8. Hover is `hover:bg-accent` or `hover:border-input`, never a fill closer
   than 1.5:1 to its surface.

## Auth

- Better Auth with the Drizzle adapter, email and password, one owner account
  created by a one-time interactive seed script. Public sign-up is closed with
  `emailAndPassword.disableSignUp: true`. Verified against better-auth 1.7.7:
  the flag rejects both the HTTP endpoint and `auth.api.signUpEmail`, so the
  seed script creates the owner through Better Auth's internal adapter
  (`auth.$context`), which bypasses the flag. Minimum password length is 12.
- `src/proxy.ts` (Next 16's replacement for middleware) redirects
  unauthenticated requests to `/login`. As defence in depth, every server
  component, query and server action also checks the session itself.
- No password-reset email in v1; the owner resets via a script.

## Hosting and environments

- Vercel Hobby for the app; Neon for the database, with two branches: `dev`
  for local work and `main` for production. Vercel functions run in the region
  nearest the Neon region.
- Environment variables (never committed): `DATABASE_URL` (pooled),
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`.
- Drizzle migrations are generated and committed; `drizzle-kit migrate`
  applies them per branch.
- The app uses no Vercel-specific APIs, so it can move to another Node host.

## Cleanup

In this folder only the `@supabase/ssr` and `@supabase/supabase-js`
dependencies and the two `NEXT_PUBLIC_SUPABASE_*` values in `.env.local` exist
(no source files use them); remove both. Replace the default "Create Next App"
metadata in `src/app/layout.tsx`.

## Build order

Each step works on its own and is verified before the next begins.

1. **Foundation:** Neon (dev and main), Drizzle schema and migrations, Better
   Auth login and seed script, app shell, themes.
2. **Contacts, companies and General:** CRUD, priorities, overdue logic, list
   views.
3. **Activities, tasks and the side panel.**
4. **Deals and pipelines:** kanban and list for Restaurants and Investors,
   including the angel/institution rule.
5. **Home dashboard, ⌘K search, CSV import/export, deploy.**

## Testing

- **Unit tests (Vitest)** for pure logic: overdue calculation, priority
  mapping, stage → status transitions, the angel/institution rule, section
  `details` schemas, and CSV mapping.
- **Per-step manual verification** in a real browser against the dev branch:
  create, edit, drag, log activity, search, log out and in, and phone width.
- Before implementation begins, the Next.js guides in
  `node_modules/next/dist/docs/` are read, per `AGENTS.md`, because this Next
  version differs from earlier ones.

## Out of scope for v1

Data migration from Supabase, multi-user or teams, email or calendar sync,
password-reset email, file attachments, AI features, a native mobile app,
editable stage lists, per-field audit history.

## Risks and open items

- **Vercel Hobby terms.** Business use may be treated as a violation and the
  project could be suspended. Mitigation: the app is portable (Node plus
  Postgres), and Cloudflare or Vercel Pro are fallbacks.
- **Neon free limits.** 0.5 GB storage and 100 compute-hours a month. A CRM of
  this size should use a few MB. The database sleeps after about 5 minutes
  idle, so the first request afterwards is slower.
- **Backups.** Neon's free restore window is short, so CSV export is the
  backup. Remind the owner to export periodically.
- **Working folder.** This spec lives in `/Users/risus_zhao/personal-crm`
  (the folder this session started in). A fuller older copy of the app is at
  `/Users/risus_zhao/Desktop/Apps/Connection/personal-crm` (it has the old
  design tokens, a `.vercel` link, and git history). It is used as a reference
  for the data model only; the Studio redesign replaced its theme. Confirm this
  is the folder to build in before implementation starts.
