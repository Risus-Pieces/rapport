import { PERSON_KINDS, type Feed } from "./types";

/**
 * Research tasks. Each task is one focused agent run (search -> notes -> structured extraction).
 * Narrow tasks beat one giant prompt: better recall, easier to debug, and one failure doesn't sink the rest.
 *
 * To change what the tool hunts for, edit the profiles and task briefs below.
 */

export interface ResearchTask {
  id: string;
  feed: Feed;
  label: string;
  /** Item kinds this task is allowed to emit. */
  kinds: readonly string[];
  /** What to find. Interpolated into the shared research prompt. */
  brief: string;
  /** Whether findings are time-boxed (events) — enables the "must be upcoming" rule. */
  upcomingOnly: boolean;
  maxSearches: number;
}

export const SOOZ_PROFILE = `Sooz is a pre-seed food and beverage consumer packaged goods (CPG) startup.
It is raising its first outside capital (angel / pre-seed) and is run by a Rice University undergraduate in Houston.
Founders want:
(1) reachable angel investors and operators who back early-stage food & beverage brands,
    with a strong preference for Rice University alumni (warm intros),
(2) people who can open doors: celebrities, athletes and creators as investors or brand partners, next-generation
    investors from prominent families, retail buyers and distributors, and journalists and podcasters,
(3) events where they can meet investors, retail buyers, distributors and other founders, and places to sample product,
(4) funding sources and resources suited to a pre-revenue / early-revenue CPG brand.`;

export const PERSONAL_PROFILE = `The user is a Rice University undergraduate (class of 2029) in Houston: founder-minded, technically
curious, with broad interests. Strongest interests: AI and startups (hackathons, builder events, demo days), leadership
development, cultural opportunities, and great events of every kind around Houston. They are also open to "anything
interesting": fellowships, unusual programs, competitions, talks, free passes to big conferences, speaking slots, and
student perks.`;

export const CAREER_PROFILE = `The user is a Rice University undergraduate, class of 2029 (a sophomore in the 2026-27 school year).
Career interests: consumer, retail, bio/biotech, venture capital, private equity, AI and hardware. Location: anywhere,
remote is fine. They want internships, externships, early-insight / discovery / diversity programs, fellowships (including
VC fellowships and scout programs) and scholarships. Always state the application deadline when one is published and
whether sophomores (class of 2029) are eligible.`;

export const PROFILES: Record<Feed, string> = { sooz: SOOZ_PROFILE, personal: PERSONAL_PROFILE, career: CAREER_PROFILE };

/** Rules every people-finding task shares (celebrities, next-gen, creators, buyers, press). */
const PEOPLE_RULES = `Each item is ONE PERSON (title = full name); never submit a company, fund, agency or list as an item.
Adults only. Public professional activity only: never personal emails, phone numbers, home addresses, family members who
are not public figures themselves, or private social accounts. Put the company / team / agency in firm, the role in role,
and the most credible PUBLIC contact route in contact_path (official site, agency or management roster, a "business
inquiries" address the person or their team publishes, a company press page, a pitch form).`;

const SOOZ = "sooz" as const;
const PERSONAL = "personal" as const;
const CAREER = "career" as const;

