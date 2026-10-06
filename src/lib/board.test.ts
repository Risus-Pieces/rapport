import { describe, expect, it } from "vitest";
import { dropSortKey, moveCard, type BoardCard } from "./board";

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

  it("ignores the dragged card itself when reordering inside a column", () => {
    // moving c before b: neighbours are a (1) and b (2)
    expect(dropSortKey(cards, "c", "lead", "b")).toBe(1.5);
    // dropping a on b within the same column: b is first once a is removed
    expect(dropSortKey(cards, "a", "lead", "b")).toBeLessThan(2);
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
