import { describe, expect, it } from "vitest";
import { dedupeKey, firstFirm, normalizeUrl, slug } from "@/lib/radar/dedupe";

describe("normalizeUrl", () => {
  it("drops tracking params, hash, www and trailing slash", () => {
    expect(normalizeUrl("https://www.Example.com/Events/?utm_source=x&b=2&a=1#top")).toBe("example.com/Events?a=1&b=2");
  });
  it("rejects non-http(s) and garbage", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("ftp://x.com/a")).toBeNull();
  });
  it("treats tracking-only variants as the same page", () => {
    expect(normalizeUrl("https://a.com/p?utm_campaign=1")).toBe(normalizeUrl("http://www.a.com/p/"));
  });
});

describe("dedupeKey", () => {
  it("identifies angels by person, not by source page", () => {
    const a = dedupeKey({ feed: "sooz", kind: "angel", title: "Jane  Doe", url: "https://a.com/x", firm: "Acme VC" });
    const b = dedupeKey({ feed: "sooz", kind: "angel", title: "jane doe", url: "https://b.com/y", firm: "ACME VC" });
    expect(a).toBe(b);
  });
  it("keeps same-named angels at different firms apart", () => {
    const a = dedupeKey({ feed: "sooz", kind: "angel", title: "Jane Doe", firm: "Acme" });
    const b = dedupeKey({ feed: "sooz", kind: "angel", title: "Jane Doe", firm: "Other" });
    expect(a).not.toBe(b);
  });
  it("identifies other items by canonical URL", () => {
    const a = dedupeKey({ feed: "personal", kind: "event", title: "Hack", url: "https://x.com/e?utm_source=a" });
    const b = dedupeKey({ feed: "personal", kind: "hackathon", title: "Hack 2", url: "https://www.x.com/e/" });
    expect(a).toBe(b);
  });
  it("scopes keys by section", () => {
    const u = "https://x.com/e";
    expect(dedupeKey({ feed: "sooz", kind: "event", title: "t", url: u })).not.toBe(
      dedupeKey({ feed: "personal", kind: "event", title: "t", url: u }),
    );
  });
  it("identifies every person kind by name, with a kind prefix", () => {
    const a = dedupeKey({ feed: "sooz", kind: "celebrity", title: "Sam Star", url: "https://a.com/1", firm: "Houston Texans" });
    const b = dedupeKey({ feed: "sooz", kind: "celebrity", title: "sam  star", url: "https://b.com/2", firm: "houston texans" });
    expect(a).toBe(b);
    expect(a).toBe("celebrity:sam-star:houston-texans");
    expect(dedupeKey({ feed: "sooz", kind: "media", title: "Pat Writer", firm: null })).toBe("media:pat-writer");
    expect(dedupeKey({ feed: "sooz", kind: "buyer", title: "Pat Writer", firm: "H-E-B" })).not.toBe(
      dedupeKey({ feed: "sooz", kind: "media", title: "Pat Writer", firm: "H-E-B" }),
    );
  });
  it("keys non-angel people on their first firm, angels on the whole firm field (existing keys stay put)", () => {
    expect(dedupeKey({ feed: "sooz", kind: "nextgen", title: "Ann Heir", firm: "Heir Family Office; Heir Ventures" })).toBe(
      "nextgen:ann-heir:heir-family-office",
    );
    expect(dedupeKey({ feed: "sooz", kind: "creator", title: "Ann", firm: " ; Other" })).toBe("creator:ann");
    expect(dedupeKey({ feed: "sooz", kind: "angel", title: "Jane Doe", firm: "The Angel Group; Supernatural Ventures" })).toBe(
      "angel:jane-doe:the-angel-group-supernatural-ventures",
    );
  });
  it("keys career items by URL like other non-people", () => {
    expect(dedupeKey({ feed: "career", kind: "internship", title: "Acme: Intern", url: "https://acme.com/jobs/1?utm_source=x" })).toBe(
      "career:url:acme.com/jobs/1",
    );
    expect(firstFirm("A | B")).toBe("A");
    expect(firstFirm(null)).toBeNull();
  });
  it("slug strips accents and punctuation", () => {
    expect(slug("José  O'Neil!")).toBe("jose-o-neil");
  });
});
