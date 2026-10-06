import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("text-lg font-medium leading-none tracking-tight", className)}>
      Rapport
    </span>
  );
}
