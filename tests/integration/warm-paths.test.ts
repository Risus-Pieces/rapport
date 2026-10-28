import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// Warm paths say whose connection it is, so drafts sent from the owner's Gmail only lean on the owner's own network.
describe.skipIf(!hasDevDb)("warm paths across the team (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const makeUser = async (name: string) => {
    const uid = randomUUID();
    users.push(uid);
    await db.insert(s.user).values({ id: uid, name, email: `wp-${uid}@example.test`, emailVerified: true });
    return uid;
  };
  const connection = (userId: string, name: string) =>
    q(`insert into network (user_id, full_name, company, company_key, dedupe_key) values ($1, $2, 'Acme Ventures', rr_company_key('Acme Ventures'), $2)`, [userId, name]);

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("labels each path with whose connection or contact it is, and only the owner's are the sender's", async () => {
    const owner = await makeUser("Risus Zhao"), member = await makeUser("Mo Ade"), stranger = await makeUser("Sam Stranger");
    await q(`insert into members (user_id, workspace_id, role) values ($1, $2, 'member')`, [member, owner]);
    await connection(owner, "Olive Owner-Friend");
    await connection(stranger, "Never Shown");
    const co = (await one<{ id: string }>(`insert into companies (user_id, section, name) values ($1, 'general', 'Acme Ventures LLC') returning id`, [member]))!.id;
    await q(`insert into contacts (user_id, section, name, company_id) values ($1, 'general', 'Mike Member-Pal', $2)`, [member, co]);
    const item = (await one<{ id: string }>(`insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key, details) values ($1, 'sooz', 'angel', 'Ana Angel', 'https://x.com/a', 80, 'a', '{"firm":"Acme Ventures"}') returning id`, [owner]))!.id;
    const paths = (await one<{ w: { name: string; via: string; who: string; owner_is_sender: boolean }[] }>(`select rr_warm_paths(i) as w from radar_items i where i.id = $1`, [item]))!.w;
    expect(paths).toEqual([
      { name: "Mike Member-Pal", via: "Mo's contact", who: "Mo", owner_is_sender: false },
      { name: "Olive Owner-Friend", via: "Risus's LinkedIn connection", who: "Risus", owner_is_sender: true },
    ]);
    const { warmMatches } = await import("@/db/queries/radar");
    const m = (await warmMatches(owner, [item])).get(item)!;
    expect(m.map((x) => [x.full_name, x.who])).toEqual([["Olive Owner-Friend", "Risus"]]);
    await connection(member, "Mona Member-Link");
    expect((await warmMatches(owner, [item])).get(item)!.map((x) => [x.full_name, x.who]).sort()).toEqual([["Mona Member-Link", "Mo"], ["Olive Owner-Friend", "Risus"]]);
  });
});
