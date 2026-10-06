import { describe, expect, it } from "vitest";
import { trustedOrigins } from "./trusted-origins";

describe("trustedOrigins", () => {
  it("trusts the configured URL's origin only", () => {
    expect(trustedOrigins({ BETTER_AUTH_URL: "https://rapport.example.com/some/path" })).toEqual([
      "https://rapport.example.com",
    ]);
  });

  it("adds the Vercel deployment hosts when present", () => {
    expect(
      trustedOrigins({
        BETTER_AUTH_URL: "http://localhost:3000",
        VERCEL_URL: "rapport-abc.vercel.app",
        VERCEL_BRANCH_URL: "rapport-git-x.vercel.app",
      }),
    ).toEqual(["http://localhost:3000", "https://rapport-abc.vercel.app", "https://rapport-git-x.vercel.app"]);
  });

  it("returns nothing for an empty environment", () => {
    expect(trustedOrigins({})).toEqual([]);
  });
});
