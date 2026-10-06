import { describe, expect, it } from "vitest";
import { todayString } from "@/lib/dates";
import { activitySchema } from "./activity";
import { fieldErrors } from "./common";
import { taskSchema } from "./task";

describe("activitySchema", () => {
  it("accepts a minimal activity and nulls blanks", () => {
    expect(activitySchema.parse({ type: "call", summary: " Caught up " })).toEqual({
      type: "call",
      summary: "Caught up",
      body: null,
      day: null,
    });
  });

  it("requires a summary of at most 200 characters", () => {
    expect(activitySchema.safeParse({ type: "call", summary: "  " }).success).toBe(false);
    expect(activitySchema.safeParse({ type: "call", summary: "x".repeat(201) }).success).toBe(false);
    expect(activitySchema.safeParse({ type: "call", summary: "x".repeat(200) }).success).toBe(true);
  });

  it("rejects unknown types, impossible dates and future dates", () => {
    expect(activitySchema.safeParse({ type: "fax", summary: "x" }).success).toBe(false);
    expect(activitySchema.safeParse({ type: "call", summary: "x", day: "2026-02-30" }).success).toBe(false);
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const result = activitySchema.safeParse({ type: "call", summary: "x", day: future });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).day).toBe("That date is in the future.");
    expect(activitySchema.parse({ type: "call", summary: "x", day: todayString() }).day).toBe(todayString());
  });
});

describe("taskSchema", () => {
  it("requires a title and nulls a blank due date and contact", () => {
    expect(taskSchema.safeParse({ title: " " }).success).toBe(false);
    expect(taskSchema.parse({ title: "Send deck", dueDate: "", contactId: "" })).toEqual({
      title: "Send deck",
      dueDate: null,
      contactId: null,
      dealId: null,
    });
  });

  it("rejects bad dates, bad contact ids and long titles", () => {
    expect(taskSchema.safeParse({ title: "x", dueDate: "2026-13-01" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x", contactId: "nope" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "x".repeat(201) }).success).toBe(false);
  });
});
