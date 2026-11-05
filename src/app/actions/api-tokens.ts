"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApiToken, revokeApiToken } from "@/db/queries/api-tokens";
import { getScope } from "@/lib/scope";

export type ApiTokenState = { token: string | null; name: string | null; ran: number };

/** Makes a personal API token for an agent. The plain token comes back once, to show on screen; only its hash is kept. */
export async function createApiTokenAction(prev: ApiTokenState, formData: FormData): Promise<ApiTokenState> {
  const scope = await getScope();
  const name = String(formData.get("name") ?? "").trim() || "Agent";
  const { token } = await createApiToken(scope.userId, name);
  revalidatePath("/settings");
  return { token, name, ran: prev.ran + 1 };
}

export async function revokeApiTokenAction(formData: FormData) {
  const scope = await getScope();
  const ok = await revokeApiToken(scope.userId, String(formData.get("id") ?? ""));
  revalidatePath("/settings");
  redirect(`/settings?${new URLSearchParams(ok ? { token: "revoked" } : { err: "Could not revoke that token." })}#api-tokens`);
}
