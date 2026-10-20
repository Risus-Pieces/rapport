import { Ban, Check, Pause, RotateCcw, Undo2 } from "lucide-react";
import { relationshipAction } from "@/app/actions/relationships";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RELATIONSHIP_LABELS, isRelationship, type Relationship } from "@/lib/relationships";

type Move = "known" | "on_hold" | "dismissed" | "restore" | "try_again";

const MOVE_UI: Record<Move, { label: string; icon: React.ReactNode }> = {
  known: { label: "Know them", icon: <Check aria-hidden /> },
  on_hold: { label: "On hold", icon: <Pause aria-hidden /> },
  dismissed: { label: "Dismiss", icon: <Ban aria-hidden /> },
  restore: { label: "Restore", icon: <Undo2 aria-hidden /> },
  try_again: { label: "Try again", icon: <RotateCcw aria-hidden /> },
};

/** What can happen next from each relationship. */
export const MOVES_FROM: Record<Relationship, Move[]> = {
  to_reach_out: ["known", "on_hold", "dismissed"],
  known: ["on_hold", "dismissed"],
  ghosted: ["try_again", "known", "on_hold", "dismissed"],
  on_hold: ["restore", "dismissed"],
  dismissed: ["restore"],
};

export function RelationshipButton({ kind, id, move, back, variant = "outline" }: {
  kind: "deal" | "contact";
  id: string;
  move: Move;
  back: string;
  variant?: "outline" | "ghost";
}) {
  const ui = MOVE_UI[move];
  return (
    <form action={relationshipAction}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="move" value={move} />
      <input type="hidden" name="back" value={back} />
      <Button type="submit" variant={variant} size="lg">
        {ui.icon}
        {ui.label}
      </Button>
    </form>
  );
}

/** The record's relationship and the moves it allows (on deal and contact pages). */
export function RelationshipControl({ kind, id, relationship, back }: { kind: "deal" | "contact"; id: string; relationship: string; back: string }) {
  const r: Relationship = isRelationship(relationship) ? relationship : "known";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={r === "to_reach_out" || r === "ghosted" ? "default" : "secondary"}>{RELATIONSHIP_LABELS[r]}</Badge>
      {MOVES_FROM[r].map((move) => (
        <RelationshipButton key={move} kind={kind} id={id} move={move} back={back} />
      ))}
    </div>
  );
}
