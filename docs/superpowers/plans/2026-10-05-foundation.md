# Foundation (Phase 1 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Supabase-era scaffold with a working, logged-in app: a Neon database holding the full CRM schema, single-owner Better Auth login, and a themed, responsive navigation shell with stub pages for every section.

**Architecture:** Next.js App Router with server components. Drizzle ORM talks to Neon Postgres through a `pg` pool (transactions work, plain Node runtime). Better Auth stores users in the same database. `src/proxy.ts` is a fast cookie gate; every server component and (later) server action also verifies the session itself. Section behavior lives in code configs (added in later phases); this phase only creates the tables they will use.

**Tech Stack:** Next.js 16.2.4, React 19.2.4, TypeScript, Tailwind v4 + shadcn (base-nova), Drizzle ORM 0.45 + drizzle-kit 0.31, `pg`, Neon Postgres, Better Auth 1.7, zod 4, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-10-02-crm-overhaul-design.md` (read it first; this plan implements its "Foundation" build step plus the data model).

**Later phases (own plans, written after this one ships):** 2 contacts, companies and General · 3 activities, tasks and side panel · 4 deals and pipelines · 5 Home, ⌘K, CSV, deploy.

## Global Constraints

Copied from the spec; every task includes these.

- Stack is Neon Postgres (free) + Drizzle ORM + Better Auth. Supabase packages and env vars are removed.
- One owner account, login required, **public sign-up closed** (`disableSignUp: true`). Minimum password length 12.
- Every server component, query and server action checks the session itself; the proxy alone is not enough.
- `user_id text not null` (the Better Auth user id) on every domain table. No database RLS.
- Env vars, never committed: `DATABASE_URL` (pooled), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`; plus `DATABASE_URL_UNPOOLED` for migrations only.
- Neon branches: `dev` for local work, `main` for production. **Tests and migrations in this plan run against `dev` only.**
- No Vercel-specific APIs.
- Dark theme is the default (the old "Obsidian Dossier" palette: brass `#c9a96e` accent), plus a light theme. Layout is responsive: sidebar on desktop, bottom tab bar on phones.
- Priority colors (dark theme): Gone `#4a4946`, Low `#6a9fd8`, Medium `#c9a96e`, High `#e0915a`, Very High `#e07b6a`.
- Next 16: the middleware file is `src/proxy.ts` and exports `proxy`. `AGENTS.md` requires reading `node_modules/next/dist/docs/` before using any Next API not shown in this plan.
- Never print secret values (connection strings, `BETTER_AUTH_SECRET`, passwords) in output, logs or commits.
- Every commit message ends with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

**Facts verified while planning (better-auth 1.7.7, drizzle-orm 0.45.3, Next 16.2.4):**
- `disableSignUp: true` rejects both `POST /api/auth/sign-up/email` and `auth.api.signUpEmail` (`status: "BAD_REQUEST"`). The owner is therefore created through `auth.$context.internalAdapter`, and that user can sign in with `auth.api.signInEmail`.
- `nextCookies()` is harmless when called outside a Next request scope (scripts, tests).
- Adapter import is `better-auth/adapters/drizzle`; password hashing is `ctx.password.hash`.
- Schema CLI: `npx auth@latest generate --config <auth file> --output <schema file> --yes`. Task 2 embeds its exact output.
- lucide-react icon names `House, UtensilsCrossed, Landmark, Users, ListChecks, Settings, LogOut, Sun, Moon, Inbox` exist. zod 4 `z.url()` accepts `postgres://` URLs.

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` | Test config; loads `.env.local`; `@` alias |
| `.env.example` | Names of required env vars (no values) |
| `src/lib/env-schema.ts` / `.test.ts` | Pure env validation (`parseEnv`) |
| `src/lib/env.ts` | Parsed `env` for app code |
| `src/lib/password-policy.ts` | `MIN_PASSWORD_LENGTH` shared by auth and owner creation |
| `src/db/auth-schema.ts` | Better Auth tables (generated output) |
| `src/db/schema.ts` | Domain tables, enums, constraints; re-exports auth tables |
| `src/db/index.ts` | `pg` pool and Drizzle client |
| `drizzle.config.ts`, `drizzle/` | drizzle-kit config and committed migrations |
| `src/lib/auth.ts` | Better Auth server instance |
| `src/lib/auth-client.ts` | Better Auth browser client |
| `src/lib/owner.ts` | `createOwner` (used by seed script and tests) |
| `src/lib/session.ts` | `getSession`, `requireSession` |
| `src/proxy.ts` | Cookie gate in front of every page |
| `src/app/api/auth/[...all]/route.ts` | Better Auth HTTP handler |
| `scripts/seed-owner.ts` | One-time interactive owner creation |
| `src/app/globals.css` | Theme tokens (dark default + light) |
| `src/app/layout.tsx` | Fonts, theme provider, toaster |
| `src/components/theme-provider.tsx`, `theme-toggle.tsx`, `wordmark.tsx` | Theming and brand |
| `src/app/login/page.tsx`, `src/components/login-form.tsx` | Sign-in screen |
| `src/lib/nav.ts` / `.test.ts` | Nav config and `isActivePath` |
| `src/components/{sidebar,bottom-tabs,mobile-header,sign-out-button}.tsx` | App shell |
| `src/components/{page-header,empty-state,stub-page}.tsx` | Page building blocks |
| `src/app/(app)/layout.tsx` and `(app)/{page,restaurants,investors,general,tasks,settings}` | Authenticated shell and stub pages |
| `tests/integration/{schema,auth}.test.ts` | Tests against the Neon `dev` branch |

---

### Task 1: Tooling, dependencies and env validation

**Files:**
- Modify: `package.json`, `package-lock.json`, `.gitignore`
- Create: `vitest.config.ts`, `.env.example`, `src/lib/env-schema.ts`, `src/lib/env-schema.test.ts`, `src/lib/env.ts`

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): Env` and type `Env = { DATABASE_URL: string; BETTER_AUTH_SECRET: string; BETTER_AUTH_URL: string }` (from `@/lib/env-schema`); `env: Env` (from `@/lib/env`); npm scripts `typecheck`, `test`, `test:watch`, `db:generate`, `db:migrate`, `db:studio`, `seed:owner`.

