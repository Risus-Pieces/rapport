import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./snapshot";

describe("buildSnapshot", () => {
  it("lists every stage in order with zeros, and totals open deals", () => {
    const snap = buildSnapshot("restaurants", [
      { stage: "lead", count: 2, amountCents: 100_000 },
      { stage: "tasting", count: 1, amountCents: 50_000 },
      { stage: "active", count: 3, amountCents: 900_000 },
      { stage: "lost", count: 1, amountCents: 10_000 },
    ]);
    expect(snap.stages.map((s) => s.key)).toEqual(["lead", "contacted", "tasting", "negotiating", "active", "lost"]);
    expect(snap.stages.find((s) => s.key === "contacted")).toMatchObject({ count: 0, amountCents: 0 });
    expect(snap.openCount).toBe(3);
    expect(snap.openCents).toBe(150_000);
    expect(snap.wonCount).toBe(3);
  });

  it("is all zeros for an empty pipeline", () => {
    const snap = buildSnapshot("investors", []);
    expect(snap.stages).toHaveLength(7);
    expect(snap).toMatchObject({ openCount: 0, openCents: 0, wonCount: 0 });
  });
});
