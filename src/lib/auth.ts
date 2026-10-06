import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { account, rateLimit, session, user, verification } from "@/db/auth-schema";
import { env } from "@/lib/env";
import { trustedOrigins } from "@/lib/trusted-origins";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, rateLimit },
  }),
  trustedOrigins: trustedOrigins(process.env),
  // Production-only by default; the database store is shared across serverless instances.
  rateLimit: { storage: "database" },
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // one owner, created by scripts/seed-owner.ts
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
  },
  plugins: [nextCookies()], // keep last
});
