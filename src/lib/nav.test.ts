import { describe, expect, it } from "vitest";
import { MOBILE_NAV, PRIMARY_NAV, SECONDARY_NAV, SECTION_STYLES, isActivePath, type SectionAccent } from "./nav";

describe("isActivePath", () => {
  it("matches Home only on the exact root path", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/tasks", "/")).toBe(false);
  });

  it("matches a section on its own path and on nested paths", () => {
    expect(isActivePath("/restaurants", "/restaurants")).toBe(true);
    expect(isActivePath("/restaurants/abc", "/restaurants")).toBe(true);
  });

  it("does not match a different path that merely starts with the same letters", () => {
    expect(isActivePath("/restaurants-old", "/restaurants")).toBe(false);
    expect(isActivePath("/investors", "/restaurants")).toBe(false);
  });
});

describe("nav config", () => {
  it("has unique, absolute hrefs", () => {
    const hrefs = [...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every((href) => href.startsWith("/"))).toBe(true);
  });

  it("puts This week and Opportunities right after Home", () => {
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual(["/", "/week", "/opportunities", "/restaurants", "/investors", "/general", "/tasks"]);
  });

  it("keeps six tabs on phones (six 44px tabs fit a 360px phone); Tasks stays in the sidebar and on Home", () => {
    expect(MOBILE_NAV.map((item) => item.href)).toEqual(["/", "/week", "/opportunities", "/restaurants", "/investors", "/general"]);
  });
});

describe("SECTION_STYLES", () => {
  const sections: SectionAccent[] = ["restaurants", "investors", "general"];

  it("has an entry for every accent used in PRIMARY_NAV", () => {
    const used = PRIMARY_NAV.flatMap((item) => (item.accent ? [item.accent] : []));
    expect(used.length).toBeGreaterThan(0);
    for (const accent of used) {
      expect(SECTION_STYLES[accent], `missing styles for ${accent}`).toBeDefined();
    }
  });

  it("covers exactly the three sections", () => {
    expect(Object.keys(SECTION_STYLES).sort()).toEqual([...sections].sort());
  });

  it("uses non-empty literal class strings that name their section", () => {
    for (const section of sections) {
      const { dot, chip, text } = SECTION_STYLES[section];
      for (const classes of [dot, chip, text]) {
        expect(classes.trim().length).toBeGreaterThan(0);
        expect(classes).toContain(`section-${section}`);
        // Literal tokens only: Tailwind cannot generate classes built at run time.
        expect(classes).not.toMatch(/[${}]/);
      }
    }
  });
});
