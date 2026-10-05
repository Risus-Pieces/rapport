import { auth } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export type OwnerInput = { email: string; name: string; password: string };

// Sign-up is disabled for the public API, so the owner is created through Better Auth's
// internal adapter, which writes the same rows a normal sign-up would.
export async function createOwner({ email, name, password }: OwnerInput) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) throw new Error("Enter a valid email address.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
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
