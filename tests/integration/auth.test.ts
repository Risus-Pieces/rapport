import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("owner auth (runs against the Neon dev branch)", () => {
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

  it.each(["me@gmail", "owner@localhost", "a b@x.com", "not-an-email"])(
    "createOwner rejects the invalid email %j before touching the database",
    async (badEmail) => {
      await expect(
        m.createOwner({ email: badEmail, name: "X", password: "a-long-enough-password" }),
      ).rejects.toThrow(/valid email/);
    },
  );

  it("createOwner rejects a password longer than 128 characters", async () => {
    await expect(
      m.createOwner({
        email: `long-${tag}@example.test`,
        name: "Long",
        password: "a".repeat(129),
      }),
    ).rejects.toThrow(/at most 128/);
  });
});
