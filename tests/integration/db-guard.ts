const REQUIRED = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;

export function isDevDbConfigured(env: Record<string, string | undefined>): boolean {
  if (REQUIRED.some((name) => !env[name])) return false; // no database configured: skip integration suites
  if (env.NEON_BRANCH !== "dev") {
    throw new Error(
      "Refusing to run integration tests: they write to the database in DATABASE_URL. " +
        "Set NEON_BRANCH=dev in .env.local to confirm it points at the Neon dev branch (never main).",
    );
  }
  return true;
}

export const hasDevDb = isDevDbConfigured(process.env);
