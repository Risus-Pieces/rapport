import type { RaiseProgress } from "@/db/queries/raise";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Committed and soft-circled money against the raise target. */
export function RaiseProgressBar({ progress, compact = false }: { progress: RaiseProgress; compact?: boolean }) {
  const { target, committed, softCircled, ready } = progress;
  const pct = (n: number) => Math.max(0, Math.min(100, (n / Math.max(target, 1)) * 100));
  const committedPct = pct(committed);
  const softPct = Math.min(100 - committedPct, pct(softCircled));
  return (
    <div className="space-y-2">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-secondary"
        role="img"
        aria-label={`${usd(committed)} committed and ${usd(softCircled)} soft-circled of ${usd(target)}`}
      >
        <span className="h-full bg-section-investors" style={{ width: `${committedPct}%` }} />
        <span className="h-full bg-section-investors-soft" style={{ width: `${softPct}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{usd(committed)}</span> committed
        {softCircled > 0 ? <> · {usd(softCircled)} soft-circled</> : null} · goal {usd(target)}
        {compact ? null : <> · {ready} {ready === 1 ? "investor" : "investors"} ready to hear the raise</>}
      </p>
    </div>
  );
}
