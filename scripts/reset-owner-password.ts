import { db } from "@/db";
import { user } from "@/db/schema";
import { resetOwnerPassword } from "@/lib/owner";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { ask, askHidden, describeError } from "./prompts";

async function main() {
  if (!process.stdin.isTTY) throw new Error("Run this in an interactive terminal: npm run reset:owner-password");
  const users = await db.select({ email: user.email }).from(user).limit(5);
  if (users.length === 0) throw new Error("No owner account exists yet. Run: npm run seed:owner");

  const email = await ask(`Owner email${users.length === 1 ? ` [${users[0].email}]` : ""}: `);
  const target = email || (users.length === 1 ? users[0].email : "");
  const password = await askHidden(`New password (min ${MIN_PASSWORD_LENGTH} characters): `);
  const confirm = await askHidden("Repeat new password: ");
  if (password !== confirm) throw new Error("Passwords do not match.");

  await resetOwnerPassword({ email: target, password });
  console.log(`Password updated for ${target.toLowerCase()}. Every existing session was signed out.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(describeError(error));
    process.exit(1);
  },
);
