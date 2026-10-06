import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { SECONDARY_NAV } from "@/lib/nav";

export function MobileHeader() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur md:hidden">
      <Wordmark />
      <div className="flex items-center">
        {SECONDARY_NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-label={label}
            className={buttonVariants({ variant: "ghost", size: "icon-lg" })}
          >
            <Icon />
          </Link>
        ))}
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  );
}
