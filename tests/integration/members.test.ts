import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// Mo's login: the owner's user id is the workspace; members share it; personal rows stay per person.
describe.skipIf(!hasDevDb)("members and the shared workspace (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let m: typeof import("@/db/queries/members");
  let owner = randomUUID();
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const makeUser = async (label: string) => {
    const id = randomUUID();
    users.push(id);
    await db.insert(s.user).values({ id, name: label, email: `${label.toLowerCase()}-${id}@example.test`, emailVerified: true });
    return id;
  };

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    m = await import("@/db/queries/members");
  });
  beforeEach(async () => {
    owner = await makeUser("Owner");
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
    await q(`delete from "user" where email like 'added-member-%@example.test'`);
  });

  it("the routines' owner is the workspace owner, even with more than one user", async () => {
    const row = await one<{ user_id: string }>(`select user_id from members where role = 'owner'`);
    expect(row).toBeTruthy();
    expect(await one(`select rr_owner() as o`)).toEqual({ o: row!.user_id });
  });

  it("a member works in the owner's workspace; anyone else is their own workspace", async () => {
    const member = await makeUser("Member");
    await q(`insert into members (user_id, workspace_id, role) values ($1, $2, 'member')`, [member, owner]);
    expect(await m.workspaceFor(member)).toBe(owner);
    expect(await m.workspaceFor(owner)).toBe(owner);
    const stranger = await makeUser("Stranger");
    expect(await m.workspaceFor(stranger)).toBe(stranger);
    expect(await m.isWorkspaceOwner(owner)).toBe(true);
    expect(await m.isWorkspaceOwner(member)).toBe(false);
  });

  it("only the owner adds a member; the new login lands in the owner's workspace", async () => {
    const email = `added-member-${randomUUID()}@example.test`;
    const added = await m.addMember(owner, { name: "Mo", email, password: `pw-${randomUUID()}` });
    expect(added).toMatchObject({ ok: true });
    const id = (added as { id: string }).id;
    users.push(id);
    expect(await m.workspaceFor(id)).toBe(owner);
    expect((await m.listMembers(owner)).map((x) => x.email)).toEqual([email]);
    expect(await m.addMember(id, { name: "X", email: `added-member-${randomUUID()}@example.test`, password: `pw-${randomUUID()}` }))
      .toMatchObject({ ok: false });
    expect(await m.addMember(owner, { name: "Mo again", email, password: `pw-${randomUUID()}` })).toMatchObject({ ok: false });
  });

  it("removing a member deletes only their own rows, never the shared workspace", async () => {
    const member = await makeUser("Gone");
    await q(`insert into members (user_id, workspace_id, role) values ($1, $2, 'member')`, [member, owner]);
    await q(`insert into contacts (user_id, section, name) values ($1, 'general', 'Members Friend')`, [member]);
    const c = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'investors', 'Shared Angel') returning id`, [owner]))!.id;
    await q(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'Shared Angel', 'target', '{"investorType":"angel"}')`, [owner, c]);
    expect(await m.removeMember(randomUUID(), member)).toBe(false);
    expect(await m.removeMember(owner, owner)).toBe(false);
    expect(await m.removeMember(owner, member)).toBe(true);
    expect(await one(`select count(*)::int n from contacts where user_id = $1`, [member])).toEqual({ n: 0 });
    expect(await one(`select count(*)::int n from deals where user_id = $1`, [owner])).toEqual({ n: 1 });
  });

  it("Sooz people in General are shared, and never reuse someone's personal contact of the same name", async () => {
    const friend = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'general', 'Casey Creator') returning id`, [owner]))!.id;
    await q(`select rr_ingest('sooz', 't', array['creator'], false, $1::jsonb, $2)`,
      [JSON.stringify([{ kind: "creator", title: "Casey Creator", url: "https://x.com/casey", score: 80, summary: "s" }]), owner]);
    const item = (await one<{ contact_id: string }>(`select contact_id from radar_items where user_id = $1 and title = 'Casey Creator'`, [owner]))!;
    expect(item.contact_id).not.toBe(friend);
    expect(await one(`select shared from contacts where id = $1`, [item.contact_id])).toEqual({ shared: true });
    expect(await one(`select shared from contacts where id = $1`, [friend])).toEqual({ shared: false });
    // Found again: reuses the shared contact, not a new one.
    await q(`select rr_ingest('sooz', 't', array['creator'], false, $1::jsonb, $2)`,
      [JSON.stringify([{ kind: "creator", title: "Casey Creator", url: "https://y.com/casey2", score: 80, summary: "s" }]), owner]);
    expect(await one(`select count(*)::int n from contacts where user_id = $1 and name = 'Casey Creator' and shared`, [owner])).toEqual({ n: 1 });
  });

  it("marks existing Sooz people in General as shared", async () => {
    const found = (await one<{ id: string }>(`insert into contacts (user_id, section, name) values ($1, 'general', 'Old Find') returning id`, [owner]))!.id;
    await q(`insert into radar_items (user_id, feed, kind, title, url, score, status, dedupe_key, contact_id) values ($1, 'sooz', 'media', 'Old Find', 'https://x.com/o', 70, 'approved', 'media:old-find', $2)`, [owner, found]);
    await q(`select rr_mark_shared_contacts($1)`, [owner]);
    expect(await one(`select shared from contacts where id = $1`, [found])).toEqual({ shared: true });
  });
});
