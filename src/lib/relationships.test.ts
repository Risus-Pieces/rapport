import { describe, expect, it } from "vitest";
import { RELATIONSHIPS, RELATIONSHIP_LABELS, isRelationship } from "@/lib/relationships";

describe("relationships", () => {
  it("has the five statuses in display order with the owner's labels", () => {
    expect(RELATIONSHIPS).toEqual(["to_reach_out", "known", "ghosted", "on_hold", "dismissed"]);
    expect(RELATIONSHIPS.map((r) => RELATIONSHIP_LABELS[r])).toEqual(["To reach out", "Know them", "Ghosted", "On hold", "Dismissed"]);
  });
  it("recognises only those values", () => {
    expect(isRelationship("ghosted")).toBe(true);
    expect(isRelationship("in_conversation")).toBe(false);
  });
});
