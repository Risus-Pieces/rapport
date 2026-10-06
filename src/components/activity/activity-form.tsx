"use client";

import { useActionState } from "react";
import { addActivityAction } from "@/app/actions/records";
import { emptyFormState } from "@/lib/form-state";
import { describedBy, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACTIVITY_TYPES } from "@/db/schema";

const TYPE_LABELS: Record<(typeof ACTIVITY_TYPES)[number], string> = {
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  tasting: "Tasting",
  note: "Note",
  other: "Other",
};
const TYPE_ITEMS = ACTIVITY_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }));

export function ActivityForm({ contactId, dealId }: { contactId?: string; dealId?: string }) {
  const [state, action, pending] = useActionState(addActivityAction, emptyFormState);
  const { errors } = state;

  return (
    <form key={state.saved} action={action} className="space-y-4" noValidate>
      {contactId ? <input type="hidden" name="contactId" value={contactId} /> : null}
      {dealId ? <input type="hidden" name="dealId" value={dealId} /> : null}
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr_11rem]">
        <FormField id="activity-type" label="Type" error={errors.type}>
          <Select name="type" items={TYPE_ITEMS} defaultValue={state.values.type ?? "call"}>
            <SelectTrigger id="activity-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {TYPE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="activity-summary" label="What happened" error={errors.summary}>
          <Input
            id="activity-summary"
            name="summary"
            required
            autoComplete="off"
            defaultValue={state.values.summary ?? ""}
            aria-invalid={errors.summary ? true : undefined}
            aria-describedby={describedBy("activity-summary", errors.summary)}
          />
        </FormField>
        <FormField id="activity-day" label="Date" hint="Blank means today." error={errors.day}>
          <Input
            id="activity-day"
            name="day"
            type="date"
            defaultValue={state.values.day ?? ""}
            aria-invalid={errors.day ? true : undefined}
            aria-describedby={describedBy("activity-day", errors.day, "hint")}
          />
        </FormField>
      </div>
      <FormField id="activity-body" label="Notes" error={errors.body}>
        <Textarea id="activity-body" name="body" className="min-h-16" defaultValue={state.values.body ?? ""} />
      </FormField>
      {state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Saving…" : "Log activity"}
      </Button>
    </form>
  );
}
