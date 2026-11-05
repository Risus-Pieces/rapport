import { cache } from "react";
import { isWorkspaceOwner, workspaceFor } from "@/db/queries/members";
import { requireSession } from "@/lib/session";

export type Scope = { userId: string; workspaceId: string; isOwner: boolean; name: string };

/**
 * Who is asking and whose data they work in. Sooz work (Restaurants, Investors, the Sooz feed, This week, outreach,
 * pitch facts) uses `workspaceId`; personal things (General, Personal/Career feeds, own tasks) use `userId`.
 */
export const getScope = cache(async (): Promise<Scope> => {
  const session = await requireSession();
  const userId = session.user.id;
  const [workspaceId, isOwner] = await Promise.all([workspaceFor(userId), isWorkspaceOwner(userId)]);
  return { userId, workspaceId, isOwner, name: session.user.name };
});

/** The same scope for a user who is not signed in through a browser (an agent holding their API token). */
export async function scopeForUser(userId: string, name: string): Promise<Scope> {
  const [workspaceId, isOwner] = await Promise.all([workspaceFor(userId), isWorkspaceOwner(userId)]);
  return { userId, workspaceId, isOwner, name };
}
