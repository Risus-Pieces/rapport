"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getOutreachForItem,
  getPitch,
  importConnections,
  importPeopleToRadar,
  recordOutreach,
  saveOutreachEdits,
  savePitch,
  setOutreachPurpose,
  type OutreachEvent,
} from "@/db/queries/radar";
import { PITCH_FIELDS, templateDrafts, type Pitch, type PitchKey } from "@/lib/radar/drafts";
import { parseLinkedInConnections, type Connection } from "@/lib/radar/import";
import { outreachResultMessage } from "@/lib/radar/types";
import { requireSession } from "@/lib/session";
import { uuid } from "@/lib/validation/common";

// Outreach lives on the CRM record; every action returns to the page it came from.
const RECORD_PAGE = /^\/(investors|restaurants|general)\/[0-9a-f-]{36}$/;

function backTo(formData: FormData, extra?: Record<string, string>): string {
  const raw = formData.get("back");
  const path = typeof raw === "string" && RECORD_PAGE.test(raw) ? raw : "/investors";
  const query = new URLSearchParams(extra).toString();
  return `${path}${query ? `?${query}` : ""}#outreach`;
}

const str = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
};

function itemId(formData: FormData): string | null {
  const id = uuid.safeParse(formData.get("item"));
  return id.success ? id.data : null;
}

export async function saveOutreachAction(formData: FormData) {
  const session = await requireSession();
  const id = itemId(formData);
  if (!id) return;
  const purpose = str(formData, "purpose");
  if (purpose) await setOutreachPurpose(session.user.id, id, purpose);
  const result = await saveOutreachEdits(session.user.id, id, {
    email: str(formData, "email"),
    linkedin_url: str(formData, "linkedin_url"),
    warm_path: str(formData, "warm_path"),
    subject: str(formData, "subject"),
    body: str(formData, "body"),
    linkedin_note: str(formData, "linkedin_note"),
    intro_request: str(formData, "intro_request"),
    followup_1: str(formData, "followup_1"),
    followup_2: str(formData, "followup_2"),
  });
  revalidatePath("/", "layout");
  redirect(backTo(formData, result.ok ? { saved: "outreach" } : { outreachError: result.error ?? "Could not save." }));
}

/** Fills empty draft fields from the deterministic per-purpose template (the routine writes richer drafts). */
export async function draftFromTemplateAction(formData: FormData) {
  const session = await requireSession();
  const id = itemId(formData);
  if (!id) return;
  const o = await getOutreachForItem(session.user.id, id);
  if (!o || (o.stage !== "prospect" && o.stage !== "drafted")) redirect(backTo(formData));
  const d = templateDrafts(
    { name: o.name, details: o.details, why_relevant: o.whyRelevant, warm_path: o.warmPath, kind: o.kind, purpose: o.purpose },
    await getPitch(session.user.id),
  );
  await saveOutreachEdits(
    session.user.id,
    id,
    {
      email: o.email ?? undefined,
      linkedin_url: o.linkedinUrl ?? undefined,
      warm_path: o.warmPath ?? undefined,
      subject: o.subject || d.subject,
      body: o.body || d.body,
      linkedin_note: o.linkedinNote || d.linkedin_note,
      intro_request: o.introRequest || d.intro_request || undefined,
      followup_1: o.followup1 || d.followup_1,
      followup_2: o.followup2 || d.followup_2,
    },
    "template",
  );
  revalidatePath("/", "layout");
  redirect(backTo(formData));
}

const EVENTS: OutreachEvent[] = ["sent", "followup", "replied", "closed"];

export async function outreachEventAction(formData: FormData) {
  const session = await requireSession();
  const id = itemId(formData);
  const event = str(formData, "event") as OutreachEvent;
  if (!id || !EVENTS.includes(event)) return;
  const message = outreachResultMessage(await recordOutreach(session.user.id, id, event));
  revalidatePath("/", "layout");
  redirect(backTo(formData, message ? { outreachError: message } : undefined));
}

// --- Settings ----------------------------------------------------------------------------------

const MAX_UPLOAD = 3_500_000;

async function fileText(formData: FormData, key: string): Promise<string | null> {
  const file = formData.get(key);
  if (!file || typeof file === "string" || file.size === 0 || file.size > MAX_UPLOAD) return null;
  return file.text();
}

export async function savePitchAction(formData: FormData) {
  const session = await requireSession();
  const values: Pitch = {};
  for (const f of PITCH_FIELDS) values[f.key as PitchKey] = str(formData, f.key) ?? "";
  await savePitch(session.user.id, values);
  revalidatePath("/", "layout");
  redirect("/settings?saved=pitch#pitch");
}

export async function importConnectionsAction(formData: FormData) {
  const session = await requireSession();
  const text = await fileText(formData, "file");
  if (!text) redirect(`/settings?err=${encodeURIComponent("Choose your LinkedIn Connections.csv (under 3.5 MB).")}#network`);
  let conns: Connection[];
  try {
    conns = parseLinkedInConnections(text);
  } catch {
    conns = [];
  }
  if (!conns.length) redirect(`/settings?err=${encodeURIComponent("That doesn't look like a LinkedIn Connections.csv export.")}#network`);
  const n = await importConnections(session.user.id, conns);
  revalidatePath("/", "layout");
  redirect(`/settings?network=${n}#network`);
}

export async function importPeopleAction(formData: FormData) {
  const session = await requireSession();
  const text = await fileText(formData, "file");
  if (!text) redirect(`/settings?err=${encodeURIComponent("Choose a CSV file (under 3.5 MB).")}#import-people`);
  let result;
  try {
    result = await importPeopleToRadar(session.user.id, text);
  } catch {
    redirect(`/settings?err=${encodeURIComponent("That file could not be read as CSV.")}#import-people`);
  }
  revalidatePath("/", "layout");
  redirect(`/settings?imported=${result.valid}&received=${result.received}#import-people`);
}
