import { describe, expect, it } from "vitest";
import { deletionSummary } from "./delete-summary";

describe("deletionSummary", () => {
  it("says nothing else is attached when there is nothing", () => {
    expect(deletionSummary({ activities: 0, deals: 0, tasks: 0 })).toBe("Nothing else is attached to this contact.");
  });

  it("counts what goes, with singular and plural forms", () => {
    expect(deletionSummary({ activities: 14, deals: 1, tasks: 0 })).toBe("This also deletes 14 logged activities and 1 deal.");
    expect(deletionSummary({ activities: 1, deals: 0, tasks: 0 })).toBe("This also deletes 1 logged activity.");
  });

  it("says that tasks stay", () => {
    expect(deletionSummary({ activities: 0, deals: 0, tasks: 2 })).toBe(
      "Nothing else is attached to this contact. 2 tasks will stay but lose the link.",
    );
  });
});
