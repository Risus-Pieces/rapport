import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("owner password reset (runs against the Neon dev branch)", () => {
  type Mods = {
    auth: typeof import("@/lib/auth").auth;
    createOwner: typeof import("@/lib/owner").createOwner;
    resetOwnerPassword: typeof import("@/lib/owner").resetOwnerPassword;
    db: typeof import("@/db").db;
    s: typeof import("@/db/schema");
  };
  let m: Mods;
  const tag = randomUUID();
  const email = `reset-${tag}@example.test`;
  const oldPassword = `old-password-${tag}`;
  const newPassword = `new-password-${tag}`;

  beforeAll(async () => {
    const owner = await import("@/lib/owner");
    m = {
      auth: (await import("@/lib/auth")).auth,
      createOwner: owner.createOwner,
      resetOwnerPassword: owner.resetOwnerPassword,
      db: (await import("@/db")).db,
      s: await import("@/db/schema"),
    };
    await m.createOwner({ email, name: "Reset Test", password: oldPassword });
  });

  afterAll(async () => {
    if (m) await m.db.delete(m.s.user).where(eq(m.s.user.email, email));
  });

  it("replaces the password, revokes sessions and keeps a single credential account", async () => {
    const signedIn = await m.auth.api.signInEmail({ body: { email, password: oldPassword } });
    const sessionsBefore = await m.db.select().from(m.s.session).where(eq(m.s.session.userId, signedIn.user.id));
    expect(sessionsBefore.length).toBeGreaterThan(0);

    await m.resetOwnerPassword({ email: email.toUpperCase(), password: newPassword });

    await expect(m.auth.api.signInEmail({ body: { email, password: oldPassword } })).rejects.toMatchObject({
      status: "UNAUTHORIZED",
    });
    const again = await m.auth.api.signInEmail({ body: { email, password: newPassword } });
    expect(again.user.id).toBe(signedIn.user.id);
    const oldSessions = await m.db
      .select()
      .from(m.s.session)
      .where(and(eq(m.s.session.userId, signedIn.user.id), eq(m.s.session.id, sessionsBefore[0].id)));
    expect(oldSessions).toHaveLength(0);
    const credentials = await m.db
      .select()
      .from(m.s.account)
      .where(and(eq(m.s.account.userId, signedIn.user.id), eq(m.s.account.providerId, "credential")));
    expect(credentials).toHaveLength(1);
  });

  it("repairs a user that has no credential account", async () => {
    const [found] = await m.db.select().from(m.s.user).where(eq(m.s.user.email, email));
    await m.db.delete(m.s.account).where(eq(m.s.account.userId, found.id));

    await m.resetOwnerPassword({ email, password: oldPassword });

    const result = await m.auth.api.signInEmail({ body: { email, password: oldPassword } });
    expect(result.user.id).toBe(found.id);
  });

  it("rejects short passwords and unknown emails", async () => {
    await expect(m.resetOwnerPassword({ email, password: "short" })).rejects.toThrow(/at least/);
    await expect(
      m.resetOwnerPassword({ email: `nobody-${tag}@example.test`, password: newPassword }),
    ).rejects.toThrow(/No user/);
  });
});
