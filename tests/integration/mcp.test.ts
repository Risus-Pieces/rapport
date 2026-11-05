import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

// The /api/mcp endpoint: token auth, and agents getting exactly the app's scoping (shared Sooz, private personal).
describe.skipIf(!hasDevDb)("MCP endpoint (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let tokens: typeof import("@/db/queries/api-tokens");
  let route: typeof import("@/app/api/mcp/route");
  let Client: typeof import("@modelcontextprotocol/sdk/client/index.js").Client;
  let Transport: typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;
  const users: string[] = [];
  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await db.$client.query(text, params)).rows as T[];
  const id = async (text: string, params: unknown[]) => (await q<{ id: string }>(text, params))[0]!.id;
  const makeUser = async (label: string) => {
    const uid = randomUUID();
    users.push(uid);
    await db.insert(s.user).values({ id: uid, name: label, email: `${label.toLowerCase()}-${uid}@example.test`, emailVerified: true });
    return uid;
  };
  // Requests go straight to the route handler; no server is started.
  const routeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const handler = request.method === "POST" ? route.POST : request.method === "DELETE" ? route.DELETE : route.GET;
    return handler(request);
  };
  const connect = async (token: string) => {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new Transport(new URL("http://localhost/api/mcp"), { fetch: routeFetch, requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
    );
    return client;
  };
  const call = async (client: InstanceType<typeof Client>, name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0]?.text ?? "";
    return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
  };

  let owner: string, mo: string, moToken: string, ownerToken: string;
  let w: Record<string, string>;

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    tokens = await import("@/db/queries/api-tokens");
    route = await import("@/app/api/mcp/route");
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ StreamableHTTPClientTransport: Transport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js"));
  });
  beforeEach(async () => {
    owner = await makeUser("Risus");
    mo = await makeUser("Mo");
    await q(`insert into members (user_id, workspace_id, role) values ($1, $2, 'member')`, [mo, owner]);
    moToken = (await tokens.createApiToken(mo, "Mo's Claude")).token;
    ownerToken = (await tokens.createApiToken(owner, "Risus's Claude")).token;
    w = {
      friend: await id(`insert into contacts (user_id, section, name) values ($1, 'general', 'Private Friend') returning id`, [owner]),
      angel: await id(`insert into contacts (user_id, section, name) values ($1, 'investors', 'Shared Angel') returning id`, [owner]),
      soozItem: await id(`insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key) values ($1, 'sooz', 'funding', 'Shared Prize', 'https://x.com/p', 70, 'p') returning id`, [owner]),
      ownerPersonal: await id(`insert into radar_items (user_id, feed, kind, title, url, score, dedupe_key) values ($1, 'personal', 'hackathon', 'Risus Hack', 'https://x.com/h', 70, 'h') returning id`, [owner]),
    };
    w.deal = await id(
      `insert into deals (user_id, section, contact_id, title, stage, details) values ($1, 'investors', $2, 'Shared Angel', 'target', '{"investorType":"angel"}') returning id`,
      [owner, w.angel],
    );
  });
  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  it("refuses requests without a valid, live token", async () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    expect((await route.POST(new Request("http://localhost/api/mcp", { method: "POST", body, headers }))).status).toBe(401);
    const bad = await route.POST(new Request("http://localhost/api/mcp", { method: "POST", body, headers: { ...headers, Authorization: "Bearer rpt_nope_nope_nope_nope" } }));
    expect(bad.status).toBe(401);
    const [row] = await tokens.listApiTokens(mo);
    expect(await tokens.revokeApiToken(mo, row.id)).toBe(true);
    const revoked = await route.POST(new Request("http://localhost/api/mcp", { method: "POST", body, headers: { ...headers, Authorization: `Bearer ${moToken}` } }));
    expect(revoked.status).toBe(401);
  });

  it("stores only a hash and records when a token was last used", async () => {
    const rows = await q<{ token_hash: string; last_used_at: Date | null }>(`select token_hash, last_used_at from api_tokens where user_id = $1`, [mo]);
    expect(rows[0].token_hash).toBe(tokens.hashToken(moToken));
    expect(rows[0].token_hash).not.toContain(moToken);
    expect(await tokens.resolveApiToken(moToken)).toEqual({ id: mo, name: "Mo" });
    const [after] = await q<{ last_used_at: Date | null }>(`select last_used_at from api_tokens where user_id = $1`, [mo]);
    expect(after.last_used_at).not.toBeNull();
  });

  it("lists its tools and who the token is", async () => {
    const client = await connect(moToken);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["whoami", "search", "list_opportunities", "add_opportunity", "update_opportunity", "list_tasks", "create_task", "complete_task", "list_deals", "get_deal", "move_deal", "list_contacts", "get_contact", "log_activity"]),
    );
    const me = await call(client, "whoami");
    expect(me.data.user).toBe("Mo");
    expect(me.data.sharedWorkspace).toBe("member");
    await client.close();
  });

  it("adds Sooz opportunities to the shared workspace and personal ones to the token's user", async () => {
    const client = await connect(moToken);
    const sooz = await call(client, "add_opportunity", { feed: "sooz", kind: "funding", title: "Ivey BPC 2027", url: "https://example.com/ivey", deadline: "2099-11-08", pitch_competition: true, notes: "2-page summary" });
    expect(sooz.isError).toBe(false);
    const [row] = await q<{ user_id: string; tags: string; status: string }>(`select user_id, tags, status from radar_items where id = $1`, [sooz.data.id]);
    expect(row.user_id).toBe(owner);
    expect(row.status).toBe("saved");
    expect(String(row.tags)).toContain("pitch-competition");
    const personal = await call(client, "add_opportunity", { feed: "personal", kind: "hackathon", title: "Mo Hack", url: "https://example.com/hack" });
    expect((await q<{ user_id: string }>(`select user_id from radar_items where id = $1`, [personal.data.id]))[0].user_id).toBe(mo);
    expect((await call(client, "add_opportunity", { feed: "sooz", kind: "funding", title: "Ivey BPC 2027", url: "https://example.com/ivey", deadline: "2099-11-08" })).isError).toBe(true);
    expect((await call(client, "add_opportunity", { feed: "sooz", kind: "angel", title: "A Person", url: "https://example.com/p" })).isError).toBe(true);
    // Risus sees what Mo added to Sooz, but not Mo's personal one.
    const risus = await connect(ownerToken);
    const titles = (await call(risus, "list_opportunities", { feed: "sooz" })).data.map((o: { title: string }) => o.title);
    expect(titles).toContain("Ivey BPC 2027");
    expect((await call(risus, "list_opportunities", { feed: "personal" })).data.map((o: { title: string }) => o.title)).not.toContain("Mo Hack");
    await client.close();
    await risus.close();
  });

  it("updates shared opportunities but never another person's personal ones", async () => {
    const client = await connect(moToken);
    const updated = await call(client, "update_opportunity", { id: w.soozItem, status: "applied", deadline: "2099-01-15", notes: "Submitted by Mo" });
    expect(updated.isError).toBe(false);
    const [row] = await q<{ status: string; deadline: string; notes: string }>(`select status, deadline::text, notes from radar_items where id = $1`, [w.soozItem]);
    expect(row).toEqual({ status: "applied", deadline: "2099-01-15", notes: "Submitted by Mo" });
    expect((await call(client, "update_opportunity", { id: w.soozItem, deadline: null })).isError).toBe(false);
    expect((await q<{ deadline: string | null }>(`select deadline from radar_items where id = $1`, [w.soozItem]))[0].deadline).toBeNull();
    expect((await call(client, "update_opportunity", { id: w.ownerPersonal, status: "dismissed" })).isError).toBe(true);
    expect((await q<{ status: string }>(`select status from radar_items where id = $1`, [w.ownerPersonal]))[0].status).toBe("new");
    await client.close();
  });

  it("works the shared pipelines, tasks and activities, and hides private contacts", async () => {
    const client = await connect(moToken);
    expect((await call(client, "list_deals", { section: "investors" })).data.map((d: { id: string }) => d.id)).toContain(w.deal);
    expect((await call(client, "move_deal", { id: w.deal, stage: "intro" })).data.stage).toBe("intro");
    expect((await call(client, "move_deal", { id: w.deal, stage: "nope" })).isError).toBe(true);
    expect((await call(client, "get_contact", { id: w.angel })).isError).toBe(false);
    expect((await call(client, "get_contact", { id: w.friend })).isError).toBe(true);
    const task = await call(client, "create_task", { title: "Send deck", deal_id: w.deal, due_date: "2099-01-01" });
    expect((await q<{ user_id: string }>(`select user_id from tasks where id = $1`, [task.data.id]))[0].user_id).toBe(owner);
    expect((await call(client, "complete_task", { id: task.data.id })).isError).toBe(false);
    const own = await call(client, "create_task", { title: "Mo errand" });
    expect((await q<{ user_id: string }>(`select user_id from tasks where id = $1`, [own.data.id]))[0].user_id).toBe(mo);
    const logged = await call(client, "log_activity", { type: "email", summary: "Sent deck", deal_id: w.deal });
    expect(logged.isError).toBe(false);
    expect((await call(client, "log_activity", { type: "note", summary: "x", contact_id: w.friend })).isError).toBe(true);
    expect((await call(client, "log_activity", { type: "note", summary: "x" })).isError).toBe(true);
    await client.close();
  });
});