export const TASKS: ResearchTask[] = [
  {
    id: "sooz-angels-rice",
    feed: SOOZ,
    label: "Angels: Rice network (individuals)",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 12,
    brief: `Find INDIVIDUAL PEOPLE connected to Rice University who could invest in or open doors for a pre-seed beverage
brand: Rice alumni who angel invest, Rice-affiliated angel-network leads and members, Rice Business Plan Competition
judges and investor-panelists, Rice Alliance / Liu Idea Lab (Lilie) / OwlSpark mentors and advisors who invest,
Rice Business (Jones) alumni at consumer funds, and Rice alumni who founded or ran CPG/food/beverage brands.
Each item is ONE PERSON (title = full name). Never submit a group, fund or program as an item — if you only find a
group, search for its publicly named leaders, committee chairs or members and submit them instead.
Fill firm, role, rice_connection (only if a source states it, e.g. "MBA '09"), check_size (only if stated), and
contact_path: the most credible public route (e.g. "Rice Alliance mentor — ask the Rice Alliance team for an intro",
"judge at RBPC 2026"). Prefer people with evidence of consumer/CPG/food interest; still include strong Rice
connectors (score lower if no consumer signal). Never guess or invent emails or phone numbers.`,
  },
  {
    id: "sooz-angels-cpg",
    feed: SOOZ,
    label: "Angels: beverage & CPG operators (individuals)",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 14,
    brief: `Find INDIVIDUAL angel investors who wrote pre-seed or seed checks into beverage, food or CPG brands in the last
24 months. The best evidence is a round announcement that names them, so mine recent funding news: search BevNET,
NOSH, Taste Radio, Food Dive, FoodNavigator-USA, Indie CPG, PR Newswire and Business Wire for phrases like
"participation from angel investors including", "seasoned CPG operators", "other participants included" together
with "pre-seed" or "seed" and "beverage". Also look at operator-angels (founders/executives of scaled or exited
beverage and CPG brands), CPG angel-group partners (e.g. The Angel Group / Supernatural Ventures, Consumer Packaged Growth on
AngelList), investor judges and panelists at BevNET's New Beverage Showdown and "Meet the Angels" panels, Expo West
Pitch Slam and Naturally Rising pitch events, Startup CPG "Investor Spotlight" guests, and NFX Signal / OpenVC food &
beverage angel lists (aggregator lists only as leads: confirm each person on a primary source). Each item is ONE PERSON
(title = full name) with firm/role, a one-line proof in summary naming the brands they backed and when, check_size
only if stated, and a public contact_path (syndicate page, community, podcast, event). Score higher for beverage
specifically, for repeat recent checks, and for Texas ties. Never submit a fund or group as an item.`,
  },
  {
    id: "sooz-angels-texas",
    feed: SOOZ,
    label: "Angels: Texas consumer investors (individuals)",
    kinds: ["angel"],
    upcomingOnly: false,
    maxSearches: 12,
    brief: `Find INDIVIDUAL angel investors in Texas who back early-stage consumer/CPG brands. Austin is the Texas CPG hub:
look at SKU accelerator mentors, investors and demo-day judges, Naturally Austin leaders, Springdale Ventures partners,
Central Texas Angel Network members active in consumer, and Austin founders/executives of brands that scaled or exited (beverage, snacks, natural foods) who now
angel invest. Also Houston (Houston Angel Network consumer committee members, TiE Houston Angels food & beverage
investors, Houston consumer founders who invest) and Dallas (consumer angels, Dallas Angel Network). Each item is ONE
PERSON with evidence of consumer/CPG angel activity (named portfolio brands, a quote, a committee role), check_size
only if stated, and a public contact_path. Never submit a group as an item; find its named people.`,
  },
  {
    id: "sooz-events-cpg",
    feed: SOOZ,
    label: "Events: CPG & food/bev",
    kinds: ["event"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find upcoming CPG and food & beverage industry events a pre-seed brand should attend or apply to:
trade shows and expos (natural/specialty food, beverage, retail), retailer pitch days / buyer meetings,
CPG founder conferences, food-tech and food-innovation summits, distributor and broker showcases, and
food/bev pitch competitions. Prefer events in the next 6 months; include region, price/application notes in
summary, and an application or registration deadline when one exists. Use kind "event".`,
  },
  {
    id: "sooz-events-fundraising",
    feed: SOOZ,
    label: "Events: fundraising & investors",
    kinds: ["event", "funding"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find upcoming fundraising-related opportunities for a pre-seed startup raising angel money:
investor meetups and angel-group pitch nights, demo days, startup pitch competitions (esp. consumer / food /
Texas / Rice-affiliated, e.g. Rice Business Plan Competition), fundraising workshops, and general startup
networking events where angels attend. Use kind "event" for events and kind "funding" for applications with a
deadline (accelerators, pitch-competition applications, non-dilutive grants). Include deadline dates.`,
  },
  {
    id: "sooz-resources",
    feed: SOOZ,
    label: "Funding, programs & resources",
    kinds: ["funding", "resource"],
    upcomingOnly: false,
    maxSearches: 10,
    brief: `Find other things that would genuinely help a pre-seed food & beverage CPG startup:
accelerators and incubators for food/bev/CPG (with open application windows), non-dilutive grants and
competitions (USDA, state, SBA, corporate), corporate beverage venture and accelerator programs (e.g. the venture
arms and emerging-brand programs of large beverage and food companies, with open application windows), co-manufacturing / co-packer directories and communities,
retail/distribution programs for emerging brands (e.g. retailer emerging-brand programs), notable recent
CPG funding news or investor theses worth knowing, and founder communities. Use kind "funding" for anything
with money or an application; "resource" for everything else. Include deadlines when they exist.`,
  },
  {
    id: "sooz-celebrities",
    feed: SOOZ,
    label: "Celebrities & athletes (investors and brand partners)",
    kinds: ["celebrity"],
    upcomingOnly: false,
    maxSearches: 14,
    brief: `Find celebrities and professional athletes who invested in, launched or partnered with beverage, CPG or wellness
brands: mine round announcements that name celebrity investors and brand-partnership news (BevNET, NOSH, Food Dive,
Forbes, Sports Business Journal). Prioritise Houston natives and Houston pro athletes (Texans, Rockets, Astros, Dynamo,
Dash), Rice / University of Houston / University of Texas alumni with public profiles, Texas musicians, and chefs and food
personalities. ${PEOPLE_RULES} Summary names the brands they backed or partnered with and when. Tag "investor" when they
invested and "ambassador" when they partnered. Score higher for beverage deals, Houston/Texas ties, wellness fit, and a
reachable tier (mid-tier and local stars beat megastars).`,
  },
  {
    id: "sooz-nextgen",
    feed: SOOZ,
    label: "Next-gen investors (heirs, family offices)",
    kinds: ["nextgen"],
    upcomingOnly: false,
    maxSearches: 10,
    brief: `Find adult children and heirs of famous founders, celebrities and prominent (especially Texas / Houston) business
families who PUBLICLY invest: run or work at a family office or venture fund, angel invest in consumer brands, or run their
own consumer brand. Evidence must be their own public professional activity (fund page, portfolio announcement, interview,
conference bio), not gossip or family coverage. ${PEOPLE_RULES} Score higher for consumer / food & beverage investing,
Houston/Texas ties and early-stage activity.`,
  },
  {
    id: "sooz-creators-nil",
    feed: SOOZ,
    label: "Creators & college athletes (NIL)",
    kinds: ["creator"],
    upcomingOnly: false,
    maxSearches: 12,
    brief: `Find (1) food, drink and wellness creators (Texas first) who partner with or own stakes in brands, and (2) college
athletes at Rice, University of Houston, UT Austin and Texas A&M with NIL deals, especially beverage NIL deals (sources:
school NIL news, On3 / Opendorse coverage, local sports media). ${PEOPLE_RULES} For athletes, role = sport and school; only
include athletes who are adults (college athletes, not high-school recruits). For creators, firm = their media brand or
management. Score higher for beverage deals, Houston ties and engaged mid-size audiences.`,
  },
  {
    id: "sooz-buyers",
    feed: SOOZ,
    label: "Retail buyers, distributors & buyer events",
    kinds: ["buyer", "event"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find (1) beverage buyers and category managers at H-E-B, Whole Foods Market (Southwest region), Central Market,
Kroger (Houston division), Buc-ee's, Sprouts, and specialty grocers and cafés in Houston/Texas, plus Texas beverage
distributor and broker principals (kind "buyer", one person per item, as named in trade press, retailer announcements,
conference speaker lists or company pages); and (2) buyer pitch days, ECRM sessions, retailer open calls and local-product
programs (kind "event", only if they have not happened yet; include the date or application deadline). ${PEOPLE_RULES}
Score higher for H-E-B / Central Market (Houston-based) and for events with an open application.`,
  },
  {
    id: "sooz-media",
    feed: SOOZ,
    label: "Press, podcasts & awards",
    kinds: ["media", "funding"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find (1) journalists and editors who cover beverage / CPG and Houston food or startups (BevNET, NOSH, Food Dive,
Houston Chronicle food, InnovationMap, Houston Business Journal, Rice Thresher) and hosts of podcasts that take founder
guests (Taste Radio, Startup CPG and similar), kind "media", one person per item with their outlet in firm, their beat in
role, and the outlet's public tips / pitch / guest route in contact_path; and (2) awards and competitions for food &
beverage brands that take applications (kind "funding", with the deadline). ${PEOPLE_RULES} Score higher for Houston
outlets and for beats that cover emerging beverage brands.`,
  },
  {
    id: "sooz-sampling",
    feed: SOOZ,
    label: "Sampling & vendor slots",
    kinds: ["sampling"],
    upcomingOnly: true,
    maxSearches: 10,
    brief: `Find Houston and Texas festivals, races, farmers and makers markets, campus events (Rice, UH) and corporate events
that are recruiting food & beverage vendors, sponsors or sampling partners, plus retailer demo / sampling programs. Each
item is one opportunity with its date, the vendor application deadline and any fees in summary. Use kind "sampling".
Score higher for large, health-minded or young audiences in Houston and for open applications.`,
  },
  {
    id: "personal-ai-startup",
    feed: PERSONAL,
    label: "AI & startup: hackathons, demo days, perks",
    kinds: ["hackathon", "event", "grant", "perk"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find upcoming AI and startup opportunities: hackathons (in person near the home base and notable
virtual / travel-worthy ones), AI builder events and meetups, demo days, startup weeks and founder conferences,
AI grants, and fellowships or competitions for builders. Prefer things with concrete dates, and include application
deadlines. Kinds: "hackathon", "event", "grant" (money), "perk" (cloud / AI credits and student tool deals, e.g. free
credits for student founders or .edu discounts on AI and developer tools; perks need no date).`,
  },
  {
    id: "personal-leadership-culture",
    feed: PERSONAL,
    label: "Leadership & cultural opportunities",
    kinds: ["leadership", "culture", "event", "grant"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find leadership-development and cultural opportunities: leadership fellowships and programs for
young professionals / founders (cohort-based, with applications), speaker series, civic and nonprofit board
programs, cultural festivals, exhibitions, performances, food/arts/community events, language and cultural
exchange programs, and notable lectures. Near the home base first, then notable virtual or travel-worthy options.
Kinds: "leadership", "culture", "event", "grant".`,
  },
  {
    id: "personal-wildcard",
    feed: PERSONAL,
    label: "Wildcard: anything interesting",
    kinds: ["other", "event", "grant", "culture", "leadership", "hackathon", "talk"],
    upcomingOnly: true,
    maxSearches: 10,
    brief: `Surprise the user. Find unusual, high-quality opportunities that a curious founder-minded person
with broad interests would love but would not think to search for: competitions with big prizes, residencies,
travel grants, unusual cohorts, notable one-off events, open calls, and special programs opening soon.
Avoid generic listicles and anything that is just an ad. Quality over quantity: 3-6 great finds beats 15 mediocre ones.`,
  },
  {
    id: "personal-events",
    feed: PERSONAL,
    label: "Houston events (Luma, Eventbrite & more)",
    kinds: ["event", "culture", "talk"],
    upcomingOnly: true,
    maxSearches: 14,
    brief: `Find cool upcoming events of every kind around Houston, plus notable virtual ones. Search event platforms directly:
Luma (site:lu.ma Houston, lu.ma/houston), Eventbrite (Houston), Meetup, public Partiful pages, Do713, Houston Press, and the
Rice and University of Houston event calendars. Cover AI/tech, founders and startups, food & drink, music, art, culture and
wellness. Also find notable people visiting Houston (book talks, speaker series, office hours, fireside chats) and use kind
"talk" for those. Use kind "event" for builder/tech/founder events and "culture" for arts, music, food and festivals. Give
each item its own event page URL, the date, the venue and the price (free / $) in summary.`,
  },
  {
    id: "personal-passes-speaking",
    feed: PERSONAL,
    label: "Free passes, speaking & op-ed calls",
    kinds: ["pass", "speaking"],
    upcomingOnly: true,
    maxSearches: 10,
    brief: `Find (1) free student or volunteer passes and scholarships to attend major conferences (SXSW, Web Summit,
TechCrunch Disrupt, CES, Natural Products Expo West, Collision-style events and similar) as kind "pass", and (2) calls for
speakers or student panelists, podcast guest calls, pitch slots for student founders and student op-ed calls as kind
"speaking". Include the application deadline and eligibility (students / undergraduates) in summary.`,
  },
  {
    id: "career-internships",
    feed: CAREER,
    label: "Internships (summer 2027)",
    kinds: ["internship", "job"],
    upcomingOnly: true,
    maxSearches: 14,
    brief: `Find summer 2027 internships open to sophomores (class of 2029) at startups, consumer & retail brands, biotech, AI
and hardware companies, and VC and PE firms. Sources: Y Combinator's Work at a Startup, Wellfound, Simplify's GitHub
internship lists, company career pages, and NSF REU and similar paid research programs for bio / AI / hardware. One role per
item: title = "<Company>: <role>", firm = the company, deadline when stated, location (or "remote"), and in summary whether
sophomores are eligible. Use kind "job" only for part-time or term-time roles that suit a full-time student. Also flag (kind
"internship", tag "recruiting-timeline") when junior-summer 2028 banking / PE / consulting recruiting opens, since it starts
early. Skip roles that require graduation before 2028 or that are clearly closed.`,
  },
  {
    id: "career-programs",
    feed: CAREER,
    label: "Early-insight, sophomore & diversity programs",
    kinds: ["program"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find early-insight, discovery, sophomore and diversity programs at investment banks, private-equity and growth firms,
venture firms, consulting firms and consumer / retail companies (e.g. "sophomore insight program", "early careers
discovery", "diversity summit") that class-of-2029 students can apply to. Include the program dates, the application
deadline and eligibility in summary. One program per item.`,
  },
  {
    id: "career-externships",
    feed: CAREER,
    label: "Externships, shadowing & job simulations",
    kinds: ["externship", "program"],
    upcomingOnly: true,
    maxSearches: 10,
    brief: `Find winter-break and spring externships and shadowing programs, paid micro-internships (e.g. Parker Dewey),
Extern projects, Forage job simulations in consumer, retail, biotech, VC, PE, AI and hardware, and university externship
programs (including Rice's). One opportunity per item, with deadline and dates when stated and who is eligible.`,
  },
  {
    id: "career-fellowships",
    feed: CAREER,
    label: "Fellowships, scout programs & scholarships",
    kinds: ["fellowship", "scholarship"],
    upcomingOnly: true,
    maxSearches: 12,
    brief: `Find VC fellowships, venture scout programs and student-run venture funds open to undergraduates, and undergraduate
fellowships and scholarships in AI, bio, hardware and entrepreneurship (national programs and Rice-specific ones). One
program per item, with the application deadline and eligibility (year in school, citizenship if stated) in summary. Skip
programs whose most recent deadline has passed with no next cycle announced.`,
  },
];

export function tasksFor(feed?: Feed, taskId?: string): ResearchTask[] {
  return TASKS.filter((t) => (!feed || t.feed === feed) && (!taskId || t.id === taskId));
}

export interface PromptContext {
  today: string; // YYYY-MM-DD
  homeBase: string;
  known: string[]; // titles already in the database (so the agent finds NEW things)
}

export function buildResearchPrompt(task: ResearchTask, ctx: PromptContext): string {
  const profile = PROFILES[task.feed];
  const known = ctx.known.length
    ? `\nAlready in the database (do NOT repeat these; find new ones):\n${ctx.known
        .slice(0, 150)
        .map((t) => `- ${t}`)
        .join("\n")}\n`
    : "";
  const upcoming = task.upcomingOnly
    ? `\nAnything with a date or deadline must NOT have passed as of ${ctx.today} (undated people and resources are fine). Skip anything past. Prefer the next 6 months.`
    : "";

  return `Today's date: ${ctx.today}. Home base: ${ctx.homeBase}.

CONTEXT
${profile}

YOUR TASK: ${task.label}
${task.brief}
${upcoming}
${known}
HOW TO WORK
- Run searches (up to ${task.maxSearches}), open the most promising results, and cross-check key facts.
- Aim for 8-15 solid findings. Fewer excellent ones beat many weak ones.
- For every finding, note: name/title, the exact source URL you saw, what it is, why it fits, any dates
  (YYYY-MM-DD), location, and a fit score 0-100 (80+ = strong fit and actionable soon, 60-79 = good,
  45-59 = maybe, below 45 = leave out).
- Allowed kinds for this task: ${task.kinds.join(", ")}.

When you're done, write your findings as clear notes, one block per finding, with the fields above.
Do not add commentary beyond the findings and a one-line note on anything you could not verify.`;
}
