"use client";

import { useActionState } from "react";
import { Mail, Phone, UsersRound } from "lucide-react";
import { quickLogAction, type QuickState } from "@/app/actions/records";
import { Button } from "@/components/ui/button";

const TOUCHES = [
  { type: "call", label: "Called", icon: Phone },
  { type: "email", label: "Emailed", icon: Mail },
  { type: "meeting", label: "Met", icon: UsersRound },
] as const;

// One-tap logging for the most common touches; the full form is for everything else.
export function QuickLog({ contactId }: { contactId: string }) {
  const [state, action, pending] = useActionState<QuickState, FormData>(quickLogAction, { message: null });
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="contactId" value={contactId} />
      <div className="flex flex-wrap gap-2">
        {TOUCHES.map(({ type, label, icon: Icon }) => (
          <Button key={type} type="submit" name="type" value={type} variant="secondary" size="lg" disabled={pending}>
            <Icon aria-hidden />
            {label} today
          </Button>
        ))}
      </div>
      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {state.message}
      </p>
    </form>
  );
}
