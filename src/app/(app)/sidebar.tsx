import { LogOut } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { signOut } from "@/lib/auth/actions";
import type { Release } from "@/lib/releases";
import type { ColorScheme } from "@/lib/ui-preferences";

import { NavLinks } from "./nav-links";
import { SidebarFrame } from "./sidebar-frame";
import { ThemeToggle } from "./theme-toggle";
import { UpdateNotice } from "./update-notice";

/** Up to two initials for the avatar, e.g. "Jane Doe" → "JD". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
}

/**
 * The signed-in sidebar: brand header, navigation, a notice while a newer
 * release is out, the theme switch, and the account footer. New application
 * is at the top right of the pages, so it isn't here too.
 */
export function Sidebar({
  userName,
  update,
  currentVersion,
  collapsed,
  colorScheme,
  counts,
}: {
  userName: string;
  update: Release | null;
  currentVersion: string;
  /** Collapsed to its icons, as last left. */
  collapsed: boolean;
  /** The scheme the switch chose last, if any. */
  colorScheme?: ColorScheme;
  /** Badges by nav item, e.g. replies waiting in the inbox. */
  counts?: Record<string, number>;
}) {
  return (
    <SidebarFrame
      initialCollapsed={collapsed}
      brand={
        // The whole box, mark and name, goes to the Dashboard.
        <Link href="/" title="Go to the Dashboard" className="flex min-w-0 items-center gap-2 rounded-control text-ink no-underline hover:text-ink">
          <BrandMark />
          <span className="flex min-w-0 flex-col group-data-collapsed/sidebar:hidden">
            <span className="font-serif text-2xl leading-none font-medium tracking-[-0.01em]">Scout</span>
            <span className="truncate text-xs text-muted">Your agentic job search</span>
          </span>
        </Link>
      }
    >
      <div className="flex flex-1 flex-col gap-1 p-2 group-data-collapsed/sidebar:px-1">
        <NavLinks counts={counts} />
      </div>

      {update && (
        <div className="px-2 pb-2 group-data-collapsed/sidebar:px-1">
          <UpdateNotice release={update} currentVersion={currentVersion} />
        </div>
      )}

      <div className="flex flex-col gap-0.5 border-t border-line p-2 group-data-collapsed/sidebar:px-1">
        <ThemeToggle serverScheme={colorScheme} />
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3 group-data-collapsed/sidebar:flex-col group-data-collapsed/sidebar:px-1">
        <span
          aria-hidden="true"
          title={userName}
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-on-primary"
        >
          {initials(userName)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col group-data-collapsed/sidebar:hidden">
          <span className="truncate text-xs font-medium">{userName}</span>
          <span className="truncate text-[11px] text-muted">Self-hosted · v{currentVersion}</span>
        </span>
        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="grid size-[26px] place-items-center rounded-control text-muted hover:bg-hover hover:text-ink"
          >
            <LogOut size={15} aria-hidden="true" />
          </button>
        </form>
      </div>
    </SidebarFrame>
  );
}
