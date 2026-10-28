"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveShortlist, getRaise, saveMonthFacts, saveRaise, setAdviceCall, setGmailOk } from "@/db/queries/raise";
import { parseRaiseForm } from "@/lib/raise";
import { getScope } from "@/lib/scope";
import { uuid } from "@/lib/validation/common";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

function refresh() {
  revalidatePath("/", "layout");
}

const RECORD_PAGE = /^\/(investors|restaurants|general)\/[0-9a-f-]{36}$/;
const backTo = (f: FormData, fallback: string) => {
  const raw = str(f, "back");
  return RECORD_PAGE.test(raw) ? raw : fallback;
};

/** Approve the checked shortlist rows (they go into the CRM and their drafts to Gmail); the rest are skipped. */
export async function approveShortlistAction(formData: FormData) {
  const { workspaceId } = await getScope();
  const week = str(formData, "week");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return;
  const ids = formData.getAll("approve").filter((v): v is string => typeof v === "string" && uuid.safeParse(v).success);
  const r = await approveShortlist(workspaceId, week, ids);
  refresh();
  redirect(`/week?approved=${r.approved}&skipped=${r.skipped}`);
}

export async function saveRaiseAction(formData: FormData) {
  const { workspaceId } = await getScope();
  const current = await getRaise(workspaceId);
  await saveRaise(workspaceId, parseRaiseForm({ target: str(formData, "target"), launchDate: str(formData, "launchDate"), phase: current.phase }, current));
  refresh();
  redirect("/week?saved=raise");
}

/** Switch phase. Going to Raising lets the routine draft the launch ask for everyone marked Advice call done. */
export async function setPhaseAction(formData: FormData) {
  const { workspaceId } = await getScope();
  const phase = str(formData, "phase");
  if (phase !== "building" && phase !== "raising") return;
  // Starting the raise drafts launch asks for everyone marked Advice call done, so it needs an explicit confirmation.
  if (phase === "raising" && str(formData, "confirm") !== "yes") redirect("/week?confirm=launch");
  const current = await getRaise(workspaceId);
  await saveRaise(workspaceId, { ...current, phase });
  refresh();
  redirect(`/week?phase=${phase}`);
}

export async function saveMonthFactsAction(formData: FormData) {
  const { workspaceId } = await getScope();
  await saveMonthFacts(workspaceId, { progress: str(formData, "progress"), ask: str(formData, "ask"), next: str(formData, "next") });
  refresh();
  redirect("/week?saved=month#month");
}

export async function adviceCallAction(formData: FormData) {
  const { workspaceId } = await getScope();
  const id = uuid.safeParse(formData.get("dealId"));
  if (!id.success) return;
  await setAdviceCall(workspaceId, id.data, str(formData, "done") === "true");
  refresh();
  redirect(backTo(formData, "/investors"));
}

export async function gmailOkAction(formData: FormData) {
  const { workspaceId } = await getScope();
  const id = uuid.safeParse(formData.get("item"));
  if (!id.success) return;
  await setGmailOk(workspaceId, id.data);
  refresh();
  redirect(`${backTo(formData, "/week")}#outreach`);
}
