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
