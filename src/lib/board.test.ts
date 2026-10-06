import { describe, expect, it } from "vitest";
import { dropSortKey, moveCard, needsRenumber, type BoardCard } from "./board";

const cards: BoardCard[] = [
  { id: "a", stage: "lead", sortKey: 1 },
  { id: "b", stage: "lead", sortKey: 2 },
  { id: "c", stage: "lead", sortKey: 3 },
  { id: "x", stage: "tasting", sortKey: 10 },
];

describe("dropSortKey", () => {
  it("appends to the end when dropped on empty column space", () => {
    expect(dropSortKey(cards, "a", "tasting", null)).toBe(11);
    expect(dropSortKey(cards, "x", "negotiating", null)).toBe(1);
  });

  it("places a card between its neighbours when dropped on a card", () => {
    expect(dropSortKey(cards, "x", "lead", "b")).toBe(1.5);
    expect(dropSortKey(cards, "x", "lead", "c")).toBe(2.5);
  });

  it("places a card before the first card", () => {
    expect(dropSortKey(cards, "x", "lead", "a")).toBeLessThan(1);
  });

  it("moving up in the same column puts the card before the target", () => {
    expect(dropSortKey(cards, "c", "lead", "b")).toBe(1.5);
  });

  it("moving down in the same column puts the card after the target", () => {
    // a dropped on b: a must end up between b (2) and c (3)
    expect(dropSortKey(cards, "a", "lead", "b")).toBe(2.5);
    // a dropped on the last card goes to the very end
    expect(dropSortKey(cards, "a", "lead", "c")).toBe(4);
  });

  it("falls back to the end when the target card is unknown", () => {
    expect(dropSortKey(cards, "x", "lead", "nope")).toBe(4);
  });
});

describe("moveCard", () => {
  it("moves only the named card", () => {
    const moved = moveCard(cards, "a", "tasting", 11);
    expect(moved.find((c) => c.id === "a")).toEqual({ id: "a", stage: "tasting", sortKey: 11 });
    expect(moved.filter((c) => c.id !== "a")).toEqual(cards.filter((c) => c.id !== "a"));
  });
});

describe("needsRenumber", () => {
  it("flags keys that are nearly equal or tied", () => {
    expect(needsRenumber([1, 2, 3])).toBe(false);
    expect(needsRenumber([1, 1, 3])).toBe(true);
    expect(needsRenumber([1, 1 + 1e-9])).toBe(true);
    expect(needsRenumber([])).toBe(false);
  });

  it("detects the collapse after repeated halving of one gap", () => {
    let low = 1;
    const high = 2;
    for (let i = 0; i < 60; i++) low = (low + high) / 2;
    expect(needsRenumber([low, high])).toBe(true);
  });
});
