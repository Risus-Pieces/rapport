"use server";

import { revalidatePath } from "next/cache";
import { markOpportunitiesSeen, setOpportunityStatus } from "@/db/queries/opportunities";
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
