import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import { account, session, user, verification } from "@/db/auth-schema";
import { env } from "@/lib/env";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // one owner, created by scripts/seed-owner.ts
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  plugins: [nextCookies()], // keep last
});
