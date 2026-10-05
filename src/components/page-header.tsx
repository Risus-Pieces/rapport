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
