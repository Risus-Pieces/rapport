import { PIPELINES, type PipelineSection } from "@/lib/sections";

export type StageCount = { stage: string; count: number; amountCents: number };
export type SnapshotStage = { key: string; label: string; outcome: string; count: number; amountCents: number };
export type Snapshot = {
  section: PipelineSection;
  stages: SnapshotStage[];
  openCount: number;
  openCents: number;
  wonCount: number;
};

/** Every stage of the pipeline, in order, with zeros for stages that have no deals. */
export function buildSnapshot(section: PipelineSection, rows: StageCount[]): Snapshot {
  const byStage = new Map(rows.map((row) => [row.stage, row]));
  const stages = PIPELINES[section].stages.map((stage) => ({
    key: stage.key,
    label: stage.label,
    outcome: stage.outcome,
    count: byStage.get(stage.key)?.count ?? 0,
    amountCents: byStage.get(stage.key)?.amountCents ?? 0,
  }));
  const open = stages.filter((s) => s.outcome === "open");
  return {
    section,
    stages,
    openCount: open.reduce((sum, s) => sum + s.count, 0),
    openCents: open.reduce((sum, s) => sum + s.amountCents, 0),
    wonCount: stages.filter((s) => s.outcome === "won").reduce((sum, s) => sum + s.count, 0),
  };
}
