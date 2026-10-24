"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addOpportunity, markOpportunitiesSeen, setOpportunityStatus } from "@/db/queries/opportunities";
import { setRadarNotes } from "@/db/queries/radar";
import { isOpportunityStatus } from "@/lib/opportunities";
import { isFeed } from "@/lib/radar/types";
import { requireSession } from "@/lib/session";
import { uuid } from "@/lib/validation/common";

function refreshAll() {
  revalidatePath("/", "layout");
}

export async function opportunityStatusAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  const status = String(formData.get("status") ?? "");
  if (!id.success || !isOpportunityStatus(status)) return;
  await setOpportunityStatus(session.user.id, id.data, status);
  refreshAll();
}

export async function opportunityNotesAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await setRadarNotes(session.user.id, id.data, String(formData.get("notes") ?? ""));
  refreshAll();
}

export async function seeAllOpportunitiesAction(formData: FormData) {
  const session = await requireSession();
  const feed = String(formData.get("feed") ?? "");
  if (!isFeed(feed)) return;
  await markOpportunitiesSeen(session.user.id, feed);
  refreshAll();
}

/** Something the owner found themselves: saved to To apply, and a seed for the weekly competition search. */
export async function addOpportunityAction(formData: FormData) {
  const session = await requireSession();
  const field = (name: string) => String(formData.get(name) ?? "");
  const feed = isFeed(field("feed")) ? field("feed") : "sooz";
  const result = await addOpportunity(session.user.id, {
    feed,
    kind: field("kind"),
    title: field("title"),
    url: field("url"),
    deadline: field("deadline") || null,
    eventDate: field("eventDate") || null,
    pitchCompetition: formData.get("pitchCompetition") === "on",
    notes: field("notes"),
  });
  refreshAll();
  const back = new URLSearchParams(feed === "sooz" ? {} : { feed });
  if (result.ok) back.set("added", "1");
  else back.set("err", result.error);
  redirect(`/opportunities?${back}`);
}
