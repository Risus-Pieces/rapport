"use client";

import { useActionState } from "react";
import { createApiTokenAction, type ApiTokenState } from "@/app/actions/api-tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initial: ApiTokenState = { token: null, name: null, ran: 0 };

export function ApiTokenForm() {
  const [state, action, pending] = useActionState(createApiTokenAction, initial);
  return (
    <div className="space-y-3">
      <form key={state.ran} action={action} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          Name
          <Input name="name" maxLength={80} placeholder="Mo's Claude" />
        </label>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Making…" : "Make a token"}
        </Button>
      </form>
      {state.token ? (
        <div role="status" className="space-y-1 rounded-xl bg-accent px-4 py-3 text-sm">
          <p>
            Token for <span className="font-medium">{state.name}</span>. Copy it now: it won&apos;t be shown again.
          </p>
          <code className="block break-all select-all">{state.token}</code>
        </div>
      ) : null}
    </div>
  );
}
