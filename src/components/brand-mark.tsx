import { cn } from "@/lib/cn";

/** Scout's "S" mark, as in src/app/icon.svg, in the primary colours, so it turns light in the dark scheme. Decorative: put the name next to it. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="14.08" className="fill-primary" />
      <text x="32" y="45.5" textAnchor="middle" className="fill-on-primary font-serif" fontSize="40" fontWeight="600">
        S
      </text>
    </svg>
  );
}
