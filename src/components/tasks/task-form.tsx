"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTaskAction } from "@/app/actions/records";
import { emptyFormState } from "@/lib/form-state";

export function TaskForm({ contactId }: { contactId?: string }) {
  const [state, action, pending] = useActionState(createTaskAction, emptyFormState);
  const suffix = contactId ?? "all";
  const titleError = state.errors.title ?? state.message ?? undefined;
  const dueError = state.errors.dueDate;

  // key remounts the form after a save so the fields empty; after an error they keep what was typed.
  return (
    <form key={state.saved} action={action} className="space-y-2" noValidate>
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor={`task-title-${suffix}`}>New task</Label>
          <Input
            id={`task-title-${suffix}`}
            name="title"
            placeholder="Send the deck"
            autoComplete="off"
            required
            defaultValue={state.values.title ?? ""}
            aria-invalid={state.errors.title ? true : undefined}
            aria-describedby={titleError ? `task-title-error-${suffix}` : undefined}
          />
          {titleError ? (
            <p id={`task-title-error-${suffix}`} role="alert" className="text-sm text-destructive">
              {titleError}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`task-due-${suffix}`}>Due</Label>
          <Input
            id={`task-due-${suffix}`}
            name="dueDate"
            type="date"
            className="w-44"
            defaultValue={state.values.dueDate ?? ""}
            aria-invalid={dueError ? true : undefined}
            aria-describedby={dueError ? `task-due-error-${suffix}` : undefined}
          />
          {dueError ? (
            <p id={`task-due-error-${suffix}`} role="alert" className="text-sm text-destructive">
              {dueError}
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" disabled={pending} className="mt-[1.625rem]">
          <Plus aria-hidden />
          {pending ? "Adding…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
