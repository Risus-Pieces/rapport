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
