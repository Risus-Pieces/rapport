import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

function createPool() {
  const created = new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000, // allows for Neon waking from idle
  });
  // An idle client can be dropped by Neon at any time; without a listener Node treats it as fatal.
  created.on("error", (error) => console.error("pg pool: idle client error:", error.message));
  return created;
}

const pool = globalForDb.pgPool ?? createPool();

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
