"use client";
import * as React from "react";
import { Checkbox as C, Switch as S, Slider as Sl } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-primary disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}

export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded border border-line-strong bg-surface-2 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <C.Indicator>
        <Check className="size-3 text-white" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}

export function Slider({ className, ...props }: React.ComponentProps<typeof Sl.Root>) {
  return (
    <Sl.Root className={cn("relative flex h-5 w-full touch-none select-none items-center", className)} {...props}>
      <Sl.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-surface-3">
        <Sl.Range className="absolute h-full bg-primary" />
      </Sl.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <Sl.Thumb key={i} className="block size-4 rounded-full border-2 border-primary bg-white shadow focus-visible:outline-none" />
      ))}
    </Sl.Root>
  );
}

/** Compact segmented control for presets (clip length, counts, strategies…). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: Array<{ value: T; label: React.ReactNode; disabled?: boolean }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("flex flex-wrap gap-1 rounded-lg border border-line bg-surface-2 p-1", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-colors disabled:opacity-40",
            size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
            o.value === value ? "bg-surface-3 text-fg shadow-[0_0_0_1px_var(--color-line-strong)_inset]" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
