"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, SECTION_STYLES, isActivePath } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function BottomTabs({ counts = {} }: { counts?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 rounded-3xl border border-border bg-card p-1.5 md:hidden"
    >
      <ul className="grid grid-cols-6">
        {PRIMARY_NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex justify-center">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors",
                  active && cn("bg-accent ring-2 ring-primary", item.accent ? SECTION_STYLES[item.accent].text : "text-primary"),
                )}
              >
                <Icon aria-hidden className="size-5" />
                <span className="sr-only">
                  {item.label}
                  {counts[item.href] ? `, ${counts[item.href]} new` : ""}
                </span>
                {counts[item.href] ? <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
