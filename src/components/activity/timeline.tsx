import { Trash2 } from "lucide-react";
import { deleteActivityAction } from "@/app/actions/records";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/dates";

type TimelineItem = { id: string; type: string; summary: string; body: string | null; occurredAt: Date };

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-2 py-3">
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <p>
              <span className="font-medium capitalize">{item.type}</span>
              <span className="text-muted-foreground"> · {item.summary}</span>
            </p>
            {item.body ? <p className="whitespace-pre-wrap text-muted-foreground">{item.body}</p> : null}
            <time dateTime={item.occurredAt.toISOString()} className="block text-muted-foreground">
              {formatDay(item.occurredAt)}
            </time>
          </div>
          <form action={deleteActivityAction}>
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" variant="ghost" size="icon-lg" aria-label={`Delete ${item.type}: ${item.summary}`}>
              <Trash2 aria-hidden />
            </Button>
          </form>
        </li>
      ))}
    </ul>
  );
}
