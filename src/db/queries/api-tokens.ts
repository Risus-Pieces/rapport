import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, user } from "@/db/schema";

// Personal API tokens for agents. Only the SHA-256 hash is stored; the plain token is returned once, at creation.

const TOKEN_PREFIX = "rpt_";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createApiToken(userId: string, name: string): Promise<{ id: string; token: string }> {
  const label = name.trim().slice(0, 80) || "Agent";
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name: label, tokenHash: hashToken(token), prefix: token.slice(0, 10) })
    .returning({ id: apiTokens.id });
  return { id: row.id, token };
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.userId, userId), eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  return rows.length > 0;
}

/** The user a live token belongs to, or null. Records when it was last used. */
export async function resolveApiToken(token: string): Promise<{ id: string; name: string } | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null;
  const [row] = await db
    .select({ tokenId: apiTokens.id, id: user.id, name: user.name })
    .from(apiTokens)
    .innerJoin(user, eq(user.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  return { id: row.id, name: row.name };
}
