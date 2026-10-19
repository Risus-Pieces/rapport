import { Check, MessageCircle } from "lucide-react";
import { adviceCallAction } from "@/app/(app)/week/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDay } from "@/lib/dates";

/** On an investor's deal: mark the first real conversation. Only then may they hear about the raise. */
export function AdviceCallCard({ dealId, doneAt, back }: { dealId: string; doneAt: string | null; back: string }) {
  return (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-medium">Raise</h2>
          <p className="text-sm text-muted-foreground">
            {doneAt
              ? `Advice call done ${formatDay(doneAt)}. Ready to hear the raise: monthly updates and the launch ask go to them.`
              : "After your first real conversation, mark it here. Only then do they hear about the round."}
          </p>
        </div>
        <form action={adviceCallAction}>
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="done" value={doneAt ? "false" : "true"} />
          <Button type="submit" size="lg" variant={doneAt ? "outline" : "default"}>
            {doneAt ? <Check aria-hidden /> : <MessageCircle aria-hidden />}
            {doneAt ? "Undo advice call" : "Advice call done"}
          </Button>
        </form>
      </div>
    </Card>
  );
}
