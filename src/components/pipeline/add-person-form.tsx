"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { addPersonAction } from "@/app/actions/deals";
import { describedBy, FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { emptyFormState } from "@/lib/form-state";

export function AddPersonForm({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState(addPersonAction, emptyFormState);
  const { errors } = state;
  return (
    <form key={state.saved} action={action} className="space-y-3" noValidate>
      <input type="hidden" name="dealId" value={dealId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="person-name" label="Name" error={errors.name}>
          <Input id="person-name" name="name" required autoComplete="off" defaultValue={state.values.name ?? ""} aria-invalid={errors.name ? true : undefined} aria-describedby={describedBy("person-name", errors.name)} />
        </FormField>
        <FormField id="person-title" label="Role" error={errors.title}>
          <Input id="person-title" name="title" defaultValue={state.values.title ?? ""} aria-describedby={describedBy("person-title", errors.title)} />
        </FormField>
        <FormField id="person-email" label="Email" error={errors.email}>
          <Input id="person-email" name="email" type="email" defaultValue={state.values.email ?? ""} aria-invalid={errors.email ? true : undefined} aria-describedby={describedBy("person-email", errors.email)} />
        </FormField>
      </div>
      {state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" variant="secondary" size="lg" disabled={pending}>
        <UserPlus aria-hidden />
        {pending ? "Adding…" : "Add person"}
      </Button>
    </form>
  );
}
