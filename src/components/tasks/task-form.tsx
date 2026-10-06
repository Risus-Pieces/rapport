"use client";

import { useActionState, useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTaskAction } from "@/app/actions/records";
import { emptyFormState } from "@/lib/form-state";

export function TaskForm({ contactId }: { contactId?: string }) {
  const [state, action, pending] = useActionState(createTaskAction, emptyFormState);
  const formRef = useRef<HTMLFormElement>(null);
  // Clear the fields after a successful save.
  useEffect(() => {
    if (state.saved > 0) formRef.current?.reset();
  }, [state.saved]);
  const error = state.errors.title ?? state.errors.dueDate ?? state.message;

  return (
    <form ref={formRef} action={action} className="space-y-2" noValidate>
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor={`task-title-${contactId ?? "all"}`}>New task</Label>
          <Input
            id={`task-title-${contactId ?? "all"}`}
            name="title"
            placeholder="Send the deck"
            autoComplete="off"
            required
            aria-invalid={state.errors.title ? true : undefined}
            aria-describedby={error ? `task-error-${contactId ?? "all"}` : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`task-due-${contactId ?? "all"}`}>Due</Label>
          <Input id={`task-due-${contactId ?? "all"}`} name="dueDate" type="date" className="w-44" />
        </div>
        <Button type="submit" size="lg" disabled={pending}>
          <Plus aria-hidden />
          {pending ? "Adding…" : "Add task"}
        </Button>
      </div>
      <p id={`task-error-${contactId ?? "all"}`} role={error ? "alert" : undefined} className="min-h-5 text-sm text-destructive">
        {error}
      </p>
    </form>
  );
}
