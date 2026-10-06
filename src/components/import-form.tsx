"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { importContactsAction, type ImportState } from "@/app/actions/import";
import { IMPORT_ERRORS_SHOWN } from "@/lib/contact-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: ImportState = { message: null, created: 0, duplicates: 0, errors: [], ran: 0 };

export function ImportForm() {
  const [state, action, pending] = useActionState(importContactsAction, initial);
  return (
    <form key={state.ran} action={action} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="import-file">CSV file</Label>
        <Input id="import-file" name="file" type="file" accept=".csv,text/csv" required className="h-auto py-2.5" />
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        <Upload aria-hidden />
        {pending ? "Importing…" : "Import contacts"}
      </Button>
      <div role="status" className="space-y-2 text-sm">
        {state.message ? <p className="text-destructive">{state.message}</p> : null}
        {state.ran > 0 && !state.message ? (
          <>
            <p>
              Imported {state.created} {state.created === 1 ? "contact" : "contacts"}
              {state.duplicates > 0 ? `, skipped ${state.duplicates} already in Rapport` : ""}
              {state.errors.length > 0 ? `, ${state.errors.length} ${state.errors.length === 1 ? "row" : "rows"} had problems` : ""}.
            </p>
            {state.errors.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {state.errors.slice(0, IMPORT_ERRORS_SHOWN).map((error) => (
                  <li key={`${error.line}-${error.message}`}>
                    {error.line > 0 ? `Line ${error.line}: ` : ""}
                    {error.message}
                  </li>
                ))}
                {state.errors.length > IMPORT_ERRORS_SHOWN ? <li>…and {state.errors.length - IMPORT_ERRORS_SHOWN} more.</li> : null}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>
    </form>
  );
}
