import { createInterface } from "node:readline/promises";
import { db } from "@/db";
import { user } from "@/db/schema";
import { createOwner } from "@/lib/owner";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let value = "";
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (char === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

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

function describeError(error: unknown): string {
  if (error instanceof Error) {
    // DrizzleQueryError messages embed the bound query parameters (including password hashes);
    // its cause is the plain driver error.
    return error.cause instanceof Error ? error.cause.message : error.message;
  }
  return String(error);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(describeError(error));
    process.exit(1);
  },
);
