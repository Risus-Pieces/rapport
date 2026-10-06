"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-xl font-medium">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">Your data is safe. Try again, and if it keeps happening, reload the page.</p>
      <Button size="lg" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
