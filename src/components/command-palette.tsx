"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { searchAction } from "@/app/actions/search";
import type { SearchHit } from "@/db/queries/search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { filterPalette } from "@/lib/palette";

export const OPEN_PALETTE_EVENT = "rapport:open-palette";

const ITEM =
  "flex min-h-11 cursor-default items-center justify-between gap-3 rounded-lg px-3 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:ring-2 data-[selected=true]:ring-inset data-[selected=true]:ring-ring";

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const text = query.trim();
    const ticket = ++latest.current;
    if (text.length < 2) {
      // Clearing is handled by the render below, which ignores hits for short queries.
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchAction(text);
        if (ticket === latest.current) setHits(found);
      } catch {
        if (ticket === latest.current) setHits([]);
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    setHits([]);
    router.push(href);
  }

  const shownHits = query.trim().length >= 2 ? hits : [];
  const { pages, actions } = filterPalette(query);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setQuery("");
          setHits([]);
        }
      }}
    >
      <DialogContent className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Search and jump</DialogTitle>
        <DialogDescription className="sr-only">Search contacts and deals, open a page or add something.</DialogDescription>
        <Command shouldFilter={false} label="Search and jump" loop>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search people and deals, or jump to a page"
              className="h-14 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              {searching ? "Searching…" : "No matches."}
            </Command.Empty>
            {shownHits.length > 0 ? (
              <Command.Group heading="Results" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
                {shownHits.map((hit) => (
                  <Command.Item key={hit.id} value={hit.id} onSelect={() => go(hit.href)} className={ITEM}>
                    <span className="truncate">{hit.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{hit.detail}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {actions.length > 0 ? (
              <Command.Group heading="Add" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
                {actions.map((item) => (
                  <Command.Item key={item.href} value={`action:${item.href}`} onSelect={() => go(item.href)} className={ITEM}>
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
            {pages.length > 0 ? (
              <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
                {pages.map((item) => (
                  <Command.Item key={item.href} value={`page:${item.href}`} onSelect={() => go(item.href)} className={ITEM}>
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function PaletteTrigger({ variant = "bar" }: { variant?: "bar" | "icon" }) {
  const open = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
  if (variant === "icon") {
    return (
      <Button variant="ghost" size="icon-lg" aria-label="Search" onClick={open}>
        <Search aria-hidden />
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      className="flex h-11 w-full items-center gap-3 rounded-xl border border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <Search aria-hidden className="size-4" />
      <span className="flex-1 text-left">Search</span>
      <kbd className="rounded-md border border-border px-1.5 py-0.5 text-xs">⌘K</kbd>
    </button>
  );
}
