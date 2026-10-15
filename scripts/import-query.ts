// One-time move from Query (the retired opportunity radar) into this database's Radar tables.
// Usage: QUERY_DATABASE_URL=<Query's connection string> DATABASE_URL=<Rapport target> npm run import:query
// Shell variables win over .env.local (which supplies the auth env the app config requires). Idempotent.
import { Client } from "pg";
import { db } from "@/db";
import { importFromQuery } from "@/db/queries/import-query";

async function main() {
  const source = process.env.QUERY_DATABASE_URL;
  if (!source) throw new Error("Set QUERY_DATABASE_URL to Query's database.");
  const { rows } = await db.$client.query<{ owner: string }>("select rr_owner() as owner");
  const query = new Client({ connectionString: source });
  await query.connect();
  try {
    await query.query("begin read only");
    const counts = await importFromQuery({ query: (text, params) => query.query(text, params) }, rows[0].owner);
    await query.query("commit");
    console.log("Imported from Query:", counts);
  } finally {
    await query.end();
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
