import { describe, expect, it } from "vitest";
import { isDevDbConfigured } from "./db-guard";

const configured = {
  DATABASE_URL: "postgres://example.test/db",
  BETTER_AUTH_SECRET: "secret",
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("isDevDbConfigured", () => {
  it.each(["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"])(
    "returns false when %s is missing",
    (name) => {
      expect(isDevDbConfigured({ ...configured, NEON_BRANCH: "dev", [name]: undefined })).toBe(false);
    },
  );

  it.each(["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"])(
    "returns false when %s is empty",
    (name) => {
      expect(isDevDbConfigured({ ...configured, NEON_BRANCH: "dev", [name]: "" })).toBe(false);
    },
  );

  it("returns false when nothing is configured, even without NEON_BRANCH", () => {
    expect(isDevDbConfigured({})).toBe(false);
  });

  it("returns true when everything is set and NEON_BRANCH is dev", () => {
    expect(isDevDbConfigured({ ...configured, NEON_BRANCH: "dev" })).toBe(true);
  });

  it.each([{ NEON_BRANCH: "main" }, { NEON_BRANCH: "" }, { NEON_BRANCH: undefined }])(
    "throws when everything is set but NEON_BRANCH is %j",
    (extra) => {
      expect(() => isDevDbConfigured({ ...configured, ...extra })).toThrow(/NEON_BRANCH=dev/);
    },
  );
});
