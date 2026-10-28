import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { members, user } from "@/db/schema";
import { createAccount } from "@/lib/owner";

// The owner's user id is the workspace: Sooz rows live under it, personal rows under each user (docs/superpowers/specs/2026-10-27-mo-login-design.md).

/** The workspace a user works in: the owner's id for a member, their own id otherwise. */
export async function workspaceFor(userId: string): Promise<string> {
  const [row] = await db.select({ workspaceId: members.workspaceId }).from(members).where(eq(members.userId, userId));
  return row?.workspaceId ?? userId;
}

/** True unless the user is a member of someone else's workspace. */
export async function isWorkspaceOwner(userId: string): Promise<boolean> {
  const [row] = await db.select({ role: members.role }).from(members).where(eq(members.userId, userId));
  return !row || row.role === "owner";
}

export async function listMembers(workspaceId: string) {
  return db
    .select({ id: user.id, name: user.name, email: user.email, since: members.createdAt })
    .from(members)
    .innerJoin(user, eq(user.id, members.userId))
    .where(and(eq(members.workspaceId, workspaceId), eq(members.role, "member")))
    .orderBy(members.createdAt);
}

/** The owner adds a login to their workspace (the owner types the starting password; sign-up stays off). */
export async function addMember(
  ownerId: string,
  input: { name: string; email: string; password: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!(await isWorkspaceOwner(ownerId))) return { ok: false, error: "Only the owner can add people." };
  const email = input.email.trim().toLowerCase();
  const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (taken) return { ok: false, error: "That email already has a login." };
  try {
    const created = await createAccount({ email, name: input.name.trim() || email, password: input.password });
    await db.insert(members).values({ userId: created.id, workspaceId: ownerId, role: "member" });
    return { ok: true, id: created.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not add that person." };
  }
}

/** Removes a member's login and everything personal to them; shared workspace rows stay. */
export async function removeMember(ownerId: string, memberId: string): Promise<boolean> {
  if (ownerId === memberId) return false;
  const [row] = await db
    .select({ userId: members.userId })
    .from(members)
    .where(and(eq(members.userId, memberId), eq(members.workspaceId, ownerId), eq(members.role, "member")));
  if (!row) return false;
  await db.delete(user).where(eq(user.id, memberId));
  return true;
}
