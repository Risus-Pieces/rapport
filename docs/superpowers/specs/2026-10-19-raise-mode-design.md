# Raise mode — Design

Date: 2026-10-19
Status: Draft for the owner

## Intent and why

The Radar works, but it hands the owner far more people than one student founder can review, and each person needs
four manual steps (review, approve into the CRM, work out what to ask, write and send). That is tedious, so outreach
does not happen. The owner's goal for the next few months is **money: a $75k pre-seed round for Sooz**, which has a
deck but **has not launched** (launch around December 2026 – January 2027). They want to raise **slowly, around
launch**, not in a sprint.

So Rapport should work like a small sales team: the routines do the research, ranking and writing; the owner spends
about 30 minutes a week approving a short batch and sending drafts that are **already in their Gmail Drafts folder**,
plus taking the calls. Relationships are built now with advice asks; the money ask goes out at launch, only to people
the owner has actually talked to.

## Goals

1. **A raise goal** in the app: target $75,000, launch date (editable), and a phase: *Building relationships* (until
   launch) → *Raising* (the owner flips it when they launch).
2. **A weekly shortlist** (Mondays): about **4 investors + 2 buyers/cafés**, each with a one-line reason and the specific
   ask, ranked for a pre-launch raise (warm paths and people who back pre-revenue founders first; famous
   "come back after launch" angels lower). One **Approve all** (with per-row uncheck). Shortlisted people the owner skips
   are not offered again for 8 weeks. The Radar inbox stays as a reference, but nothing requires reviewing it.
3. **Drafts straight to Gmail.** For approved people, the routine creates the email as a **Gmail draft** (never sends).
   The owner opens Gmail, edits if they like, and hits send.
4. **One "This week" screen**: the shortlist to approve, drafts waiting in Gmail, follow-ups due, applications due
   (competitions and accelerators with deadlines), and recent replies.
5. **Relationship tracking for the raise**: after a conversation the owner marks **Advice call done** on the investor's
   deal, which makes them **Ready to hear the raise**. A progress bar on Investors shows committed and soft-circled
   amounts against $75k.
6. **Monthly update** (first Monday of each month, Building phase): one short update drafted per "ready" person from the
   owner's facts (progress, one ask, what's next), as individual Gmail drafts.
7. **Launch ask**: when the owner switches to *Raising*, the routine drafts a "we launched, here's what we're seeing,
   we're raising $75k" note for every *ready* person, as Gmail drafts.
8. **Existing people are included**, not just new research:
   - the ~22 investors the owner added to the CRM by hand (no Radar finding behind them) are candidates for the
     shortlist and get outreach like anyone else;
   - deals already past Target (4 at Intro) are treated as already contacted (no first-touch draft; follow-ups and the
     "advice call done" flag apply);
   - the 90 unreviewed Radar angels and other people are re-ranked for the pre-launch raise and feed the shortlist;
   - the 69 General contacts count as warm paths (a contact at the same firm as a candidate = "ask <name> for an intro").
9. **Weekly nudge to refresh traction**: if the pitch "traction" fact is older than 14 days, the This week screen asks
   for an update (sampling results, café interest, waitlist), because drafts may only cite those facts.

## Non-goals

- No automatic sending, ever. No bulk email tool, no mail merge, no BCC lists.
- No new email provider or Google OAuth in the app: Gmail drafts are created by the routine through the Gmail connector.
- No investor CRM features beyond what the round needs (no cap table, no SAFE generation, no data room).
- Personal and Career feeds are unchanged.

## Anti-goals

- **Pitching the round to strangers.** The launch ask and monthly updates go only to people marked *Advice call done*
  (Reg D 506(b): no general solicitation; a pre-existing relationship first). First notes stay advice asks.
- Duplicate Gmail drafts for the same person, or a draft landing in Gmail after the owner already sent one.
- The owner having to review the full Radar to keep the raise moving.
- Routine database access widening beyond fixed `rr_*` functions run as `radar_routine`.

## Constraints

- Everything from the Radar design still holds (`docs/superpowers/specs/2026-10-14-radar-merge-design.md`): owner-scoped
  rows, `rr_*` SECURITY DEFINER functions, `radar_routine` role with EXECUTE only, Next.js 16 conventions, tests on the
  Neon dev branch, routines as desktop scheduled tasks reading `routines/*.md`.
- Gmail connector tools available to routines include `create_draft` and `search_threads`. Drafts land in whichever
  Gmail account the connector is signed into; the routine must check it matches the pitch "send from" address and skip
  (and report) if not.
- Apollo budget stays ≤ 5 lookups per run.
- Current production data: 26 investor contacts (4 from the Radar), 24 investor deals (20 Target, 4 Intro), 69 General
  contacts, 10 outreach rows, pitch facts filled.

## How it works (decided)

- **Shortlist**: built by the Monday outreach routine (after research), stored per week, shown on This week. Approve all
  runs the existing approve-into-CRM for Radar people and opens outreach for existing CRM people, then marks them ready
  for drafting.
- **Gmail drafts**: a new **daily** scheduled task (mornings) creates Gmail drafts for approved people whose draft is
  written but not yet in Gmail, records the Gmail draft id so it never duplicates, and checks Gmail for sends and
  replies (which log the activity, follow-up task and stage move exactly as *Mark sent* / *They replied* do today).
  Once a draft is in Gmail, the app shows it as "In your Gmail drafts" and edits happen in Gmail.
- **Phases**: *Building* shortlists favour advice asks to warm and pre-revenue-friendly investors plus buyers/cafés
  (whose interest is proof for investors); *Raising* switches investor asks to the raise for *ready* people and keeps
  shortlisting new warm investors.

## Calls made after the builder check (mine; the owner can overrule)

1. **When drafts are written.** The Monday routine drafts the whole shortlist *before* approval, so the owner sees the
   actual ask while approving; the daily task only pushes already-written drafts to Gmail and watches for sends and
   replies. Pre-drafting becomes shortlist-only: the old "every unapproved 75+ person" pre-drafting stops. Apollo
   lookups (≤ 5 per run) go to shortlisted investors first; buyers and cafés use published business contacts.
2. **No raise in first notes.** First notes to anyone not marked *Advice call done* are advice asks and never mention the
   round, the amount or terms (the old "starting conversations ahead of our <raise>" line is removed). The launch ask
   names the amount from the raise goal ($75k); it names the instrument only if the owner fills the existing
   pitch "raise" fact (e.g. "SAFE"), and never valuation or terms. The raise goal replaces `pitch.raise` as the amount.
3. **Follow-ups are Gmail drafts too**, created by the daily task when due (day 5, then day 12, three touches max), as
   replies in the original Gmail thread when the connector supports it, otherwise as a new draft with "Re: <subject>".
   Each Gmail draft is recorded per message so none is created twice, and none is created once the owner has replied
   or been replied to.
4. **Replies to the new messages.** A reply to the launch ask logs an email activity and moves the investor's deal to
   *Pitched* (if it is earlier); the launch ask gets one follow-up after 7 days. Monthly updates get no follow-ups; a
   reply just logs an activity and shows on This week.
5. **Monthly update facts.** A small "This month" form (progress, one ask, what's next). If the owner hasn't updated it
   since the last update went out, the routine skips that month's update and the This week screen nudges instead —
   it never repeats or invents content.

## Left to the builder

Data model details (e.g. how outreach attaches to CRM contacts that have no Radar finding), the exact ranking prompt,
screen layout within Rapport's existing look, the daily task's time, and how the progress bar defines "soft-circled"
(a sensible default: open investor deals at Follow-up or Term sheet with an amount set).
