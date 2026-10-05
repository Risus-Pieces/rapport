import { describe, expect, it } from "vitest";
import { parseEnv } from "./env-schema";

const valid = {
  DATABASE_URL:
    "postgres://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete, valid environment", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("rejects an auth secret shorter than 32 characters", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("names every missing variable in one error", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET })).toThrow(
      /DATABASE_URL[\s\S]*BETTER_AUTH_URL/,
    );
  });

  it("rejects a BETTER_AUTH_URL that is not a URL", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_URL: "localhost" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });
});
