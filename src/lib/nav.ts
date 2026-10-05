import {
  House,
  Landmark,
  ListChecks,
  Settings,
  UtensilsCrossed,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  accent?: "restaurants" | "investors" | "general";
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/restaurants", label: "Restaurants", icon: UtensilsCrossed, accent: "restaurants" },
  { href: "/investors", label: "Investors", icon: Landmark, accent: "investors" },
  { href: "/general", label: "General", icon: Users, accent: "general" },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
];

export const SECONDARY_NAV: NavItem[] = [{ href: "/settings", label: "Settings", icon: Settings }];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
