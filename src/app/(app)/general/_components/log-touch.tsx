"use client";

import { useActionState } from "react";
import { Mail, Phone, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logTouchAction, type TouchState } from "../actions";

const TOUCHES = [
  { type: "call", label: "Called", icon: Phone },
  { type: "email", label: "Emailed", icon: Mail },
  { type: "meeting", label: "Met", icon: UsersRound },
] as const;

export function LogTouch({ contactId }: { contactId: string }) {
  const [state, action, pending] = useActionState<TouchState, FormData>(logTouchAction, { message: null });
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={contactId} />
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
