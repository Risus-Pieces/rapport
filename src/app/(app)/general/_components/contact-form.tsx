"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { describedBy, FormField } from "@/components/form-field";
import { PRIORITIES } from "@/db/schema";
import { PRIORITY_LABELS, TARGET_DAYS } from "@/lib/reminders";
import { saveContactAction, type ContactFormState } from "../actions";

const PRIORITY_ITEMS = [
  { value: "", label: "No reminders" },
  ...PRIORITIES.map((value) => ({
    value,
    label: value === "gone" ? "Gone (no longer in touch)" : `${PRIORITY_LABELS[value]} (every ${TARGET_DAYS[value]} days)`,
  })),
];

export type ContactDefaults = {
  id?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
  priority?: string | null;
  tags?: string[];
};

export function ContactForm({ defaults, cancelHref }: { defaults: ContactDefaults; cancelHref: string }) {
  const initial: ContactFormState = { errors: {}, message: null, values: {} };
  const [state, action, pending] = useActionState(saveContactAction, initial);
  // After a failed submit, show what was typed; otherwise show the saved values.
  const submitted = Object.keys(state.values).length > 0;
  const value = (key: string, fallback: string | null | undefined) =>
    submitted ? (state.values[key] ?? "") : (fallback ?? "");
  const { errors } = state;

  return (
    <form action={action} className="max-w-xl space-y-5" noValidate>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <FormField id="name" label="Name" error={errors.name}>
        <Input
          id="name"
          name="name"
          required
          autoComplete="off"
          defaultValue={value("name", defaults.name)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("name", errors.name)}
        />
      </FormField>
      <FormField id="title" label="Role or how you know them" error={errors.title}>
        <Input id="title" name="title" defaultValue={value("title", defaults.title)} aria-invalid={errors.title ? true : undefined} aria-describedby={describedBy("title", errors.title)} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="email" label="Email" error={errors.email}>
          <Input id="email" name="email" type="email" defaultValue={value("email", defaults.email)} aria-invalid={errors.email ? true : undefined} aria-describedby={describedBy("email", errors.email)} />
        </FormField>
        <FormField id="phone" label="Phone" error={errors.phone}>
          <Input id="phone" name="phone" type="tel" defaultValue={value("phone", defaults.phone)} aria-invalid={errors.phone ? true : undefined} aria-describedby={describedBy("phone", errors.phone)} />
        </FormField>
      </div>
      <FormField id="linkedinUrl" label="LinkedIn" error={errors.linkedinUrl}>
        <Input id="linkedinUrl" name="linkedinUrl" inputMode="url" defaultValue={value("linkedinUrl", defaults.linkedinUrl)} aria-invalid={errors.linkedinUrl ? true : undefined} aria-describedby={describedBy("linkedinUrl", errors.linkedinUrl)} />
      </FormField>
      <FormField
        id="priority"
        label="How often to stay in touch"
        error={errors.priority}
        hint="You get a reminder when it has been longer than this."
      >
        <Select
          name="priority"
          items={PRIORITY_ITEMS}
          defaultValue={submitted ? (state.values.priority ?? "") : (defaults.priority ?? "")}
        >
          <SelectTrigger id="priority" aria-describedby={describedBy("priority", errors.priority, "hint")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {PRIORITY_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="tags" label="Tags" hint="Separate with commas." error={errors.tags}>
        <Input id="tags" name="tags" defaultValue={value("tags", defaults.tags?.join(", "))} aria-invalid={errors.tags ? true : undefined} aria-describedby={describedBy("tags", errors.tags, "hint")} />
      </FormField>
      <FormField id="notes" label="Notes" error={errors.notes}>
        <Textarea id="notes" name="notes" defaultValue={value("notes", defaults.notes)} aria-invalid={errors.notes ? true : undefined} aria-describedby={describedBy("notes", errors.notes)} />
      </FormField>
      {state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Saving…" : defaults.id ? "Save changes" : "Add contact"}
        </Button>
        <Button variant="outline" size="lg" render={<Link href={cancelHref} />}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
