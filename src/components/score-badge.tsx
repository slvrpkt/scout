import { cn } from "@/lib/cn";

/** A fit score (#208, E16-2) in a ring, filled from 85 up. */
export function ScoreBadge({ score, size = "md", letter }: { score: number; size?: "sm" | "md"; /** A grade to show above the score, in the same circle. */ letter?: string }) {
  return (
    <span
      role="img"
      aria-label={letter ? `Grade ${letter}, score ${score} of 100` : `Score ${score} of 100`}
      className={cn(
        "grid flex-none place-items-center rounded-full border font-mono tabular-nums",
        size === "md" ? "size-11 text-sm" : "h-6 min-w-6 px-1.5 text-xs",
        score >= 85 ? "border-primary bg-primary text-on-primary" : score >= 70 ? "border-line-strong bg-card text-ink" : "border-line-field bg-paper text-muted",
      )}
    >
      {letter ? (
        <span className="flex flex-col items-center gap-px font-sans leading-none">
          <span className="text-[15px] font-semibold">{letter}</span>
          <span className="text-[11px] font-medium">{score}</span>
        </span>
      ) : (
        score
      )}
    </span>
  );
}
