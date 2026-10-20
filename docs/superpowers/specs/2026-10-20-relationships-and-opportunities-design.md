# Relationships in the CRM, and an Opportunities tab — Design

Date: 2026-10-20
Status: Approved by the owner in conversation ("automatic is fine, go ahead and build it")

## Intent

The owner likes the research, but reviewing people in a separate Radar and then "approving" them into the CRM is one
step too many, and the CRM does not show *where* each person stands. They want everything about people in the CRM,
sorted by relationship, and everything else the research finds (events, funding, competitions, internships, programs)
in its own CRM-like tab.

## Decisions (the owner's)

- **People live in the CRM**, with a relationship status, in Investors and General:
  - **To reach out** — found, not contacted yet.
  - **Know them** — anyone already reached out to, or already known. (No separate "in conversation" state: once
    contacted, you know them.)
  - **Ghosted** — reached out and followed up with no reply. **Automatic**: someone becomes Ghosted when their last
    follow-up has gone unanswered for 7 days. From Ghosted, "Try again" puts them back in To reach out for a fresh draft.
  - **On hold** — paused (today's Archive).
  - **Dismissed** — not a fit; hidden everywhere, never suggested again.
- **The Radar's people move into the CRM** as To reach out: investors (angels, next-gen) as an Investors deal at
  Target; buyers to Restaurants as today; everyone else to General.
- **New research goes straight in**: new people arrive as To reach out (marked new), no Radar stop.
- **Opportunities** (everything the research finds that isn't a person) get their own tab with the same idea:
  **To apply**, **Applied**, **On hold**, **Dismissed**, with dates and deadlines, soonest first, in feeds Sooz /
  Personal / Career. The Radar tab is replaced by this tab.
- The weekly shortlist, Gmail drafts, advice calls, monthly updates and launch asks keep working, drawing from
  To reach out.

## How it works (my calls)

- **Where the status lives.** On **deals** for the pipeline sections (Investors and Restaurants: an institution
  investor is a company deal, so the deal carries it) and on **contacts** for General. One column `relationship` with
  values `to_reach_out`, `known`, `ghosted`, `on_hold`, `dismissed`, plus `relationship_at`. For contacts, On hold and
  Dismissed also set `archived_at`, so existing archive behaviour (no reminders, hidden lists) keeps working.
- **Reminders** (General priorities) apply only to people you know.
- **Transitions kept automatic:** sending (Mark sent, or a send noticed in Gmail), logging a call/email/meeting/
  tasting, or moving a deal past its first stage makes a To reach out or Ghosted record *Know them*; a reply makes a
  Ghosted one *Know them*. Ghosted is computed when CRM pages load (and by the daily job).
- **"Already contacted"** for the routines becomes "relationship is not To reach out" (replacing the activity/stage
  heuristic), so Try again works and nothing is drafted for anyone you know, have dismissed or put on hold.
- **Approving moves into SQL** (`rr_approve_item`), so research ingest can add people to the CRM directly; the app's
  approve uses the same function. Prospects added to General get no reminder priority until you know them.
- **Hand-added investor partners**: contacts that belong to an institution with an Investors deal are reached through
  that deal; they stop being synced as separate angel candidates (and the existing synced ones are removed).
- **Digest**: still lists new people (now "added to To reach out") and new opportunities, linking into the CRM and
  the Opportunities tab.
- **Old links**: `/radar` redirects to `/opportunities`.

## Non-goals

- No change to pipeline stages, deal fields, or the Restaurants UI beyond the relationship filter it inherits.
- Institutions are not shortlist candidates (they have no person to email); unchanged.

## Anti-goals

- Losing anyone: every Radar person must end up in the CRM (or stay dismissed); triage already done is kept.
- A draft or follow-up for someone who is Dismissed, On hold, or already known.
- Reminders nagging about people you have never met.

## Calls made after the builder check (mine)

1. **Ghosted** applies to people the outreach system tracks: outreach stage *sent* (no reply), no further follow-up
   scheduled (the cadence ended: three touches, or a send with no follow-ups left), and the last touch more than 7 days
   ago. Rows with no recorded touch date (old hand-marked sends) are left alone. Being Ghosted stops pending follow-ups.
2. **Try again** puts the person back in To reach out: the outreach row is reset (stage prospect, touches 0, drafts and
   Gmail approval cleared, earlier Gmail message records removed — the CRM timeline keeps the history) and they become
   a shortlist candidate again, waiting for approval like anyone else. The todo marks them `retry: true` and the
   routine writes a short "circling back" note that acknowledges the earlier emails instead of a cold introduction.
3. **Institution partners**: only synced partner records with no outreach progress (prospect/drafted, not approved
   for Gmail, no Gmail messages) are removed; anything already in motion stays until its thread ends.
4. **Reminders** never start by themselves. A contact moving to Know them keeps whatever priority it has; people
   added from research get no priority; the owner sets one when they want reminders. Radar-added General contacts that
   were given `high` and were never contacted are reset to no priority.
