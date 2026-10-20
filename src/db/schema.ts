import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
// To reach out / Know them / Ghosted / On hold / Dismissed (src/lib/relationships.ts).
const relationshipColumn = () => text("relationship").notNull().default("known");
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
    relationship: relationshipColumn(),
    relationshipAt: timestamp("relationship_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_user_section_idx").on(t.userId, t.section),
    index("contacts_company_idx").on(t.companyId),
    index("contacts_user_relationship_idx").on(t.userId, t.section, t.relationship),
    check("contacts_relationship_check", sql`${t.relationship} in ('to_reach_out', 'known', 'ghosted', 'on_hold', 'dismissed')`),
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
    relationship: relationshipColumn(),
    relationshipAt: timestamp("relationship_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deals_user_section_status_stage_idx").on(t.userId, t.section, t.status, t.stage),
    index("deals_user_relationship_idx").on(t.userId, t.section, t.relationship),
    check("deals_relationship_check", sql`${t.relationship} in ('to_reach_out', 'known', 'ghosted', 'on_hold', 'dismissed')`),
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

// --- Radar: research findings, outreach drafts and the owner's network -----------------------
// Written by the weekly routines through the rr_* SQL functions (drizzle/0003_radar_functions.sql).

export const radarItems = pgTable(
  "radar_items",
  {
    id: pk(),
    userId: ownerId(),
    feed: text("feed").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    source: text("source"),
    summary: text("summary").notNull().default(""),
    whyRelevant: text("why_relevant").notNull().default(""),
    score: integer("score").notNull().default(50),
    tags: tagsColumn(),
    details: detailsColumn(),
    eventDate: date("event_date", { mode: "string" }),
    deadline: date("deadline", { mode: "string" }),
    location: text("location"),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("new"),
    notes: text("notes").notNull().default(""),
    taskId: text("task_id"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    digestedAt: timestamp("digested_at", { withTimezone: true }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("radar_items_user_dedupe_idx").on(t.userId, t.dedupeKey),
    index("radar_items_user_feed_status_idx").on(t.userId, t.feed, t.status),
    index("radar_items_contact_idx").on(t.contactId),
    index("radar_items_deal_idx").on(t.dealId),
    check("radar_items_feed_check", sql`${t.feed} in ('sooz', 'personal', 'career')`),
    // People are 'approved' (in the CRM); opportunities are new/seen/saved (To apply), applied, on_hold or dismissed.
    check("radar_items_status_check", sql`${t.status} in ('new', 'seen', 'saved', 'dismissed', 'approved', 'applied', 'on_hold')`),
    check("radar_items_score_check", sql`${t.score} between 0 and 100`),
  ],
);

export const radarRuns = pgTable(
  "radar_runs",
  {
    id: pk(),
    userId: ownerId(),
    taskId: text("task_id").notNull(),
    feed: text("feed").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    found: integer("found").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("radar_runs_user_started_idx").on(t.userId, t.startedAt.desc())],
);

export const outreach = pgTable(
  "outreach",
  {
    id: pk(),
    userId: ownerId(),
    radarItemId: uuid("radar_item_id")
      .notNull()
      .references(() => radarItems.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull().default("invest"),
    stage: text("stage").notNull().default("prospect"),
    email: text("email"),
    emailSource: text("email_source"),
    linkedinUrl: text("linkedin_url"),
    warmPath: text("warm_path"),
    subject: text("subject"),
    body: text("body"),
    linkedinNote: text("linkedin_note"),
    introRequest: text("intro_request"),
    followup1: text("followup_1"),
    followup2: text("followup_2"),
    draftedBy: text("drafted_by"),
    draftedAt: timestamp("drafted_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastTouchAt: timestamp("last_touch_at", { withTimezone: true }),
    nextFollowupAt: date("next_followup_at", { mode: "string" }),
    touches: integer("touches").notNull().default(0),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    // The owner approved this person's drafts going to Gmail Drafts (set by approving the weekly shortlist).
    gmailOk: boolean("gmail_ok").notNull().default(false),
    // Set by Try again: sends and replies dated before it belong to the earlier attempt.
    retryAt: timestamp("retry_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("outreach_radar_item_idx").on(t.radarItemId),
    index("outreach_user_stage_idx").on(t.userId, t.stage),
    index("outreach_contact_idx").on(t.contactId),
    index("outreach_deal_idx").on(t.dealId),
    check("outreach_purpose_check", sql`${t.purpose} in ('invest', 'ambassador', 'buyer', 'press', 'intro')`),
    check("outreach_stage_check", sql`${t.stage} in ('prospect', 'drafted', 'sent', 'replied', 'closed')`),
  ],
);

// The owner's LinkedIn connections, for warm-intro matching.
export const network = pgTable(
  "network",
  {
    id: pk(),
    userId: ownerId(),
    fullName: text("full_name").notNull(),
    company: text("company"),
    position: text("position"),
    linkedinUrl: text("linkedin_url"),
    email: text("email"),
    connectedOn: date("connected_on", { mode: "string" }),
    source: text("source").notNull().default("linkedin"),
    companyKey: text("company_key"),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("network_user_dedupe_idx").on(t.userId, t.dedupeKey),
    index("network_user_company_key_idx").on(t.userId, t.companyKey),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    userId: ownerId(),
    key: text("key").notNull(),
    value: text("value").notNull().default(""),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

// --- Raise mode: weekly shortlist and the individual messages pushed to Gmail Drafts ---------------

export const shortlist = pgTable(
  "shortlist",
  {
    id: pk(),
    userId: ownerId(),
    week: date("week", { mode: "string" }).notNull(),
    radarItemId: uuid("radar_item_id")
      .notNull()
      .references(() => radarItems.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    rank: integer("rank").notNull().default(0),
    reason: text("reason").notNull().default(""),
    ask: text("ask").notNull().default(""),
    status: text("status").notNull().default("proposed"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shortlist_user_week_item_idx").on(t.userId, t.week, t.radarItemId),
    index("shortlist_item_idx").on(t.radarItemId),
    check("shortlist_bucket_check", sql`${t.bucket} in ('investor', 'buyer')`),
    check("shortlist_status_check", sql`${t.status} in ('proposed', 'approved', 'skipped')`),
  ],
);

export const outreachMessages = pgTable(
  "outreach_messages",
  {
    id: pk(),
    userId: ownerId(),
    outreachId: uuid("outreach_id")
      .notNull()
      .references(() => outreach.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    period: text("period").notNull().default(""),
    subject: text("subject"),
    body: text("body"),
    status: text("status").notNull().default("ready"),
    gmailDraftId: text("gmail_draft_id"),
    gmailThreadId: text("gmail_thread_id"),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("outreach_messages_unique_idx").on(t.outreachId, t.kind, t.period),
    index("outreach_messages_user_status_idx").on(t.userId, t.status),
    check("outreach_messages_kind_check", sql`${t.kind} in ('first', 'followup_1', 'followup_2', 'update', 'launch_ask', 'launch_followup')`),
    check("outreach_messages_status_check", sql`${t.status} in ('ready', 'in_gmail', 'sent', 'replied', 'skipped')`),
  ],
);
