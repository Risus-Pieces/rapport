import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { account, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

// Sign-in validates the email with z.email(); use the same check so the owner can always log in.
const emailSchema = z.email();

export type OwnerInput = { email: string; name: string; password: string };

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
}

// Sign-up is disabled for the public API, so the owner is created through Better Auth's
// internal adapter, which writes the same rows a normal sign-up would.
export async function createOwner({ email, name, password }: OwnerInput) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!emailSchema.safeParse(normalizedEmail).success) throw new Error("Enter a valid email address.");
  checkPassword(password);
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);
  const created = await ctx.internalAdapter.createUser(
    { email: normalizedEmail, name, emailVerified: true },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: passwordHash,
  });
  return created;
}

// Sets a new password for an existing user. It upserts the `credential` account row, so it
// also repairs a user left without one by an interrupted createOwner. Every existing session
// is revoked so a leaked session cannot outlive the reset.
export async function resetOwnerPassword({ email, password }: { email: string; password: string }) {
  const normalizedEmail = email.trim().toLowerCase();
  checkPassword(password);
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, normalizedEmail)).limit(1);
  if (!found) throw new Error(`No user with the email ${normalizedEmail}.`);
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(account)
      .set({ password: passwordHash })
      .where(and(eq(account.userId, found.id), eq(account.providerId, "credential")))
      .returning({ id: account.id });
    if (updated.length === 0) {
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: found.id,
        providerId: "credential",
        userId: found.id,
        password: passwordHash,
      });
    }
  });
  await ctx.internalAdapter.deleteUserSessions(found.id);
  return { userId: found.id };
}
