import {
  CalendarCheck,
  House,
  Landmark,
  ListChecks,
  Radar,
  Settings,
  UtensilsCrossed,
  Users,
  type LucideIcon,
} from "lucide-react";

export type SectionAccent = "restaurants" | "investors" | "general";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  accent?: SectionAccent;
  /** false = sidebar only (the phone tab bar fits six). */
  mobile?: boolean;
};

// Literal class strings on purpose: Tailwind only generates classes it can see
// written out in full, so never build these with template interpolation.
//   dot  = solid section color (nav dots, page header dot)
//   chip = soft background with ink text (icon chips)
//   text = section color as text/icon color
export const SECTION_STYLES: Record<SectionAccent, { dot: string; chip: string; text: string }> = {
  restaurants: {
    dot: "bg-section-restaurants",
    chip: "bg-section-restaurants-soft text-section-restaurants-ink",
    text: "text-section-restaurants",
  },
  investors: {
    dot: "bg-section-investors",
    chip: "bg-section-investors-soft text-section-investors-ink",
    text: "text-section-investors",
  },
  general: {
    dot: "bg-section-general",
    chip: "bg-section-general-soft text-section-general-ink",
    text: "text-section-general",
  },
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/week", label: "This week", icon: CalendarCheck },
  { href: "/radar", label: "Radar", icon: Radar },
  { href: "/restaurants", label: "Restaurants", icon: UtensilsCrossed, accent: "restaurants" },
  { href: "/investors", label: "Investors", icon: Landmark, accent: "investors" },
  { href: "/general", label: "General", icon: Users, accent: "general" },
  { href: "/tasks", label: "Tasks", icon: ListChecks, mobile: false },
];

export const MOBILE_NAV: NavItem[] = PRIMARY_NAV.filter((item) => item.mobile !== false);

export const SECONDARY_NAV: NavItem[] = [{ href: "/settings", label: "Settings", icon: Settings }];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
