# A login for Mo: shared Sooz workspace, personal stuff per person — Design

Date: 2026-10-27
Status: approved by the owner ("yeah do your call. and just build it.")

## Intent

Rapport has one login (Risus, the owner). Mo (Muyiwa, Sooz co-founder) should get his own login and use Rapport
exactly the way Risus does ("just whatever I'm doing"): the same pipelines, the same weekly raise work. What is about
Sooz is shared between them; what is personal (friends and family, personal and career opportunities) belongs to
whoever is logged in. Log in as Mo → Mo's personal stuff; log in as Risus → Risus's.

## Decisions (the owner's)

- Mo logs in with his own account; there is no profile switcher inside one login.
- **Shared (the Sooz workspace):** Restaurants and Investors (every tab), the Sooz feed in Opportunities, This week
  (raise, shortlist, progress, advice calls, monthly facts, launch), and Settings that describe Sooz (pitch facts).
- **Personal (per login):** General contacts and their reminders, the Personal and Career feeds in Opportunities, and
  Home's "today" view. Mo starts with an empty General list and empty Personal/Career feeds.
- Investor outreach keeps using Risus's Gmail and Risus's name for now (the daily Gmail routine is unchanged).

## How it works (my calls)

- **Workspace = the owner.** Existing data stays where it is. A small `members` table records that Risus is the
  owner and Mo is a member of Risus's workspace. Shared rows are stored under the workspace (Risus's user id); personal
  rows under the logged-in user's id. For Risus both ids are the same, so nothing about his data moves.
- **One scope helper** used by every page and server action: `{ userId, workspaceId }` from the session. A user with no
  `members` row is their own workspace (keeps tests and any future solo account simple).
- **Which rows are shared:** companies, contacts, deals, activities and tasks in Restaurants and Investors; radar items
  in the Sooz feed and research runs; outreach, outreach messages and the shortlist; app settings (pitch, raise,
  month, phase); LinkedIn connections (warm paths help the shared raise).
- **Which rows are personal:** General contacts and companies, activities and tasks on them, tasks not attached to any
  record, and radar items in the Personal and Career feeds.
- **Tasks page and Home** show both: shared tasks (on deals and Sooz records) plus my personal tasks. A new task on a
  deal or Sooz contact is shared; anything else is personal. General follow-up reminders are personal.
- **Search and export** cover the shared workspace plus my own personal records, never the other person's.
- **Adding Mo:** a command Risus runs himself, like the existing owner setup (`npm run add-member`): it asks for Mo's
  email, name and password and creates his account as a member of Risus's workspace. Nobody else (including me) types
  a password. Public sign-up stays off.
- **Routines** keep running as the owner: `rr_owner()` returns the workspace owner from `members` instead of "the only
  user" (which would break the moment Mo exists). Sooz research, outreach, Gmail drafts and the digest are unchanged;
  Personal/Career research keeps filling Risus's feeds and the digest still goes only to Risus.
- A small "Only you see this" hint on General and on the Personal/Career feeds, so it's clear what Mo can't see.
- **Sooz people in General are shared** (my call, from "Sooz stuff is shared"): celebrities, creators and press that
  the Sooz research adds (and anyone with Sooz outreach) are Sooz work. They get marked as shared, and the General page
  shows them to both people in their own "Sooz" group, separate from each person's own friends and family. Approving a
  Sooz find never reuses someone's personal contact of the same name.
- **Warm paths say whose connection it is** (owner approved): LinkedIn connections record who imported them. Shortlist
  and outreach hints read "Risus knows Sam Lee (connection / contact)…" or "Mo knows…". Both people's connections and
  General contacts at the target firm count, so Mo can see a personal contact's name only inside such a hint, never the
  General list itself. Drafts sent from Risus's Gmail only ask for intros through Risus's own connections; Mo's show
  as "ask Mo for an intro".
- **New/seen in the Sooz feed is shared** (my call): if either person opens or marks the Sooz feed as seen, it's seen
  for both, like the rest of the shared workspace. Personal/Career feeds are per person anyway.

## Non-goals

- A profile switcher within one login; per-person Gmail drafts or sender name; personal research for Mo (later, once
  he describes what he's into); different permissions (both can do everything in the shared workspace); "who changed
  what" history; invite emails or self-service password reset.

## Anti-goals

- Mo seeing Risus's General contacts, personal tasks or Personal/Career opportunities, or the reverse — including by
  guessing a record's URL, through search, export, Home counts or the sidebar badge.
- Any routine failing, or writing to the wrong person, because there are now two users.
- Any existing data moving, disappearing or changing owner.

## Constraints

- Next.js 16 App Router, Drizzle on Neon, Better Auth (email + password, sign-up disabled), existing tests and the
  `rr_*` SQL conventions (SECURITY DEFINER, pinned search_path, routine role grants). New migrations only.

## Left to the builder

- How the scope helper is threaded through queries (most already take a `userId`; pass the right one per section).
- Exact placement and wording of the "Only you see this" hint.
