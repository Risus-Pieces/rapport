import { isValidDateString } from "@/lib/dates";

/** The pre-seed round the owner is working toward (stored in app_settings as raise.*). */
export type RaisePhase = "building" | "raising";
export type RaiseSettings = { target: number; launchDate: string | null; phase: RaisePhase };

export const DEFAULT_RAISE: RaiseSettings = { target: 75000, launchDate: null, phase: "building" };
export const MAX_TARGET = 100_000_000;

/** Form values to settings. Anything invalid keeps the current value; an empty launch date clears it. */
export function parseRaiseForm(values: Record<string, string | undefined>, current: RaiseSettings): RaiseSettings {
  const raw = (values.target ?? "").replace(/[$,\s]/g, "");
  const n = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  const target = Number.isFinite(n) && n > 0 && n <= MAX_TARGET ? Math.round(n) : current.target;
  const date = (values.launchDate ?? "").trim();
  const launchDate = date === "" ? null : isValidDateString(date) ? date : current.launchDate;
  const phase = values.phase === "building" || values.phase === "raising" ? values.phase : current.phase;
  return { target, launchDate, phase };
}

/** True when a fact was never set or was last updated more than `days` ago. */
export function isStale(updatedAt: Date | null, now: Date = new Date(), days = 14): boolean {
  if (!updatedAt) return true;
  return now.getTime() - updatedAt.getTime() > days * 86_400_000;
}
