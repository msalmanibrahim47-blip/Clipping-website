import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    variant: {
      default: "bg-surface-3 text-muted",
      primary: "bg-primary-soft text-primary",
      success: "bg-success/12 text-success",
      warning: "bg-warning/12 text-warning",
      danger: "bg-danger/12 text-danger",
      info: "bg-info/12 text-info",
      gold: "bg-gold-soft text-gold",
      outline: "border border-line-strong text-muted",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
