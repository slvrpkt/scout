import { workStyleOf, WORK_STYLE_NAMES, type WorkStyle } from "@/lib/scoring/preferences";
import { cn } from "@/lib/cn";

const STYLE: Record<WorkStyle, string> = {
  remote: "bg-mode-remote",
  hybrid: "bg-mode-hybrid",
  onsite: "bg-mode-onsite",
};

/**
 * Remote, Hybrid or On-site, in a bright capsule so it's easy to spot on a
 * job's card. Read from what the posting says, as scoring reads it; nothing
 * shows when it doesn't say.
 */
export function WorkModeBadge({ posting, className }: { posting: { title: string; description: string; remote: boolean | null }; className?: string }) {
  const style = workStyleOf({ ...posting, salary: "" });
  if (!style) return null;
  return (
    <span className={cn("inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-white", STYLE[style], className)}>
      {WORK_STYLE_NAMES[style]}
    </span>
  );
}
