import type { LucideIcon } from "lucide-react";

type EmptyStateProps = { icon: LucideIcon; title: string; children?: React.ReactNode };

export function EmptyState({ icon: Icon, title, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-border px-6 py-14 text-center">
      <span aria-hidden className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-primary">
        <Icon className="size-5" />
      </span>
      <h2 className="font-medium">{title}</h2>
      {children ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}
