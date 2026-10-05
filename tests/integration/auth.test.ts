import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasEnv = Boolean(
  process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL,
);

describe.skipIf(!hasEnv)("owner auth (runs against the Neon dev branch)", () => {
  type Mods = {
    auth: typeof import("@/lib/auth").auth;
    createOwner: typeof import("@/lib/owner").createOwner;
    db: typeof import("@/db").db;
    user: typeof import("@/db/schema").user;
  };
  let m: Mods;
  const tag = randomUUID();
  const email = `owner-${tag}@example.test`;
  const intruder = `intruder-${tag}@example.test`;
  const password = `pw-${tag}`; // longer than 12 characters

  beforeAll(async () => {
    m = {
      auth: (await import("@/lib/auth")).auth,
      createOwner: (await import("@/lib/owner")).createOwner,
      db: (await import("@/db")).db,
      user: (await import("@/db/schema")).user,
    };
    await m.createOwner({ email, name: "Test Owner", password });
  });

  afterAll(async () => {
    if (!m) return;
    await m.db.delete(m.user).where(eq(m.user.email, email));
    await m.db.delete(m.user).where(eq(m.user.email, intruder));
  });

  it("lets the seeded owner sign in with email and password", async () => {
    const result = await m.auth.api.signInEmail({ body: { email, password } });
    expect(result.user.email).toBe(email);
  });

  it("rejects a wrong password", async () => {
    await expect(
      m.auth.api.signInEmail({ body: { email, password: "definitely-wrong-password" } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("refuses public sign-up and creates no user", async () => {
    await expect(
      m.auth.api.signUpEmail({
        body: { name: "Intruder", email: intruder, password: "intruder-password-123" },
      }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    const rows = await m.db.select().from(m.user).where(eq(m.user.email, intruder));
    expect(rows).toHaveLength(0);
  });

  it("createOwner rejects a password shorter than 12 characters", async () => {
    await expect(
      m.createOwner({ email: `short-${tag}@example.test`, name: "Short", password: "short" }),
    ).rejects.toThrow(/at least 12/);
  });
});
