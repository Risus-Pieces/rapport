import { SECTION_STYLES, type SectionAccent } from "@/lib/nav";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: string;
  description?: string;
  accent?: SectionAccent;
  actions?: React.ReactNode;
};

export function PageHeader({ title, description, accent, actions }: PageHeaderProps) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-3 text-2xl font-medium tracking-tight md:text-[28px]">
          {accent ? <span aria-hidden className={cn("size-2.5 rounded-full", SECTION_STYLES[accent].dot)} /> : null}
          {title}
        </h1>
        {description ? <p className="max-w-prose text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}
