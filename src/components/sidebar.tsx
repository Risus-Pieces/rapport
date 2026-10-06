"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PaletteTrigger } from "@/components/command-palette";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { initials } from "@/lib/greeting";
import { PRIMARY_NAV, SECONDARY_NAV, SECTION_STYLES, isActivePath, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        active && "bg-accent font-medium text-foreground hover:bg-accent",
      )}
    >
      {/* The fill alone is too faint to count as a cue, so the active item also gets this bar. */}
      {active ? (
        <span aria-hidden className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-primary" />
      ) : null}
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        {item.accent ? (
          <span className={cn("size-2.5 rounded-full", SECTION_STYLES[item.accent].dot)} />
        ) : (
          <Icon className="size-5" />
        )}
      </span>
      {item.label}
    </Link>
  );
}

export function Sidebar({ name, email }: { name?: string | null; email: string }) {
  const pathname = usePathname();
  const displayName = name?.trim() || email;
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-card md:flex">
      <div className="px-6 pb-4 pt-7">
        <Wordmark />
      </div>
      <div className="px-3 pb-2">
        <PaletteTrigger />
      </div>
      <nav aria-label="Main" className="flex-1 space-y-1 px-3 py-2">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="shrink-0 space-y-2 border-t border-border p-3">
        {SECONDARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="flex items-center gap-3 px-3 pt-2">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-foreground"
          >
            {initials(name, email)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={displayName}>
              {displayName}
            </p>
            {displayName !== email ? (
              <p className="truncate text-xs text-muted-foreground" title={email}>
                {email}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1 px-1">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}