- [ ] **Step 1: Commit the spec and this plan, then branch**

```bash
cd /Users/risus_zhao/personal-crm
git add docs
git commit -m "docs: CRM overhaul design spec and foundation plan" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git switch -c feat/foundation
git status --short
```
Expected: `git status --short` prints nothing.

- [ ] **Step 2: Swap dependencies**

```bash
npm uninstall @supabase/ssr @supabase/supabase-js
npm install drizzle-orm pg better-auth zod
npm install -D drizzle-kit vitest tsx @types/pg @types/node@24
```
Expected: installs finish with no `ERESOLVE` error. `grep -c supabase package.json` prints `0`.

- [ ] **Step 3: Add npm scripts**

```bash
npm pkg set scripts.typecheck="tsc --noEmit" \
  scripts.test="vitest run" \
  scripts.test:watch="vitest" \
  scripts.db:generate="drizzle-kit generate" \
  scripts.db:migrate="drizzle-kit migrate" \
  scripts.db:studio="drizzle-kit studio" \
  scripts.seed:owner="tsx --env-file=.env.local scripts/seed-owner.ts"
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests read DATABASE_URL etc. from .env.local (the Neon dev branch).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Write the failing test `src/lib/env-schema.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env-schema";

const valid = {
  DATABASE_URL:
    "postgres://user:pass@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

describe("parseEnv", () => {
  it("accepts a complete, valid environment", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("rejects an auth secret shorter than 32 characters", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("names every missing variable in one error", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET })).toThrow(
      /DATABASE_URL[\s\S]*BETTER_AUTH_URL/,
    );
  });

  it("rejects a BETTER_AUTH_URL that is not a URL", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_URL: "localhost" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run src/lib/env-schema.test.ts`
Expected: FAIL — cannot find module `./env-schema`.

- [ ] **Step 7: Implement `src/lib/env-schema.ts`**

```ts
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
```

- [ ] **Step 8: Run the test and watch it pass**

Run: `npx vitest run src/lib/env-schema.test.ts`
Expected: 4 passed.

- [ ] **Step 9: Create `src/lib/env.ts`, `.env.example`, and un-ignore the example**

`src/lib/env.ts`:
```ts
import { parseEnv } from "./env-schema";

export const env = parseEnv(process.env);
```

`.env.example`:
```
# Neon POOLED connection string for the branch you are on (dev locally, main in production)
DATABASE_URL=
# Neon DIRECT (unpooled) connection string; used only by drizzle-kit migrations
DATABASE_URL_UNPOOLED=
# Random 32+ character secret: openssl rand -base64 32
BETTER_AUTH_SECRET=
# Public origin of the app
BETTER_AUTH_URL=http://localhost:3000
```

`.gitignore` ignores `.env*`, so allow the example (a later rule wins):
```bash
printf '\n# keep the example env file\n!.env.example\n' >> .gitignore
git check-ignore .env.example || echo "not ignored: ok"
```
Expected: `not ignored: ok`.

- [ ] **Step 10: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0. (If typecheck reports `loadEnvFile` missing, `@types/node@24` did not install; rerun step 2.)

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: swap Supabase for Drizzle/Better Auth tooling; add env validation and Vitest" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Neon database, domain schema and migration

**Files:**
- Create: `src/db/auth-schema.ts`, `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `drizzle/` (generated), `tests/integration/schema.test.ts`
- Modify: `.env.local` (user action; never committed)

**Interfaces:**
- Consumes: `env` from `@/lib/env` (Task 1).
- Produces: `db` and `type Db = typeof db` (`@/db`); tables `user, session, account, verification, companies, contacts, deals, activities, tasks` and enums `sectionEnum, priorityEnum, activityTypeEnum, dealStatusEnum` (`@/db/schema`); constants `SECTIONS, PRIORITIES, ACTIVITY_TYPES, DEAL_STATUSES` and types `Section, Priority, ActivityType, DealStatus`.

- [ ] **Step 1: USER ACTION — create the Neon database (an agent cannot create accounts)**

Ask the owner to do this, then wait for confirmation:
1. Sign in or sign up at https://console.neon.tech and create a project named `personal-crm` (AWS region `us-east-1` pairs well with Vercel's `iad1`).
2. The default branch is `main`: leave it empty. Create a child branch named `dev`.
3. On the `dev` branch open **Connect**. With **Connection pooling ON**, copy the string into `DATABASE_URL`. With it **OFF**, copy the string into `DATABASE_URL_UNPOOLED`.
4. Replace the contents of `.env.local` (delete the old Supabase lines) with:
```
DATABASE_URL=<pooled string>
DATABASE_URL_UNPOOLED=<direct string>
BETTER_AUTH_SECRET=<output of: openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
```
If a connection string ends with `&channel_binding=require` and the `pg` driver later errors on it, delete that fragment.

- [ ] **Step 2: Confirm the variables are set without printing them**

```bash
node --env-file=.env.local -e "for (const k of ['DATABASE_URL','DATABASE_URL_UNPOOLED','BETTER_AUTH_SECRET','BETTER_AUTH_URL']) console.log(k.padEnd(24), process.env[k] ? 'set' : 'MISSING')"
```
Expected: four lines ending in `set`. Stop and ask the owner if any say `MISSING`.

- [ ] **Step 3: Write the failing integration test `tests/integration/schema.test.ts`**

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasDb = Boolean(
  process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL,
);

type Db = typeof import("@/db").db;
type Schema = typeof import("@/db/schema");

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

describe.skipIf(!hasDb)("domain schema (runs against the Neon dev branch)", () => {
  let db: Db;
  let s: Schema;
  const userId = randomUUID();

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    s = await import("@/db/schema");
    await db.insert(s.user).values({
      id: userId,
      name: "Schema Test",
      email: `schema-${userId}@example.test`,
      emailVerified: true,
    });
  });

  afterAll(async () => {
    if (db && s) await db.delete(s.user).where(eq(s.user.id, userId));
  });

  it("stores an angel investor as a contact-only deal with a timeline entry and a task", async () => {
    const [contact] = await db
      .insert(s.contacts)
      .values({
        userId,
        section: "investors",
        name: "Ada Angel",
        priority: "high",
        details: { background: "operator" },
        tags: ["warm-intro"],
      })
      .returning();
    const [deal] = await db
      .insert(s.deals)
      .values({
        userId,
        section: "investors",
        contactId: contact.id,
        title: "Ada Angel",
        stage: "target",
        amountCents: 2_500_000,
        details: { investorType: "angel" },
      })
      .returning();
    const [activity] = await db
      .insert(s.activities)
      .values({ userId, type: "call", summary: "Intro call", contactId: contact.id, dealId: deal.id })
      .returning();
    const [task] = await db
      .insert(s.tasks)
      .values({ userId, title: "Send deck", dueDate: "2026-10-12", dealId: deal.id })
      .returning();

    expect(deal.status).toBe("open");
    expect(deal.amountCents).toBe(2_500_000);
    expect(contact.tags).toEqual(["warm-intro"]);
    expect(activity.occurredAt).toBeInstanceOf(Date);
    expect(task.doneAt).toBeNull();
  });

  it("stores a restaurant as a company plus a deal", async () => {
    const [company] = await db
      .insert(s.companies)
      .values({ userId, section: "restaurants", name: "Trattoria Test", city: "Chicago" })
      .returning();
    const [deal] = await db
      .insert(s.deals)
      .values({ userId, section: "restaurants", companyId: company.id, title: "Trattoria Test", stage: "lead" })
      .returning();
    expect(deal.companyId).toBe(company.id);
    expect(deal.details).toEqual({});
  });

  it("rejects a deal that has neither a company nor a contact", async () => {
    await expect(
      db.insert(s.deals).values({ userId, section: "investors", title: "Nobody", stage: "target" }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23514");
  });

  it("rejects a deal in the general section", async () => {
    const [contact] = await db
      .insert(s.contacts)
      .values({ userId, section: "general", name: "Friend" })
      .returning();
    await expect(
      db.insert(s.deals).values({
        userId,
        section: "general",
        contactId: contact.id,
        title: "Not allowed",
        stage: "x",
      }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23514");
  });

  it("rejects an activity attached to neither a contact nor a company", async () => {
    await expect(
      db.insert(s.activities).values({ userId, type: "note", summary: "Orphan" }),
    ).rejects.toSatisfy((e) => pgCode(e) === "23514");
  });

  it("deletes a contact's activities with it", async () => {
    const [contact] = await db
      .insert(s.contacts)
      .values({ userId, section: "general", name: "Short Lived" })
      .returning();
    await db.insert(s.activities).values({ userId, type: "call", summary: "Hello", contactId: contact.id });
    await db.delete(s.contacts).where(eq(s.contacts.id, contact.id));
    const left = await db.select().from(s.activities).where(eq(s.activities.contactId, contact.id));
    expect(left).toHaveLength(0);
  });

  it("refuses to delete a company that still has deals", async () => {
    const [company] = await db
      .insert(s.companies)
      .values({ userId, section: "investors", name: "Fund I" })
      .returning();
    await db.insert(s.deals).values({
      userId,
      section: "investors",
      companyId: company.id,
      title: "Fund I",
      stage: "target",
      details: { investorType: "institution" },
    });
    await expect(
      db.delete(s.companies).where(eq(s.companies.id, company.id)),
    ).rejects.toSatisfy((e) => pgCode(e) === "23503");
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: FAIL — cannot resolve `@/db` (module does not exist yet).

- [ ] **Step 5: Create `src/db/auth-schema.ts`** (verbatim output of `npx auth@latest generate` for better-auth 1.7.7; re-run the CLI after a Better Auth upgrade to check for drift)

```ts
import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
```

- [ ] **Step 6: Create `src/db/schema.ts`** (domain tables; relative imports because drizzle-kit loads this file without the `@` alias)

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

export const SECTIONS = ["restaurants", "investors", "general"] as const;
export const PRIORITIES = ["very_high", "high", "medium", "low", "gone"] as const;
export const ACTIVITY_TYPES = ["call", "email", "meeting", "tasting", "note", "other"] as const;
export const DEAL_STATUSES = ["open", "won", "lost"] as const;

export type Section = (typeof SECTIONS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const sectionEnum = pgEnum("section", SECTIONS);
export const priorityEnum = pgEnum("priority", PRIORITIES);
export const activityTypeEnum = pgEnum("activity_type", ACTIVITY_TYPES);
export const dealStatusEnum = pgEnum("deal_status", DEAL_STATUSES);

const pk = () => uuid("id").primaryKey().defaultRandom();
const ownerId = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const tagsColumn = () =>
  text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);
const detailsColumn = () => jsonb("details").$type<Record<string, unknown>>().notNull().default({});

export const companies = pgTable(
  "companies",
  {
    id: pk(),
    userId: ownerId(),
    section: sectionEnum("section").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    city: text("city"),
    notes: text("notes"),
    details: detailsColumn(),
    tags: tagsColumn(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("companies_user_section_idx").on(t.userId, t.section)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: pk(),
    userId: ownerId(),
    section: sectionEnum("section").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),
    notes: text("notes"),
    // null = no follow-up reminders; "gone" = explicitly no longer in touch
    priority: priorityEnum("priority"),
    details: detailsColumn(),
    tags: tagsColumn(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_user_section_idx").on(t.userId, t.section),
    index("contacts_company_idx").on(t.companyId),
  ],
);

// Deals reference companies/contacts with NO ACTION (the default): deleting a party that
// still has deals is refused, and delete flows remove that party's deals first.
export const deals = pgTable(
  "deals",
  {
    id: pk(),
    userId: ownerId(),
    section: sectionEnum("section").notNull(),
    companyId: uuid("company_id").references(() => companies.id),
    contactId: uuid("contact_id").references(() => contacts.id),
    title: text("title").notNull(),
    stage: text("stage").notNull(),
    status: dealStatusEnum("status").notNull().default("open"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    nextStep: text("next_step"),
    nextStepDate: date("next_step_date", { mode: "string" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    sortKey: doublePrecision("sort_key").notNull().default(0),
    details: detailsColumn(),
    tags: tagsColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deals_user_section_status_stage_idx").on(t.userId, t.section, t.status, t.stage),
    check("deals_party_check", sql`${t.companyId} is not null or ${t.contactId} is not null`),
    check("deals_section_check", sql`${t.section} <> 'general'`),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: pk(),
    userId: ownerId(),
    type: activityTypeEnum("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    summary: text("summary").notNull(),
    body: text("body"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("activities_contact_idx").on(t.contactId, t.occurredAt.desc()),
    index("activities_company_idx").on(t.companyId, t.occurredAt.desc()),
    index("activities_deal_idx").on(t.dealId),
    check("activities_party_check", sql`${t.contactId} is not null or ${t.companyId} is not null`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: pk(),
    userId: ownerId(),
    title: text("title").notNull(),
    dueDate: date("due_date", { mode: "string" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_user_due_open_idx").on(t.userId, t.dueDate).where(sql`${t.doneAt} is null`)],
);
```

- [ ] **Step 7: Create `src/db/index.ts`**

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000, // allows for Neon waking from idle
  });

if (process.env.NODE_ENV !== "production") globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
```

- [ ] **Step 8: Create `drizzle.config.ts`** (migrations use the direct connection)

```ts
import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in .env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
```

- [ ] **Step 9: Run the test again and watch it fail for the right reason**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: FAIL — error mentions `relation "user" does not exist` (the tables are not migrated yet).

- [ ] **Step 10: Generate the migration and read it**

```bash
npm run db:generate -- --name init
```
Expected: creates `drizzle/0000_init.sql`. Open it and confirm it contains `CREATE TYPE` for the four enums, `CREATE TABLE` for all nine tables, `deals_party_check`, `deals_section_check`, `activities_party_check`, and `tasks_user_due_open_idx ... WHERE "tasks"."done_at" is null`.

- [ ] **Step 11: Apply it to the Neon `dev` branch**

```bash
npm run db:migrate
```
Expected: ends with a success message and no error. (If it hangs for several seconds the Neon database is waking up; wait.)

- [ ] **Step 12: Run the tests and watch them pass**

Run: `npx vitest run tests/integration/schema.test.ts`
Expected: 7 passed.

- [ ] **Step 13: Confirm schema and migration agree (no drift)**

Run: `npm run db:generate`
Expected: output says there are no schema changes and creates no new file. (`git status --short drizzle` shows only the files from step 10.)

- [ ] **Step 14: Lint, typecheck, commit**

```bash
npm run lint && npm run typecheck
git add -A
git commit -m "feat(db): Neon client, Better Auth tables and CRM domain schema with first migration" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: `git status --short` prints nothing afterwards (`.env.local` stays ignored).

---

### Task 3: Better Auth server, owner seeding, session helpers and proxy

**Files:**
- Create: `src/lib/password-policy.ts`, `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/owner.ts`, `src/lib/session.ts`, `src/proxy.ts`, `src/app/api/auth/[...all]/route.ts`, `scripts/seed-owner.ts`, `tests/integration/auth.test.ts`

**Interfaces:**
- Consumes: `db` (`@/db`), `user` and the auth tables (`@/db/schema`), `env` (`@/lib/env`).
- Produces: `MIN_PASSWORD_LENGTH = 12`; `auth` (Better Auth instance); `createOwner(input: { email: string; name: string; password: string }): Promise<{ id: string; email: string; name: string }>`; `authClient` (browser); `getSession()` and `requireSession()` returning `{ session, user }` (`requireSession` redirects to `/login` when absent); `proxy(request: NextRequest)`.

- [ ] **Step 1: Write the failing integration test `tests/integration/auth.test.ts`**

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const hasEnv = Boolean(
  process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL,
);

describe.skipIf(!hasEnv)("owner auth (runs against the Neon dev branch)", () => {
  type Mods = {
    auth: typeof import("@/lib/auth").auth;
    createOwner: typeof import("@/lib/owner").createOwner;
    db: typeof import("@/db").db;
    user: typeof import("@/db/schema").user;
  };
  let m: Mods;
  const tag = randomUUID();
  const email = `owner-${tag}@example.test`;
  const intruder = `intruder-${tag}@example.test`;
  const password = `pw-${tag}`; // longer than 12 characters

  beforeAll(async () => {
    m = {
      auth: (await import("@/lib/auth")).auth,
      createOwner: (await import("@/lib/owner")).createOwner,
      db: (await import("@/db")).db,
      user: (await import("@/db/schema")).user,
    };
    await m.createOwner({ email, name: "Test Owner", password });
  });

  afterAll(async () => {
    if (!m) return;
    await m.db.delete(m.user).where(eq(m.user.email, email));
    await m.db.delete(m.user).where(eq(m.user.email, intruder));
  });

  it("lets the seeded owner sign in with email and password", async () => {
    const result = await m.auth.api.signInEmail({ body: { email, password } });
    expect(result.user.email).toBe(email);
  });

  it("rejects a wrong password", async () => {
    await expect(
      m.auth.api.signInEmail({ body: { email, password: "definitely-wrong-password" } }),
    ).rejects.toMatchObject({ status: "UNAUTHORIZED" });
  });

  it("refuses public sign-up and creates no user", async () => {
    await expect(
      m.auth.api.signUpEmail({
        body: { name: "Intruder", email: intruder, password: "intruder-password-123" },
      }),
    ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    const rows = await m.db.select().from(m.user).where(eq(m.user.email, intruder));
    expect(rows).toHaveLength(0);
  });

  it("createOwner rejects a password shorter than 12 characters", async () => {
    await expect(
      m.createOwner({ email: `short-${tag}@example.test`, name: "Short", password: "short" }),
    ).rejects.toThrow(/at least 12/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: FAIL — cannot resolve `@/lib/auth`.

- [ ] **Step 3: Create `src/lib/password-policy.ts`**

```ts
export const MIN_PASSWORD_LENGTH = 12;
```

- [ ] **Step 4: Create `src/lib/auth.ts`**

```ts
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
```

- [ ] **Step 5: Create `src/lib/owner.ts`**

```ts
import { auth } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

export type OwnerInput = { email: string; name: string; password: string };

// Sign-up is disabled for the public API, so the owner is created through Better Auth's
// internal adapter, which writes the same rows a normal sign-up would.
export async function createOwner({ email, name, password }: OwnerInput) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@")) throw new Error("Enter a valid email address.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);
  const created = await ctx.internalAdapter.createUser({
    email: normalizedEmail,
    name,
    emailVerified: true,
  });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: passwordHash,
  });
  return created;
}
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `npx vitest run tests/integration/auth.test.ts`
Expected: 4 passed. (A Better Auth `WARN ... Invalid password` log line is normal for the wrong-password case.)

- [ ] **Step 7: Create the HTTP handler, client and session helpers**

`src/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

`src/lib/auth-client.ts`:
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

`src/lib/session.ts`:
```ts
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

// Call this at the top of every server component, query and server action that needs a user.
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
```

- [ ] **Step 8: Create `src/proxy.ts`** (cheap cookie gate; real checks happen in `requireSession`)

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)",
  ],
};
```

- [ ] **Step 9: Create `scripts/seed-owner.ts`** (interactive so the password never lands in shell history or chat)

```ts
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
```

- [ ] **Step 10: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: both exit 0.

- [ ] **Step 11: Check the proxy and auth route on a real server**

Start the dev server in the background (leave it running): `npm run dev`. Wait until it prints the local URL (must be port 3000, matching `BETTER_AUTH_URL`; stop whatever else holds the port if not). Then:

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3000/
curl -s http://localhost:3000/api/auth/ok
curl -s -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "content-type: application/json" -H "origin: http://localhost:3000" \
  -d '{"name":"x","email":"x@example.test","password":"some-long-password"}'
```
Expected, in order: `307 -> http://localhost:3000/login`; `{"ok":true}`; a JSON body containing `EMAIL_PASSWORD_SIGN_UP_DISABLED`. Stop the dev server.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(auth): Better Auth single-owner login, seed script, session helpers and proxy gate" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Theme, root layout and login screen

**Files:**
- Replace: `src/app/globals.css`, `src/app/layout.tsx`
- Create: `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx`, `src/components/wordmark.tsx`, `src/components/login-form.tsx`, `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `authClient` (`@/lib/auth-client`), `getSession` (`@/lib/session`), shadcn `Button`, `Card`, `Input`, `Label`, `Toaster`.
- Produces: CSS tokens usable as Tailwind colors: `bg-section-restaurants|investors|general`, `text-prio-gone|low|medium|high|very-high` (and the `var(--section-*)` / `var(--prio-*)` forms); `ThemeProvider`, `ThemeToggle`, `Wordmark({ className? })`, `LoginForm`.

- [ ] **Step 1: Replace `src/app/globals.css`**

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-serif: var(--font-instrument-serif);
  --font-heading: var(--font-sans);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-prio-gone: var(--prio-gone);
  --color-prio-low: var(--prio-low);
  --color-prio-medium: var(--prio-medium);
  --color-prio-high: var(--prio-high);
  --color-prio-very-high: var(--prio-very-high);
  --color-section-restaurants: var(--section-restaurants);
  --color-section-investors: var(--section-investors);
  --color-section-general: var(--section-general);

  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
  --radius-2xl: calc(var(--radius) * 1.8);
}

/* Light theme: warm paper, darker brass for contrast */
:root {
  --radius: 0.5rem;
  --background: #f7f4ee;
  --foreground: #1b1a17;
  --card: #fffdf9;
  --card-foreground: #1b1a17;
  --popover: #fffdf9;
  --popover-foreground: #1b1a17;
  --primary: #8f6b2a;
  --primary-foreground: #fffdf9;
  --secondary: #ece7dc;
  --secondary-foreground: #1b1a17;
  --muted: #ece7dc;
  --muted-foreground: #6b6558;
  --accent: #efe9dc;
  --accent-foreground: #1b1a17;
  --destructive: #b3372a;
  --border: #ddd6c7;
  --input: #d8d0bf;
  --ring: #8f6b2a80;

  --prio-gone: #8a867d;
  --prio-low: #3f78b8;
  --prio-medium: #9a7a2e;
  --prio-high: #c4691f;
  --prio-very-high: #c2483a;

  --section-restaurants: #c4691f;
  --section-investors: #3f78b8;
  --section-general: #8f6b2a;
}

/* Dark theme (default): the "Obsidian Dossier" palette */
.dark {
  --background: #0a0a09;
  --foreground: #e2ddd5;
  --card: #111110;
  --card-foreground: #e2ddd5;
  --popover: #151514;
  --popover-foreground: #e2ddd5;
  --primary: #c9a96e;
  --primary-foreground: #0c0c0b;
  --secondary: #1a1916;
  --secondary-foreground: #e2ddd5;
  --muted: #1a1916;
  --muted-foreground: #8b867d;
  --accent: #1e1d1a;
  --accent-foreground: #e2ddd5;
  --destructive: #e0614f;
  --border: #262522;
  --input: #2a2926;
  --ring: #c9a96e66;

  --prio-gone: #4a4946;
  --prio-low: #6a9fd8;
  --prio-medium: #c9a96e;
  --prio-high: #e0915a;
  --prio-very-high: #e07b6a;

  --section-restaurants: #e0915a;
  --section-investors: #6a9fd8;
  --section-general: #c9a96e;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html {
    @apply font-sans antialiased;
  }
  body {
    @apply bg-background text-foreground;
  }
  ::selection {
    background: color-mix(in oklab, var(--primary) 30%, transparent);
  }
}
```

- [ ] **Step 2: Replace `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: { default: "Personal CRM", template: "%s · Personal CRM" },
  description: "Contacts, restaurants and investors in one place.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full`}
    >
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create the theme and brand components**

`src/components/theme-provider.tsx`:
```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

`src/components/theme-toggle.tsx`:
```tsx
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle light and dark theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}
```

`src/components/wordmark.tsx`:
```tsx
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-serif text-xl leading-none tracking-tight", className)}>
      Personal <em className="text-primary">CRM</em>
    </span>
  );
}
```

- [ ] **Step 4: Create the login form `src/components/login-form.tsx`**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/wordmark";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    if (signInError) {
      setError(signInError.message ?? "Could not sign in. Try again.");
      setPending(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="gap-3">
        <h1>
          <Wordmark className="text-3xl" />
        </h1>
        <CardDescription>Sign in to your CRM.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required className="h-10" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-10"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="h-10 w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Create the login page `src/app/login/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSession } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="relative grid min-h-dvh place-items-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <LoginForm />
    </main>
  );
}
```

- [ ] **Step 6: Lint, typecheck and build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all exit 0; the build output lists `/login` and `/api/auth/[...all]`.

- [ ] **Step 7: Check the screen on a real server**

Start `npm run dev` in the background, then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login
curl -s http://localhost:3000/login | grep -c "Sign in"
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:3000/
```
Expected: `200`; a count of `1` or more; `307 -> http://localhost:3000/login`. Leave the server running for the next step.

- [ ] **Step 8: USER ACTION — create the owner and try the form**

Ask the owner to run `npm run seed:owner` in their own terminal and enter their email, name and a password (12+ characters). An agent must not choose or see the password. Then ask them to open http://localhost:3000/login and confirm:
1. A wrong password shows "Invalid email or password" in red.
2. The theme button (top right) switches between dark and light, and both look intentional.
3. The correct password navigates away from `/login` (the next page is a 404 until Task 5; that is expected).

Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ui): dark/light theme, root layout and login screen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: App shell with navigation and stub pages

**Files:**
- Create: `src/lib/nav.ts`, `src/lib/nav.test.ts`, `src/components/sign-out-button.tsx`, `src/components/sidebar.tsx`, `src/components/bottom-tabs.tsx`, `src/components/mobile-header.tsx`, `src/components/page-header.tsx`, `src/components/empty-state.tsx`, `src/components/stub-page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/restaurants/page.tsx`, `src/app/(app)/investors/page.tsx`, `src/app/(app)/general/page.tsx`, `src/app/(app)/tasks/page.tsx`, `src/app/(app)/settings/page.tsx`

**Interfaces:**
- Consumes: `requireSession` (`@/lib/session`), `authClient`, `ThemeToggle`, `Wordmark`, `buttonVariants` and `Button` (`@/components/ui/button`).
- Produces: `type NavItem = { href: string; label: string; icon: LucideIcon; accent?: "restaurants" | "investors" | "general" }`; `PRIMARY_NAV`, `SECONDARY_NAV: NavItem[]`; `isActivePath(pathname: string, href: string): boolean`; `PageHeader({ title, description?, accent?, actions? })`; `EmptyState({ icon, title, children? })`; `StubPage({ title, description, accent?, icon, phase })`. Later phases replace the stub pages and keep the shell.

- [ ] **Step 1: Write the failing test `src/lib/nav.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath } from "./nav";

describe("isActivePath", () => {
  it("matches Home only on the exact root path", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/tasks", "/")).toBe(false);
  });

  it("matches a section on its own path and on nested paths", () => {
    expect(isActivePath("/restaurants", "/restaurants")).toBe(true);
    expect(isActivePath("/restaurants/abc", "/restaurants")).toBe(true);
  });

  it("does not match a different path that merely starts with the same letters", () => {
    expect(isActivePath("/restaurants-old", "/restaurants")).toBe(false);
    expect(isActivePath("/investors", "/restaurants")).toBe(false);
  });
});

describe("nav config", () => {
  it("has unique, absolute hrefs", () => {
    const hrefs = [...PRIMARY_NAV, ...SECONDARY_NAV].map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every((href) => href.startsWith("/"))).toBe(true);
  });

  it("keeps exactly five primary items so the phone tab bar fits", () => {
    expect(PRIMARY_NAV).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/nav.test.ts`
Expected: FAIL — cannot find module `./nav`.

- [ ] **Step 3: Implement `src/lib/nav.ts`**

```ts
import {
  House,
  Landmark,
  ListChecks,
  Settings,
  UtensilsCrossed,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  accent?: "restaurants" | "investors" | "general";
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/restaurants", label: "Restaurants", icon: UtensilsCrossed, accent: "restaurants" },
  { href: "/investors", label: "Investors", icon: Landmark, accent: "investors" },
  { href: "/general", label: "General", icon: Users, accent: "general" },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
];

export const SECONDARY_NAV: NavItem[] = [{ href: "/settings", label: "Settings", icon: Settings }];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/lib/nav.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Create the sign-out button `src/components/sign-out-button.tsx`**

```tsx
"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
      <LogOut />
    </Button>
  );
}
```

- [ ] **Step 6: Create the sidebar `src/components/sidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      <Icon
        className="size-4 shrink-0"
        style={item.accent && active ? { color: `var(--section-${item.accent})` } : undefined}
      />
      {item.label}
    </Link>
  );
}

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="px-6 pb-4 pt-7">
        <Wordmark />
      </div>
      <nav aria-label="Main" className="flex-1 space-y-1 px-3 py-2">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="space-y-2 border-t border-border p-3">
        {SECONDARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="min-w-0 truncate px-2 text-xs text-muted-foreground" title={email}>
            {email}
          </p>
          <div className="flex shrink-0">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 7: Create the phone navigation `src/components/bottom-tabs.tsx` and `src/components/mobile-header.tsx`**

`bottom-tabs.tsx`:
```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, isActivePath } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY_NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground",
                  active && "text-foreground",
                )}
              >
                <Icon
                  className="size-5"
                  style={item.accent && active ? { color: `var(--section-${item.accent})` } : undefined}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
```

`mobile-header.tsx`:
```tsx
import Link from "next/link";
import { Settings } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
      <Wordmark />
      <div className="flex items-center">
        <Link
          href="/settings"
          aria-label="Settings"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
        >
          <Settings />
        </Link>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}
```

- [ ] **Step 8: Create the page building blocks**

`src/components/page-header.tsx`:
```tsx
type PageHeaderProps = {
  title: string;
  description?: string;
  accent?: "restaurants" | "investors" | "general";
  actions?: React.ReactNode;
};

export function PageHeader({ title, description, accent, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-3 font-serif text-3xl tracking-tight md:text-4xl">
          {accent ? (
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: `var(--section-${accent})` }}
            />
          ) : null}
          {title}
        </h1>
        {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}
```

`src/components/empty-state.tsx`:
```tsx
import type { LucideIcon } from "lucide-react";

type EmptyStateProps = { icon: LucideIcon; title: string; children?: React.ReactNode };

export function EmptyState({ icon: Icon, title, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
      <Icon className="mb-4 size-8 text-muted-foreground" aria-hidden />
      <h2 className="font-medium">{title}</h2>
      {children ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}
```

`src/components/stub-page.tsx` (honest placeholder for a page a later phase will build):
```tsx
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/session";

type StubPageProps = {
  title: string;
  description: string;
  accent?: "restaurants" | "investors" | "general";
  icon: LucideIcon;
  phase: string;
};

export async function StubPage({ title, description, accent, icon, phase }: StubPageProps) {
  await requireSession();
  return (
    <>
      <PageHeader title={title} description={description} accent={accent} />
      <EmptyState icon={icon} title="Not built yet">
        {phase}
      </EmptyState>
    </>
  );
}
```

- [ ] **Step 9: Create the authenticated layout `src/app/(app)/layout.tsx`**

```tsx
import { BottomTabs } from "@/components/bottom-tabs";
import { MobileHeader } from "@/components/mobile-header";
import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-dvh md:flex">
      <Sidebar email={session.user.email} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="flex-1 px-4 pb-24 pt-6 md:px-10 md:pb-10 md:pt-10">{children}</main>
      </div>
      <BottomTabs />
    </div>
  );
}
```

- [ ] **Step 10: Create the six stub pages**

`src/app/(app)/page.tsx`:
```tsx
import { Inbox } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Home" };

export default function HomePage() {
  return (
    <StubPage
      title="Home"
      description="What to do today: tasks, follow-ups and your pipelines."
      icon={Inbox}
      phase="The dashboard arrives in build phase 5."
    />
  );
}
```

`src/app/(app)/restaurants/page.tsx`:
```tsx
import { UtensilsCrossed } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Restaurants" };

export default function RestaurantsPage() {
  return (
    <StubPage
      title="Restaurants"
      accent="restaurants"
      description="Restaurant accounts and their sales pipeline."
      icon={UtensilsCrossed}
      phase="Records arrive in build phase 2 and the pipeline in phase 4."
    />
  );
}
```

`src/app/(app)/investors/page.tsx`:
```tsx
import { Landmark } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Investors" };

export default function InvestorsPage() {
  return (
    <StubPage
      title="Investors"
      accent="investors"
      description="Angels and institutions in your fundraising pipeline."
      icon={Landmark}
      phase="Records arrive in build phase 2 and the pipeline in phase 4."
    />
  );
}
```

`src/app/(app)/general/page.tsx`:
```tsx
import { Users } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "General" };

export default function GeneralPage() {
  return (
    <StubPage
      title="General"
      accent="general"
      description="Friends, family and professional contacts, and who to reach out to next."
      icon={Users}
      phase="Contacts and follow-up reminders arrive in build phase 2."
    />
  );
}
```

`src/app/(app)/tasks/page.tsx`:
```tsx
import { ListChecks } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Tasks" };

export default function TasksPage() {
  return (
    <StubPage
      title="Tasks"
      description="Everything you owe someone, across all sections."
      icon={ListChecks}
      phase="Tasks arrive in build phase 3."
    />
  );
}
```

`src/app/(app)/settings/page.tsx`:
```tsx
import { Settings } from "lucide-react";
import { StubPage } from "@/components/stub-page";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <StubPage
      title="Settings"
      description="CSV import and export, tags and pipeline stages."
      icon={Settings}
      phase="Settings arrive in build phase 5."
    />
  );
}
```

- [ ] **Step 11: Lint, typecheck, test and build**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all exit 0; the build lists `/`, `/restaurants`, `/investors`, `/general`, `/tasks`, `/settings`, `/login`.

- [ ] **Step 12: USER ACTION — walk through the shell**

Start `npm run dev` and ask the owner to open http://localhost:3000 and check:
1. Logged out, `/` redirects to `/login`; after signing in, Home appears with the sidebar.
2. Each sidebar link opens its page; the active link is highlighted, and Restaurants, Investors and General show their accent dot.
3. The theme button works in the shell and the choice survives a reload.
4. Narrow the browser to phone width (or use device emulation): the sidebar disappears, a header with Settings, theme and sign-out appears at the top, and the five-tab bar sits at the bottom without covering page content.
5. Sign out returns to `/login`, and `/restaurants` while signed out redirects there too.

Stop the dev server.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(ui): responsive app shell with navigation and stub pages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: README and final verification

**Files:**
- Replace: `README.md`

- [ ] **Step 1: Replace `README.md`**

````markdown
# Personal CRM

A single-owner CRM for three areas of your life: **Restaurants** (accounts you sell to), **Investors** (angels and institutions in a fundraising pipeline) and **General** (friends, family and professional contacts you want to stay in touch with).

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 + shadcn/ui · Neon Postgres · Drizzle ORM · Better Auth · Vitest

## Setup

1. Create a Neon project with two branches: `main` (production) and `dev` (local).
2. Copy `.env.example` to `.env.local` and fill in the `dev` branch's pooled and direct connection strings, a `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL`.
3. Install, migrate, create the owner, run:

```bash
npm install
npm run db:migrate
npm run seed:owner   # interactive: email and password for the one owner account
npm run dev
```

Public sign-up is closed; the seed script is the only way to create the owner.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm test` | Unit tests, plus integration tests against the Neon `dev` branch when `.env.local` is present |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the branch in `DATABASE_URL_UNPOOLED` |

## Design

See `docs/superpowers/specs/2026-10-02-crm-overhaul-design.md`. Build plans live in `docs/superpowers/plans/`.
````

- [ ] **Step 2: Run the full verification**

```bash
npm run lint && npm run typecheck && npm test && npm run build
git status --short
```
Expected: every command exits 0; tests report the env, nav, schema and auth suites all passing (no skipped integration suites when `.env.local` is present); `git status --short` shows only `README.md`.

- [ ] **Step 3: Confirm no secrets or leftovers are tracked**

```bash
git ls-files | grep -E "^\.env" ; echo "---"
git grep -n -i supabase -- . ':!docs' ':!package-lock.json' || echo "no supabase references"
```
Expected: the first command prints only `.env.example`; the second prints `no supabase references`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: README for the Neon/Drizzle/Better Auth stack" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git log --oneline | head -8
```
Expected: the log shows this branch's six commits on top of the docs commit.

- [ ] **Step 5: Hand off**

Use superpowers:finishing-a-development-branch to decide how `feat/foundation` is merged. The next deliverable is the Phase 2 plan (contacts, companies and the General section), written against the real code this phase produces.
