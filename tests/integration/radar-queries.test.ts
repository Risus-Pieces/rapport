import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("radar queries (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  let db: Db;
  let s: typeof import("@/db/schema");
  let r: typeof import("@/db/queries/radar");
  let owner = randomUUID();
  const users: string[] = [];

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await db.$client.query(text, params)).rows as T[];
  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q<T>(text, params))[0];
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

  const item = async (title: string, o: { kind?: string; feed?: string; score?: number; status?: string; event_date?: string | null; tags?: string[]; firm?: string } = {}) =>
    (await one<{ id: string }>(
      `insert into radar_items (user_id, feed, kind, title, url, score, status, event_date, tags, details, dedupe_key)
       values ($1, $2, $3, $4, 'https://x.com/' || $5, $6, $7, $8::date, $9, $10::jsonb, $5) returning id`,
      [owner, o.feed ?? "sooz", o.kind ?? "angel", title, title.toLowerCase().replace(/\W+/g, "-"), o.score ?? 70,
       o.status ?? "new", o.event_date ?? null, o.tags ?? [], JSON.stringify({ firm: o.firm ?? "Acme Ventures", role: "Partner" })],
    ))!.id;
  const titles = (rows: { title: string }[]) => rows.map((x) => x.title);

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    r = await import("@/db/queries/radar");
  });

  beforeEach(async () => {
    owner = randomUUID();
    users.push(owner);
    await db.insert(s.user).values({ id: owner, name: "T", email: `radar-q-${owner}@example.test`, emailVerified: true });
  });

  afterAll(async () => {
    if (db && s && users.length) await db.delete(s.user).where(inArray(s.user.id, users));
  });

  describe("listing", () => {
    it("filters by feed, view, kind and Rice, and hides past items from the inbox", async () => {
      await item("Angel A", { score: 90, tags: ["rice"] });
      await item("Angel B", { score: 60 });
      await item("Expo Soon", { kind: "event", event_date: day(10) });
      await item("Expo Past", { kind: "event", event_date: day(-3) });
      await item("Saved One", { status: "saved" });
      await item("In CRM", { status: "approved" });
      await item("Hack", { feed: "personal", kind: "hackathon" });
      const base = { feed: "sooz" as const, view: "inbox" as const, sort: "score" as const };
      expect(titles(await r.listRadar(owner, base))).toEqual(["Angel A", "Expo Soon", "Angel B"]);
      expect(titles(await r.listRadar(owner, { ...base, kind: "event" }))).toEqual(["Expo Soon"]);
      expect(titles(await r.listRadar(owner, { ...base, rice: true }))).toEqual(["Angel A"]);
      expect(titles(await r.listRadar(owner, { ...base, q: "angel b" }))).toEqual(["Angel B"]);
      expect(titles(await r.listRadar(owner, { ...base, view: "approved" }))).toEqual(["In CRM"]);
      expect(await r.radarCounts(owner, "sooz")).toEqual({ inbox: 3, saved: 1, approved: 1, dismissed: 0 });
      expect(await r.radarNewCounts(owner)).toEqual({ sooz: 3, personal: 1, career: 0 }); // "Expo Past" is new but past
      expect(await r.radarKindCounts(owner, "sooz", "inbox")).toEqual(expect.arrayContaining([{ kind: "angel", n: 2 }, { kind: "event", n: 1 }]));
    });

    it("new counts leave out past-dated items, like the inbox does", async () => {
      await item("Past New", { kind: "event", event_date: day(-2) });
      await item("Future New", { kind: "event", event_date: day(2) });
      await item("Undated Angel");
      expect(await r.radarNewCounts(owner)).toEqual({ sooz: 2, personal: 0, career: 0 });
      expect(await r.radarPeopleNewCount(owner)).toBe(1);
    });

    it("never lets a status change undo an approval; notes and see-all work", async () => {
      const approved = await item("Approved");
      await r.approveRadarItem(owner, approved);
      const fresh = await item("Fresh");
      expect(await r.setRadarStatus(owner, approved, "dismissed")).toBe(false);
      expect(await r.setRadarStatus(owner, fresh, "saved")).toBe(true);
      expect(await r.setRadarStatus(randomUUID(), fresh, "dismissed")).toBe(false);
      await r.setRadarNotes(owner, fresh, "x".repeat(5000));
      expect(await one(`select status, length(notes) as n from radar_items where id = $1`, [fresh])).toEqual({ status: "saved", n: 4000 });
      await item("Another");
      await r.markFeedSeen(owner, "sooz");
      expect((await r.radarNewCounts(owner)).sooz).toBe(0);
      expect((await one<{ status: string }>(`select status from radar_items where id = $1`, [approved]))!.status).toBe("approved");
    });

    it("splits the Sooz feed into people and everything else", async () => {
      await item("Angel P", { score: 90 });
      await item("Buyer P", { kind: "buyer", score: 80 });
      await item("Expo P", { kind: "event", event_date: day(5) });
      const base = { feed: "sooz" as const, view: "inbox" as const, sort: "score" as const };
      expect(titles(await r.listRadar(owner, { ...base, people: true }))).toEqual(["Angel P", "Buyer P"]);
      expect(titles(await r.listRadar(owner, { ...base, people: false }))).toEqual(["Expo P"]);
      expect(await r.radarCounts(owner, "sooz", true)).toMatchObject({ inbox: 2 });
      expect((await r.radarKindCounts(owner, "sooz", "inbox", false)).map((k) => k.kind)).toEqual(["event"]);
      expect(await r.radarNewCounts(owner)).toEqual({ sooz: 3, personal: 0, career: 0 });
      expect(await r.radarPeopleNewCount(owner)).toBe(2);
    });

    it("counts drafts ready to send and drafts waiting for approval", async () => {
      const ready = await item("Ready One");
      await r.approveRadarItem(owner, ready);
      await r.saveOutreachEdits(owner, ready, { body: "Hi" });
      const waiting = await item("Waiting One", { score: 90 });
      await q(`insert into outreach (user_id, radar_item_id, stage, body) values ($1, $2, 'drafted', 'Hi')`, [owner, waiting]);
      expect(await r.outreachDraftCounts(owner)).toEqual({ ready: 1, waiting: 1 });
    });

    it("shows a draft badge for pre-drafted finds", async () => {
      const id = await item("Drafted", { score: 90 });
      await q(`insert into outreach (user_id, radar_item_id, stage, body) values ($1, $2, 'drafted', 'Hi')`, [owner, id]);
      const [row] = await r.listRadar(owner, { feed: "sooz", view: "inbox", sort: "score" });
      expect(row).toMatchObject({ title: "Drafted", outreachStage: "drafted", hasDraft: true, draft: { subject: null, body: "Hi" } });
    });
  });

  describe("settings and network", () => {
    it("saves and reads pitch facts per owner", async () => {
      await r.savePitch(owner, { "pitch.company": " Sooz ", "pitch.one_liner": "Sparkling." });
      expect(await r.getPitch(owner)).toMatchObject({ "pitch.company": "Sooz", "pitch.one_liner": "Sparkling." });
      expect(await r.getPitch(randomUUID())).toEqual({});
    });

    it("imports connections once per LinkedIn URL and finds warm paths by any firm", async () => {
      const a = await item("Jane Doe", { firm: "The Angel Group; Supernatural Ventures" });
      const b = await item("Ola Smith", { firm: "Other Fund" });
      expect(await r.importConnections(owner, [
        { full_name: "Sam Lee", company: "Supernatural Ventures", position: "Associate", linkedin_url: "https://www.linkedin.com/in/sam", email: null, connected_on: null },
        { full_name: "Sam Lee", company: "Supernatural Ventures", position: "Partner", linkedin_url: "https://www.linkedin.com/in/sam/", email: null, connected_on: null },
        { full_name: "Ola Smith", company: "Other Fund", position: "Partner", linkedin_url: null, email: null, connected_on: null },
      ])).toBe(3);
      expect(await r.networkSize(owner)).toBe(2);
      const m = await r.warmMatches(owner, [a, b]);
      expect(m.get(a)?.map((x) => [x.full_name, x.kind])).toEqual([["Sam Lee", "same_company"]]);
      expect(m.get(b)?.[0]).toMatchObject({ full_name: "Ola Smith", kind: "same_person" });
    });
  });

  describe("people CSV import", () => {
    it("ingests people of any kind with purpose and contact fields, and rejects unknown kinds", async () => {
      const csv = [
        "name,kind,purpose,firm,role,summary,url,score,linkedin_url,email",
        "Sam Star,celebrity,,Houston Texans,Linebacker,Backed a sports drink,https://a.com/sam,80,,",
        "Bea Buyer,buyer,intro,H-E-B,Category manager,Runs the set,https://a.com/bea,75,https://www.linkedin.com/in/bea,bea@heb.example",
        "Who Knows,wizard,,X,Y,z,https://a.com/who,90,,",
      ].join("\n");
      const res = await r.importPeopleToRadar(owner, csv);
      expect(res).toMatchObject({ received: 3, valid: 2, inserted: 2 });
      expect(await q(`select title, kind, dedupe_key from radar_items where user_id = $1 order by title`, [owner])).toEqual([
        { title: "Bea Buyer", kind: "buyer", dedupe_key: "buyer:bea-buyer:h-e-b" },
        { title: "Sam Star", kind: "celebrity", dedupe_key: "celebrity:sam-star:houston-texans" },
      ]);
      // People go straight into the CRM (approved, with an outreach row each).
      expect(await q(`select i.title, i.status, o.purpose, o.linkedin_url, o.email from outreach o join radar_items i on i.id = o.radar_item_id where o.user_id = $1 order by i.title`, [owner])).toEqual([
        { title: "Bea Buyer", status: "approved", purpose: "intro", linkedin_url: "https://www.linkedin.com/in/bea", email: "bea@heb.example" },
        { title: "Sam Star", status: "approved", purpose: "ambassador", linkedin_url: null, email: null },
      ]);
    });
  });

  describe("outreach on the record", () => {
    it("approve opens an outreach row so the panel is there straight away", async () => {
      const id = await item("Panel Person");
      const res = await r.approveRadarItem(owner, id);
      const o = await r.getOutreachFor(owner, { dealId: res.dealId! });
      expect(o).toMatchObject({ radarItemId: id, purpose: "invest", stage: "prospect", name: "Panel Person" });
      expect(await r.getOutreachFor(owner, { contactId: res.contactId })).toMatchObject({ radarItemId: id });
    });

    it("lists every person's thread on a shared deal, and only people still in the CRM", async () => {
      const a = await item("Shared Buyer A", { kind: "buyer", firm: "Shared Store" });
      const b = await item("Shared Buyer B", { kind: "buyer", firm: "Shared Store" });
      const ra = await r.approveRadarItem(owner, a);
      const rb = await r.approveRadarItem(owner, b);
      expect(rb.dealId).toBe(ra.dealId);
      expect((await r.listOutreachFor(owner, { dealId: ra.dealId! })).map((o) => o.name).sort()).toEqual(["Shared Buyer A", "Shared Buyer B"]);
      await q(`delete from contacts where id = $1`, [rb.contactId]);
      expect((await r.listOutreachFor(owner, { dealId: ra.dealId! })).map((o) => o.name)).toEqual(["Shared Buyer A"]);
      expect((await r.listOutreachFor(owner, { contactId: ra.contactId })).map((o) => o.name)).toEqual(["Shared Buyer A"]);
    });

    it("clearing the draft body takes the thread back to needing a draft", async () => {
      const id = await item("Clear Person");
      await r.approveRadarItem(owner, id);
      await r.saveOutreachEdits(owner, id, { subject: "Hi", body: "Hello" });
      expect(await r.saveOutreachEdits(owner, id, { subject: "Hi", body: "" })).toEqual({ ok: true });
      expect(await r.getOutreachForItem(owner, id)).toMatchObject({ stage: "prospect", body: null });
    });

    it("edits drafts with validation, changes purpose, and records sends through the shared SQL", async () => {
      const id = await item("Edit Person");
      const res = await r.approveRadarItem(owner, id);
      expect(await r.saveOutreachEdits(owner, id, { email: "nope" })).toMatchObject({ ok: false });
      expect(await r.saveOutreachEdits(owner, id, { linkedin_url: "https://evil.com/in/x" })).toMatchObject({ ok: false });
      expect(await r.saveOutreachEdits(owner, id, { email: "Edit@Fund.vc", subject: "Hi", body: "Hello" })).toEqual({ ok: true });
      expect(await r.getOutreachForItem(owner, id)).toMatchObject({ stage: "drafted", email: "edit@fund.vc", emailSource: "manual", draftedBy: "you" });
      expect(await r.setOutreachPurpose(owner, id, "intro")).toBe(true);
      expect(await r.setOutreachPurpose(owner, id, "bribe")).toBe(false);
      expect(await r.recordOutreach(owner, id, "sent")).toBe("ok");
      expect((await one<{ stage: string }>(`select stage from deals where id = $1`, [res.dealId]))!.stage).toBe("intro");
      expect(await r.saveOutreachEdits(owner, id, { body: "changed" })).toMatchObject({ ok: false });
    });
  });

  describe("export and search", () => {
    it("exports radar items and finds them in search", async () => {
      await item("Findable Angel", { score: 88 });
      await item("Dismissed Thing", { status: "dismissed" });
      const { exportRows } = await import("@/db/queries/export");
      const { columns, rows } = await exportRows(owner, "radar");
      expect(columns).toEqual(expect.arrayContaining(["feed", "kind", "title", "status", "score", "url"]));
      expect(rows.map((x) => x.title).sort()).toEqual(["Dismissed Thing", "Findable Angel"]);
      const { searchRecords } = await import("@/db/queries/search");
      const hits = await searchRecords(owner, "findable");
      expect(hits).toEqual([expect.objectContaining({ label: "Findable Angel", detail: "Radar · Sooz · Angel", href: "/radar?q=Findable+Angel" })]);
      expect((await searchRecords(owner, "dismissed thing"))[0].href).toBe("/radar?view=dismissed&q=Dismissed+Thing");
      await item("Findable Expo", { kind: "event" });
      await item("Findable Hack", { feed: "personal", kind: "hackathon" });
      const more = await searchRecords(owner, "findable");
      expect(more.find((h) => h.label === "Findable Expo")?.href).toBe("/radar?tab=sooz&q=Findable+Expo");
      expect(more.find((h) => h.label === "Findable Hack")?.href).toBe("/radar?tab=personal&q=Findable+Hack");
    });
  });
});
