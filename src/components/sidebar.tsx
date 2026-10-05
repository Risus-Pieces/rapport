"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active && "bg-accent text-foreground",
      )}
    >
      <Icon
        className="size-4 shrink-0"
        style={item.accent && active ? { color: `var(--section-${item.accent})` } : undefined}
      />
      {item.label}
    </Link>
  );
}

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="px-6 pb-4 pt-7">
        <Wordmark />
      </div>
      <nav aria-label="Main" className="flex-1 space-y-1 px-3 py-2">
        {PRIMARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>
      <div className="space-y-2 border-t border-border p-3">
        {SECONDARY_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} pathname={pathname} />
        ))}
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="min-w-0 truncate px-2 text-xs text-muted-foreground" title={email}>
            {email}
          </p>
          <div className="flex shrink-0">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </div>
    </aside>
  );
}
