"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        toast.error("Could not sign out. Try again.");
        setPending(false);
        return;
      }
      // Stay disabled while the redirect and refresh happen.
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not reach the server. Try again.");
      setPending(false);
    }
  }

  return (
    <Button variant="ghost" size="icon-lg" aria-label="Sign out" disabled={pending} onClick={signOut}>
      <LogOut />
    </Button>
  );
}
