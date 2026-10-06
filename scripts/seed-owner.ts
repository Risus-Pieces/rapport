import { db } from "@/db";
import { user } from "@/db/schema";
import { createOwner } from "@/lib/owner";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { ask, askHidden, describeError } from "./prompts";

async function main() {
  if (!process.stdin.isTTY) throw new Error("Run this in an interactive terminal: npm run seed:owner");
  const existing = await db.select({ email: user.email }).from(user).limit(5);
  if (existing.length > 0) {
    throw new Error(
      [
        `An owner account already exists (${existing.map((row) => row.email).join(", ")}), so seeding is refused.`,
        "Addresses ending in @example.test are leftovers from interrupted test runs and are safe to delete.",
        "Do NOT delete a real owner by hand: every CRM table cascades from the user, so that would delete all CRM data.",
      ].join("\n"),
    );
  }

  const email = await ask("Owner email: ");
  const name = (await ask("Display name [Owner]: ")) || "Owner";
  const password = await askHidden(`Password (min ${MIN_PASSWORD_LENGTH} characters): `);
  const confirm = await askHidden("Repeat password: ");
  if (password !== confirm) throw new Error("Passwords do not match.");

  await createOwner({ email, name, password });
  console.log(`Created owner ${email}. You can now sign in at /login.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(describeError(error));
    process.exit(1);
  },
);
