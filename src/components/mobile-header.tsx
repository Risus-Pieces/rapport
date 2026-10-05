import Link from "next/link";
import { Settings } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
      <Wordmark />
      <div className="flex items-center">
        <Link
          href="/settings"
          aria-label="Settings"
          className={buttonVariants({ variant: "ghost", size: "icon" })}
        >
          <Settings />
        </Link>
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}
