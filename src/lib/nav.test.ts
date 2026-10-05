import { describe, expect, it } from "vitest";
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath } from "./nav";

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

  it("keeps exactly five primary items so the phone tab bar fits", () => {
    expect(PRIMARY_NAV).toHaveLength(5);
  });
});
