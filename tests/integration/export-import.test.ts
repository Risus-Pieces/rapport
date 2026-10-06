import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasDevDb } from "./db-guard";

describe.skipIf(!hasDevDb)("CSV export and import (runs against the Neon dev branch)", () => {
  type Db = typeof import("@/db").db;
  type Schema = typeof import("@/db/schema");
  let db: Db;
  let s: Schema;
  const owner = randomUUID();
  const other = randomUUID();

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    for (const id of [owner, other]) {
      await db.insert(s.user).values({ id, name: "T", email: `csv-${id}@example.test`, emailVerified: true });
    }
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(inArray(s.user.id, [owner, other]));
  });

  it("round-trips contacts: the export is a valid import that skips everything already there", async () => {
    const { importContacts, listContactKeys } = await import("@/db/queries/contacts");
    const { exportRows } = await import("@/db/queries/export");
    const { toCsv, parseCsvTable } = await import("@/lib/csv");
    const { planContactImport } = await import("@/lib/contact-import");

    const first = planContactImport(
      parseCsvTable('section,name,email,priority,tags,notes\ngeneral,Ada,ada@x.test,High,friend;family,"line1\nline2"\ninvestors,Bo,,,,=cmd()\n').rows,
      await listContactKeys(owner),
    );
    expect(first.errors).toEqual([]);
    expect(await importContacts(owner, first.toCreate)).toBe(2);

    const { columns, rows } = await exportRows(owner, "contacts");
    expect(rows).toHaveLength(2);
    const csv = toCsv(columns, rows);
    expect(csv).toContain("'=cmd()");

    const again = planContactImport(parseCsvTable(csv).rows, await listContactKeys(owner));
    expect(again.errors).toEqual([]);
    expect(again.toCreate).toEqual([]);
    expect(again.duplicates).toBe(2);
  });

  it("exports only the owner's rows for every kind", async () => {
    const { exportRows, EXPORT_KINDS } = await import("@/db/queries/export");
    const [theirs] = await db.insert(s.contacts).values({ userId: other, section: "general", name: "Not Yours" }).returning();
    await db.insert(s.tasks).values({ userId: other, title: "Not yours", contactId: theirs.id });
    for (const kind of EXPORT_KINDS) {
      const { rows } = await exportRows(owner, kind);
      expect(JSON.stringify(rows)).not.toContain("Not Yours");
      expect(JSON.stringify(rows)).not.toContain("Not yours");
    }
    const mine = await exportRows(other, "contacts");
    expect(mine.rows.map((r) => r.name)).toEqual(["Not Yours"]);
  });
});
