import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// What a member (Mo) can reach in the owner's (Risus's) workspace: everything Sooz, nothing personal.
describe.skipIf(!hasDevDb)("scoped access for workspace members (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  type Scope = import("@/lib/scope").Scope;
  let db: Db;
  let s: typeof import("@/db/schema");
  let a: typeof import("@/db/queries/access");
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const id = async (text: string, params: unknown[]) => (await one<{ id: string }>(text, params))!.id;
  const makeUser = async (label: string) => {
    const uid = randomUUID();
    users.push(uid);
    await db.insert(s.user).values({ id: uid, name: label, email: `${label.toLowerCase()}-${uid}@example.test`, emailVerified: true });
    return uid;
  };
  let owner: Scope, member: Scope, stranger: Scope;
  let w: Record<string, string>;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    a = await import("@/db/queries/access");
  });
  beforeEach(async () => {
    const o = await makeUser("Risus"), m = await makeUser("Mo"), x = await makeUser("Stranger");
    await q(`insert into members (user_id, workspace_id, role) values ($1, $2, 'member')`, [m, o]);
    owner = { userId: o, workspaceId: o, isOwner: true, name: "Risus" };
    member = { userId: m, workspaceId: o, isOwner: false, name: "Mo" };
    stranger = { userId: x, workspaceId: x, isOwner: true, name: "Stranger" };
    w = {
      friend: await id(`insert into contacts (user_id, section, name) values ($1, 'general', 'Findable Friend') returning id`, [o]),
      soozPerson: await id(`insert into contacts (user_id, section, name, shared, relationship) values ($1, 'general', 'Findable Creator', true, 'to_reach_out') returning id`, [o]),
      moFriend: await id(`insert into contacts (user_id, section, name) values ($1, 'general', 'Findable Mo Pal') returning id`, [m]),
      angel: await id(`insert into contacts (user_id, section, name) values ($1, 'investors', 'Findable Angel') returning id`, [o]),
    };
    w.deal = await id(`insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'Findable Angel', 'target', '{"investorType":"angel"}') returning id`, [o, w.angel]);
    w.soozItem = await id(`insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key) values ($1, 'sooz', 'event', 'Findable Expo', 'https://x.com/e', 70, 'e') returning id`, [o]);
    w.personalItem = await id(`insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key) values ($1, 'personal', 'hackathon', 'Findable Hack', 'https://x.com/h', 70, 'h') returning id`, [o]);
    w.dealTask = await id(`insert into tasks (user_id, title, deal_id) values ($1, 'Follow up with angel', $2) returning id`, [o, w.deal]);
    w.privateTask = await id(`insert into tasks (user_id, title, contact_id) values ($1, 'Call friend', $2) returning id`, [o, w.friend]);
    w.looseTask = await id(`insert into tasks (user_id, title) values ($1, 'Buy groceries') returning id`, [o]);
    w.moTask = await id(`insert into tasks (user_id, title) values ($1, 'Mo errand') returning id`, [m]);
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("resolves which id owns a record the person may reach, and refuses the rest", async () => {
    expect(await a.contactOwner(member, w.soozPerson)).toBe(owner.userId);
    expect(await a.contactOwner(member, w.angel)).toBe(owner.userId);
    expect(await a.contactOwner(member, w.friend)).toBeNull();
    expect(await a.contactOwner(member, w.moFriend)).toBe(member.userId);
    expect(await a.contactOwner(owner, w.friend)).toBe(owner.userId);
    expect(await a.contactOwner(owner, w.moFriend)).toBeNull();
    expect(await a.contactOwner(stranger, w.soozPerson)).toBeNull();
    expect(await a.dealOwner(member, w.deal)).toBe(owner.userId);
    expect(await a.dealOwner(stranger, w.deal)).toBeNull();
    expect(await a.itemOwner(member, w.soozItem)).toBe(owner.userId);
    expect(await a.itemOwner(member, w.personalItem)).toBeNull();
    expect(await a.taskOwner(member, w.dealTask)).toBe(owner.userId);
    expect(await a.taskOwner(member, w.privateTask)).toBeNull();
    expect(await a.taskOwner(member, w.looseTask)).toBeNull();
    expect(await a.taskOwner(member, w.moTask)).toBe(member.userId);
  });

  it("General is my own people plus the shared Sooz people, flagged", async () => {
    const mine = async (sc: Scope) => (await a.listGeneral(sc)).map((c) => [c.name, c.shared]).sort();
    expect(await mine(member)).toEqual([["Findable Creator", true], ["Findable Mo Pal", false]]);
    expect(await mine(owner)).toEqual([["Findable Creator", true], ["Findable Friend", false]]);
    expect((await a.listGeneral(member, { relationship: "known" })).map((c) => c.name)).toEqual(["Findable Mo Pal"]);
  });

  it("tasks are my own plus the shared ones", async () => {
    expect((await a.openTasks(member)).map((t) => t.title).sort()).toEqual(["Follow up with angel", "Mo errand"]);
    expect((await a.openTasks(owner)).map((t) => t.title).sort()).toEqual(["Buy groceries", "Call friend", "Follow up with angel"]);
  });

  it("search, export and counts never show the other person's personal records", async () => {
    const labels = async (sc: Scope) => (await a.searchScoped(sc, "findable")).map((h) => h.label).sort();
    expect(await labels(member)).toEqual(["Findable Angel", "Findable Creator", "Findable Expo", "Findable Mo Pal"]);
    expect(await labels(owner)).toEqual(["Findable Angel", "Findable Creator", "Findable Expo", "Findable Friend", "Findable Hack"]);
    const exported = async (sc: Scope, kind: "contacts" | "radar" | "tasks") => (await a.exportScoped(sc, kind)).rows.map((r) => String(r.name ?? r.title)).sort();
    expect(await exported(member, "contacts")).toEqual(["Findable Angel", "Findable Creator", "Findable Mo Pal"]);
    expect(await exported(member, "radar")).toEqual(["Findable Expo"]);
    expect(await exported(member, "tasks")).toEqual(["Follow up with angel", "Mo errand"]);
    expect(await a.newOpportunityCountsScoped(member)).toEqual({ sooz: 1, personal: 0, career: 0 });
    expect(await a.newOpportunityCountsScoped(owner)).toEqual({ sooz: 1, personal: 1, career: 0 });
    expect(await a.generalCounts(member)).toMatchObject({ to_reach_out: 1, known: 1 });
    expect(await a.generalCounts(owner)).toMatchObject({ to_reach_out: 1, known: 1 });
  });

  it("a shared deal paired with someone else's private contact is not a way in", async () => {
    expect(await a.targetOwner(member, { dealId: w.deal, contactId: w.friend })).toBe(member.userId);
    expect(await a.targetOwner(member, { dealId: w.deal, contactId: w.angel })).toBe(owner.userId);
    expect(await a.targetOwner(member, { dealId: w.deal })).toBe(owner.userId);
    expect(await a.targetOwner(owner, { dealId: w.deal, contactId: w.friend })).toBe(owner.userId);
  });

  it("CSV duplicate check sees the shared workspace but not the other person's friends", async () => {
    const keys = await a.importKeysScoped(member);
    expect(keys.has("investors|findable angel")).toBe(true);
    expect(keys.has("general|findable creator")).toBe(true);
    expect(keys.has("general|findable mo pal")).toBe(true);
    expect(keys.has("general|findable friend")).toBe(false);
    expect((await a.importKeysScoped(owner)).has("general|findable friend")).toBe(true);
  });

  it("This week replies show a member only replies on shared records", async () => {
    const { weekSummary } = await import("@/db/queries/raise");
    await q(`insert into activities (user_id, type, summary, contact_id) values ($1, 'email', 'Replied re: dinner', $2), ($1, 'email', 'Replied re: terms', $3)`, [owner.userId, w.friend, w.angel]);
    const names = async (soozOnly: boolean) => (await weekSummary(owner.userId, new Date(), { soozOnly })).replies.map((r) => r.name).sort();
    expect(await names(true)).toEqual(["Findable Angel"]);
    expect(await names(false)).toEqual(["Findable Angel", "Findable Friend"]);
  });
});
