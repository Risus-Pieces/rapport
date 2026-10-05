import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-serif text-xl leading-none tracking-tight", className)}>
      Personal <em className="text-primary">CRM</em>
    </span>
  );
}
