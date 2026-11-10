"use client";

import { Switch } from "radix-ui";
import { useId, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type SlideSwitchProps = Omit<Switch.SwitchProps, "children"> & {
  label: ReactNode;
  description?: ReactNode;
};

/**
 * The master on/off for a whole feature, unlike the round Toggle rows: a
 * rectangular slider with a gripped handle and ON/OFF in its track. It's a
 * `role="switch"`, with label and description on the left.
 */
export function SlideSwitch({ label, description, id, className, checked, ...props }: SlideSwitchProps) {
  const generated = useId();
  const switchId = id ?? generated;
  const descriptionId = description ? `${switchId}-description` : undefined;
  return (
    <div className={cn("flex items-center gap-5", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <label htmlFor={switchId} className="w-fit cursor-pointer text-field font-medium">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="text-meta text-muted">
            {description}
          </p>
        )}
      </div>
      <Switch.Root
        id={switchId}
        checked={checked}
        aria-describedby={descriptionId}
        className="relative flex h-10 w-[104px] shrink-0 items-center rounded-[6px] border border-line-strong bg-input p-1 data-[state=checked]:border-primary data-[state=checked]:bg-primary motion-safe:transition-colors"
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 flex w-1/2 items-center justify-center text-xs font-semibold tracking-wider",
            checked ? "left-0 text-on-primary" : "right-0 text-muted",
          )}
        >
          {checked ? "ON" : "OFF"}
        </span>
        <Switch.Thumb className="relative z-10 flex h-full w-[44px] items-center justify-center gap-[3px] rounded-[4px] border border-line-strong bg-card shadow-knob data-[state=checked]:translate-x-[50px] motion-safe:transition-transform">
          <span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-muted" />
          <span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-muted" />
          <span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-muted" />
        </Switch.Thumb>
      </Switch.Root>
    </div>
  );
}
