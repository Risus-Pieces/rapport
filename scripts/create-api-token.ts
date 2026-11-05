import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { createApiToken } from "@/db/queries/api-tokens";
import { ask, describeError } from "./prompts";

// Makes a personal API token for an agent from the terminal (the same as Settings → API tokens).
async function main() {
  const email = (process.argv[2] ?? (await ask("Email of the user the agent acts as: "))).trim().toLowerCase();
  const name = process.argv[3] ?? ((await ask("Token name [Agent]: ")) || "Agent");
  const [found] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (!found) throw new Error(`No user with email ${email}.`);
  const { token } = await createApiToken(found.id, name);
  console.log(`Token for ${email} (${name}). Copy it now; it is not stored:\n${token}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(describeError(error));
    process.exit(1);
  },
);
