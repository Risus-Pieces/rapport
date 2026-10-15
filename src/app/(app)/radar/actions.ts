"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveRadarItem, markFeedSeen, RadarError, setRadarNotes, setRadarStatus } from "@/db/queries/radar";
import { isFeed } from "@/lib/radar/types";
import { requireSession } from "@/lib/session";
import { uuid } from "@/lib/validation/common";

function refreshAll() {
  revalidatePath("/", "layout");
}

const back = (formData: FormData) => {
  const value = formData.get("back");
  return typeof value === "string" && value.startsWith("/radar") ? value : "/radar";
};

// Approve one finding: the person lands in the CRM and the owner goes straight to their record.
export async function approveRadarAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  let href: string;
  try {
    href = (await approveRadarItem(session.user.id, id.data)).href;
  } catch (error) {
    if (!(error instanceof RadarError)) console.error("approveRadarAction failed:", error instanceof Error ? error.message : error);
    const message = error instanceof RadarError ? error.message : "Could not add to the CRM. Try again.";
    const target = new URL(back(formData), "http://x");
    target.searchParams.set("err", message);
    redirect(`${target.pathname}${target.search}`);
  }
  refreshAll();
  redirect(href);
}

export async function radarStatusAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  const status = formData.get("status");
  if (!id.success || (status !== "seen" && status !== "saved" && status !== "dismissed")) return;
  await setRadarStatus(session.user.id, id.data, status);
  refreshAll();
}

export async function radarNotesAction(formData: FormData) {
  const session = await requireSession();
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return;
  await setRadarNotes(session.user.id, id.data, String(formData.get("notes") ?? ""));
  refreshAll();
}

export async function seeAllRadarAction(formData: FormData) {
  const session = await requireSession();
  const feed = String(formData.get("feed") ?? "");
  if (!isFeed(feed)) return;
  await markFeedSeen(session.user.id, feed);
  refreshAll();
}
