// Rocket is for Startups, hidden for now (see below).
import { Archive, Bot, BriefcaseBusiness, FileText, House, Inbox, Search, Settings, UserRound, type LucideIcon } from "lucide-react";

// The app's sections, shared by the sidebar and the page bar so they always agree.

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Whether the item is the current section; defaults to its own path and below. */
  isActive?: (pathname: string) => boolean;
};

const within = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** The sections in groups; the last group sits at the bottom. */
export const NAV: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: House, isActive: (pathname) => pathname === "/" },
      { href: "/agent", label: "Agentic job search", icon: Bot },
      { href: "/jobs", label: "Manual job search", icon: Search },
      {
        href: "/applications",
        label: "Job application log",
        icon: BriefcaseBusiness,
        // A new application becomes one, so the flow belongs to Applications.
        isActive: (pathname) => within(pathname, "/applications") || within(pathname, "/new"),
      },
      { href: "/archive", label: "Archive", icon: Archive },
      // Hidden for now, not removed: the page still works at /startups. To bring
      // it back, uncomment this and import Rocket again.
      // { href: "/startups", label: "Startups", icon: Rocket },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "You",
    items: [
      { href: "/profile", label: "Profile", icon: UserRound },
      { href: "/resume", label: "Base resume", icon: FileText },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const isCurrent = ({ href, isActive = (path) => within(path, href) }: NavItem, pathname: string) => isActive(pathname);

/** The section a path belongs to, for the page bar's title; undefined outside them all. */
export function currentSection(pathname: string): NavItem | undefined {
  return NAV.flatMap((group) => group.items).find((item) => isCurrent(item, pathname));
}
