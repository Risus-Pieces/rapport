import { createInterface } from "node:readline/promises";
import { count } from "drizzle-orm";
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
  const [{ existing }] = await db.select({ existing: count() }).from(user);
  if (existing > 0) throw new Error("An owner account already exists. Remove it first to start over.");

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
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
