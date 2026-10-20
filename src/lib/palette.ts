export type PaletteItem = { label: string; href: string };

export const PALETTE_ITEMS: { pages: PaletteItem[]; actions: PaletteItem[] } = {
  pages: [
    { label: "Home", href: "/" },
    { label: "This week", href: "/week" },
    { label: "Opportunities", href: "/opportunities" },
    { label: "Restaurants", href: "/restaurants" },
    { label: "Investors", href: "/investors" },
    { label: "General", href: "/general" },
    { label: "Tasks", href: "/tasks" },
    { label: "Settings", href: "/settings" },
  ],
  actions: [
    { label: "Add contact", href: "/general/new" },
    { label: "Add restaurant", href: "/restaurants/new" },
    { label: "Add investor", href: "/investors/new" },
    { label: "Add task", href: "/tasks" },
  ],
};

/** Case-insensitive substring filter over the fixed pages and actions. */
export function filterPalette(query: string): { pages: PaletteItem[]; actions: PaletteItem[] } {
  const q = query.trim().toLowerCase();
  const match = (item: PaletteItem) => q === "" || item.label.toLowerCase().includes(q);
  return { pages: PALETTE_ITEMS.pages.filter(match), actions: PALETTE_ITEMS.actions.filter(match) };
}
