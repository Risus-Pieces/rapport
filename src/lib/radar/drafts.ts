import { defaultPurpose, isPurpose, type Purpose, type RadarDetails } from "./types";

/**
 * Deterministic outreach drafts (the weekly routine writes richer, personalised ones) and the
 * human-send helpers. Drafts use only the pitch facts and the person's sourced details.
 */

// Pitch profile (stored in app_settings as pitch.* keys)

export const PITCH_FIELDS = [
  { key: "pitch.company", label: "Company", placeholder: "Sooz Beverage" },
  { key: "pitch.website", label: "Website", placeholder: "drinksooz.com" },
  { key: "pitch.one_liner", label: "One-liner", placeholder: "What Sooz is, in one sentence" },
  { key: "pitch.traction", label: "Traction (verified facts only)", placeholder: "e.g. 40 retail doors in Houston; 32% repeat rate" },
  { key: "pitch.raise", label: "Instrument (launch ask only)", placeholder: "e.g. SAFE (leave blank to not mention)" },
  { key: "pitch.deck_url", label: "Deck link (launch ask only)", placeholder: "DocSend / Drive link (optional)" },
  { key: "pitch.sender_name", label: "Sender name", placeholder: "Your name" },
  { key: "pitch.sender_title", label: "Sender title", placeholder: "Co-founder & CEO" },
  { key: "pitch.sender_email", label: "Send from (Google account)", placeholder: "you@drinksooz.com" },
  { key: "pitch.rice_affiliation", label: "Your Rice affiliation", placeholder: "e.g. Rice '25 (blank if none)" },
  { key: "pitch.calendar_url", label: "Calendar link", placeholder: "Optional" },
] as const;
export type PitchKey = (typeof PITCH_FIELDS)[number]["key"];
export type Pitch = Partial<Record<PitchKey, string>>;

/** Facts a draft can't be written without. */
export function missingPitch(p: Pitch): string[] {
  const required: PitchKey[] = ["pitch.company", "pitch.one_liner", "pitch.sender_name"];
  return required.filter((k) => !p[k]?.trim()).map((k) => PITCH_FIELDS.find((f) => f.key === k)!.label);
}

// Drafting

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

export interface DraftInput {
  name: string;
  details: RadarDetails | null;
  why_relevant: string;
  warm_path: string | null;
  kind?: string;
  purpose?: Purpose | string;
}

/** A short, factual hook from the person's public evidence. Never invents anything. */
function hook(p: DraftInput, purpose: Purpose): string {
  const d = p.details ?? {};
  const fallback: Record<Purpose, string> = {
    invest: "I came across your work backing early-stage consumer brands",
    ambassador: "I've been following your work with consumer brands",
    buyer: "I came across your work in the beverage category",
    press: "I've been reading your coverage of food and beverage brands",
    intro: "I came across your work in the consumer and food & beverage community",
  };
  if (d.role && d.firm) return `I came across your work as ${d.role} at ${d.firm}`;
  if (d.firm) return `I came across your work with ${d.firm}`;
  return fallback[purpose];
}

export interface Drafts {
  subject: string;
  body: string;
  linkedin_note: string;
  intro_request: string | null;
  followup_1: string;
  followup_2: string;
}

/** What each purpose asks for, in a first note and in follow-ups. None of these ever offers equity or terms. */
const ASKS: Record<Purpose, { ask: string; note: string; nudge: string; intro: string }> = {
  invest: {
    ask: "I'd value 20 minutes of your perspective on building in the category — and, if it's interesting, I'm happy to share more about what we're doing.",
    note: "I'd love to connect and learn from your perspective on the category.",
    nudge: "Would a 20-minute call in the next couple of weeks work?",
    intro: "I'd value their perspective on the category.",
  },
  ambassador: {
    ask: "We'd love to send you some to try, no strings attached. If you like it, I'd welcome a quick conversation about a collaboration that fits how you already work with brands.",
    note: "We'd love to send you some to try, no strings attached.",
    nudge: "Happy to ship some over to try — just tell me where (or your team's preferred address).",
    intro: "I'd love to send them product and explore a collaboration.",
  },
  buyer: {
    ask: "Could I have 15 minutes to hear what's working in your beverage set, or drop off samples for your team to try?",
    note: "I'd love 15 minutes to learn what's working in your set, or to drop off samples.",
    nudge: "Would 15 minutes, or a sample drop-off for your team, work in the next couple of weeks?",
    intro: "I'd love 15 minutes to learn what's working in their category.",
  },
  press: {
    ask: "If it's a fit for something you're working on, I'm happy to send samples or do a short interview.",
    note: "Happy to send samples or do a short interview if it's ever a fit.",
    nudge: "Happy to send samples or hop on a quick call if the story is useful.",
    intro: "I think there may be a story there for them.",
  },
  intro: {
    ask: "Is there anyone in your network who works with early-stage beverage brands you'd be comfortable introducing me to? I'd be grateful for any pointer.",
    note: "I'd love to connect and learn who you'd suggest I talk to.",
    nudge: "If anyone comes to mind, I'd be grateful for a pointer — and if not, no worries at all.",
    intro: "I'd value their advice on who to talk to.",
  },
};

