import { describe, expect, it } from "vitest";
import { filterPalette, PALETTE_ITEMS } from "./palette";

describe("filterPalette", () => {
  it("shows everything for an empty query", () => {
    expect(filterPalette("  ")).toEqual(PALETTE_ITEMS);
  });

  it("filters pages and actions together, ignoring case", () => {
    const { pages, actions } = filterPalette("REST");
    expect(pages.map((p) => p.label)).toEqual(["Restaurants"]);
    expect(actions.map((a) => a.label)).toEqual(["Add restaurant"]);
  });

  it("lists the Radar page", () => {
    expect(filterPalette("radar").pages).toEqual([{ label: "Radar", href: "/radar" }]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterPalette("zzz")).toEqual({ pages: [], actions: [] });
  });

  it("only links to routes that exist", () => {
    const all = [...PALETTE_ITEMS.pages, ...PALETTE_ITEMS.actions];
    expect(all.every((item) => item.href.startsWith("/"))).toBe(true);
  });
});
