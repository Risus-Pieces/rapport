"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addMember, removeMember } from "@/db/queries/members";
import { getScope } from "@/lib/scope";

const back = (params: Record<string, string>) => `/settings?${new URLSearchParams(params)}#team`;

/** The owner adds a login to the shared workspace (they type the starting password). */
export async function addMemberAction(formData: FormData) {
  const scope = await getScope();
  if (!scope.isOwner) redirect(back({ err: "Only the owner can add people." }));
  const field = (k: string) => String(formData.get(k) ?? "");
  const result = await addMember(scope.userId, { name: field("name"), email: field("email"), password: field("password") });
  revalidatePath("/settings");
  redirect(back(result.ok ? { member: "added" } : { err: result.error }));
}

export async function removeMemberAction(formData: FormData) {
  const scope = await getScope();
  const id = String(formData.get("id") ?? "");
  const ok = scope.isOwner && (await removeMember(scope.userId, id));
  revalidatePath("/settings");
  redirect(back(ok ? { member: "removed" } : { err: "Could not remove that person." }));
}