export function templateDrafts(p: DraftInput, pitch: Pitch): Drafts {
  const purpose: Purpose = p.purpose && isPurpose(p.purpose) ? p.purpose : defaultPurpose(p.kind ?? "angel");
  const A = ASKS[purpose];
  const fn = firstName(p.name);
  const company = pitch["pitch.company"]?.trim() || "[Company]";
  const oneLiner = pitch["pitch.one_liner"]?.trim() || "[one-line description]";
  const sender = pitch["pitch.sender_name"]?.trim() || "[Your name]";
  const title = pitch["pitch.sender_title"]?.trim();
  const site = pitch["pitch.website"]?.trim();
  const traction = pitch["pitch.traction"]?.trim();
  const cal = pitch["pitch.calendar_url"]?.trim();
  const myRice = pitch["pitch.rice_affiliation"]?.trim();
  const theirRice = p.details?.rice_connection?.trim();
  const bothOwls = Boolean(myRice && theirRice);
  const tagline = oneLiner.split(/[.,;—-]/)[0].trim().slice(0, 60);

  const subject = bothOwls
    ? `Fellow Owl building ${company}`
    : purpose === "ambassador"
      ? `Can we send you some ${company}?`
      : purpose === "buyer"
        ? `${company} for ${p.details?.firm?.split(/[;|]/)[0].trim() || "your shelves"}: 15 minutes?`
        : purpose === "press"
          ? `Story idea: ${myRice ? "a Rice student founder building " : ""}${company}`
          : purpose === "intro"
            ? `Quick ask from a ${company} founder`
            : `${company}: ${tagline}`;

  // First notes never mention the round, its amount, instrument or deck: the raise is only shared with people
  // the owner has already talked to (Reg D 506(b); see the launch ask in the routines).
  const ask = A.ask;
  const pressAngle = purpose === "press" && myRice ? `\nThe angle: a Rice student (${myRice}) building a beverage brand from campus.` : "";

  const lines = [
    `Hi ${fn},`,
    "",
    `${hook(p, purpose)}${bothOwls ? ` — and as a fellow Rice alum (${myRice}), I wanted to reach out directly` : ""}.`,
    "",
    `I'm ${sender}${title ? `, ${title}` : ""} of ${company}. ${oneLiner}`,
    traction ? `\n${traction}` : "",
    pressAngle,
    "",
    ask,
    cal ? `If easier, here's my calendar: ${cal}` : "",
    "",
    "Best,",
    sender,
    [title, company].filter(Boolean).join(", ") + (site ? ` · ${site}` : ""),
  ];
  const body = lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const note = (
    bothOwls
      ? `Hi ${fn} — fellow Owl (${myRice}) here. I'm building ${company}: ${oneLiner} ${A.note}`
      : `Hi ${fn} — I'm building ${company}: ${oneLiner} ${A.note}`
  ).slice(0, 300);

  const intro = p.warm_path?.trim()
    ? [
        `Hi [mutual],`,
        "",
        `Hope you're well! I'm building ${company} — ${oneLiner}`,
        `Would you be comfortable introducing me to ${p.name}${p.details?.firm ? ` (${p.details.firm})` : ""}? ${A.intro}`,
        "",
        "Here's a short blurb you can forward:",
        `"${sender} is building ${company}. ${oneLiner}${traction ? ` ${traction}` : ""} They'd love to connect with ${fn}."`,
        "",
        "Totally fine if not — thank you either way!",
        sender,
      ].join("\n")
    : null;

  const followup_1 = [
    `Hi ${fn},`,
    "",
    `Quick follow-up on my note about ${company}.${traction ? ` Since then: ${traction}` : ""} ${A.nudge}`,
    "",
    sender,
  ].join("\n");

  const followup_2 = [
    `Hi ${fn},`,
    "",
    `Last note from me — I know inboxes are busy. If ${company} isn't a fit right now, no worries at all; I'd still love to keep you posted as we grow.`,
    "",
    sender,
  ].join("\n");

  return { subject, body, linkedin_note: note, intro_request: intro, followup_1, followup_2 };
}

// Send helpers (a person always sends)

/** Gmail compose deep link. Opens a pre-filled draft in the browser; nothing is sent automatically. */
export function gmailComposeUrl(o: { to?: string | null; subject?: string | null; body?: string | null; from?: string | null }): string {
  const p = new URLSearchParams({ view: "cm", fs: "1", tf: "1" });
  if (o.to) p.set("to", o.to);
  if (o.subject) p.set("su", o.subject);
  if (o.body) p.set("body", o.body);
  if (o.from) p.set("authuser", o.from);
  return `https://mail.google.com/mail/?${p.toString()}`;
}

export function linkedinSearchUrl(name: string, firm?: string | null): string {
  const q = [name, firm].filter(Boolean).join(" ");
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
}

