import { z } from "zod";
import type { DealStatus } from "@/db/schema";

export type PipelineSection = "restaurants" | "investors";
export type StageOutcome = DealStatus; // "open" | "won" | "lost"
export type Stage = { key: string; label: string; outcome: StageOutcome };

// Stage lists are code, not data (editable stage lists are out of scope for v1).
export const PIPELINES: Record<PipelineSection, { label: string; noun: string; stages: Stage[] }> = {
  restaurants: {
    label: "Restaurants",
    noun: "restaurant",
    stages: [
      { key: "lead", label: "Lead", outcome: "open" },
      { key: "contacted", label: "Contacted", outcome: "open" },
      { key: "tasting", label: "Tasting", outcome: "open" },
      { key: "negotiating", label: "Negotiating", outcome: "open" },
      { key: "active", label: "Active", outcome: "won" },
      { key: "lost", label: "Lost", outcome: "lost" },
    ],
  },
  investors: {
    label: "Investors",
    noun: "investor",
    stages: [
      { key: "target", label: "Target", outcome: "open" },
      { key: "intro", label: "Intro", outcome: "open" },
      { key: "pitched", label: "Pitched", outcome: "open" },
      { key: "follow_up", label: "Follow-up", outcome: "open" },
      { key: "term_sheet", label: "Term sheet", outcome: "open" },
      { key: "committed", label: "Committed", outcome: "won" },
      { key: "passed", label: "Passed", outcome: "lost" },
    ],
  },
};

export function isPipelineSection(value: string): value is PipelineSection {
  return value === "restaurants" || value === "investors";
}

export function getStage(section: PipelineSection, key: string): Stage | null {
  return PIPELINES[section].stages.find((stage) => stage.key === key) ?? null;
}

export function firstStage(section: PipelineSection): Stage {
  return PIPELINES[section].stages[0];
}

export type StageChange = { stage: string; status: DealStatus; closedAt: Date | null };

/**
 * What to store when a deal moves into a stage: terminal stages set status and closedAt,
 * moving back out clears them. Null when the stage is not in the section's list.
 */
export function stageChange(section: PipelineSection, key: string, now: Date = new Date()): StageChange | null {
  const stage = getStage(section, key);
  if (!stage) return null;
  return { stage: stage.key, status: stage.outcome, closedAt: stage.outcome === "open" ? null : now };
}

// --- Investors: the angel / institution rule -------------------------------------------------

export const INVESTOR_TYPES = ["angel", "institution"] as const;
export type InvestorType = (typeof INVESTOR_TYPES)[number];
export const INVESTOR_TYPE_LABELS: Record<InvestorType, string> = { angel: "Angel", institution: "Institution" };

export const FIRM_TYPES = ["vc", "family_office", "corporate", "accelerator", "other"] as const;
export const FIRM_TYPE_LABELS: Record<(typeof FIRM_TYPES)[number], string> = {
  vc: "VC",
  family_office: "Family office",
  corporate: "Corporate",
  accelerator: "Accelerator",
  other: "Other",
};

/**
 * Angels are a person only (contact required, no company); institutions are a firm
 * (company required) with partner contacts attached separately. The type is stored on the
 * deal, never inferred from whether a company exists.
 */
export function checkInvestorParties(
  type: InvestorType,
  parties: { companyId: string | null; contactId: string | null },
): string | null {
  if (type === "angel") {
    if (!parties.contactId) return "An angel needs a person.";
    if (parties.companyId) return "An angel is a person, not a company.";
    return null;
  }
  return parties.companyId ? null : "An institution needs a company.";
}

export function investorTypeOf(details: Record<string, unknown>): InvestorType | null {
  const value = details.investorType;
  return value === "angel" || value === "institution" ? value : null;
}

// --- details schemas (jsonb) -----------------------------------------------------------------

const detail = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters.`).default("");

export const restaurantCompanyDetails = z.object({
  cuisine: detail(100),
  neighborhood: detail(100),
  currentSupplier: detail(200),
  orderFrequency: detail(100),
});

export const institutionCompanyDetails = z.object({
  firmType: z.enum(FIRM_TYPES).default("vc"),
  focusStage: detail(100),
  checkSize: detail(100),
  introducedBy: detail(200),
});

export const angelContactDetails = z.object({ background: detail(2000) });

/** Drops empty strings so jsonb only stores what was filled in. */
export function compactDetails<T extends Record<string, unknown>>(details: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== "" && value != null));
}
