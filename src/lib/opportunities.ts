import { isFeed, isPersonKind } from "@/lib/radar/types";

/** Everything the research finds that isn't a person (events, funding, competitions, internships, programs…). */
export const OPPORTUNITY_VIEWS = ["to_apply", "applied", "on_hold", "dismissed"] as const;
export type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number];
export const isOpportunityView = (v: string): v is OpportunityView => (OPPORTUNITY_VIEWS as readonly string[]).includes(v);

export const OPPORTUNITY_VIEW_LABELS: Record<OpportunityView, string> = {
  to_apply: "To apply",
  applied: "Applied",
  on_hold: "On hold",
  dismissed: "Dismissed",
};

/** The statuses a view shows: To apply is new, seen and saved (saved shows a star). */
export function statusesFor(view: OpportunityView): string[] {
  return view === "to_apply" ? ["new", "seen", "saved"] : [view];
}

export const OPPORTUNITY_STATUSES = ["seen", "saved", "applied", "on_hold", "dismissed"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export const isOpportunityStatus = (s: string): s is OpportunityStatus => (OPPORTUNITY_STATUSES as readonly string[]).includes(s);

const viewOf = (status: string): OpportunityView => (isOpportunityView(status) && status !== "to_apply" ? status : "to_apply");

/** The /opportunities URL that shows a finding: its feed, the view its status lives in, and a search for it. */
export function opportunityHref(item: { feed: string; status: string; title: string }): string {
  const query = new URLSearchParams();
  if (item.feed !== "sooz") query.set("feed", item.feed);
  const view = viewOf(item.status);
  if (view !== "to_apply") query.set("view", view);
  query.set("q", item.title);
  return `/opportunities?${query.toString()}`;
}

type Params = { [key: string]: string | string[] | undefined };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** Old /radar links (bookmarks, digests) land on the matching Opportunities feed, view and search. */
export function radarRedirect(params: Params): string {
  const query = new URLSearchParams();
  const tab = first(params.tab);
  if (isFeed(tab) && tab !== "sooz") query.set("feed", tab);
  const view = first(params.view);
  if (view === "dismissed") query.set("view", view);
  const kind = first(params.kind);
  if (kind && !isPersonKind(kind)) query.set("kind", kind);
  const q = first(params.q).trim();
  if (q) query.set("q", q);
  const text = query.toString();
  return text ? `/opportunities?${text}` : "/opportunities";
}
