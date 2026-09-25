"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";

export function CopyButton({ text, label = "Copy", ...props }: { text: string; label?: string } & Omit<ButtonProps, "onClick">) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      {...props}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check className="text-success" /> : <Copy />}
      {done ? "Copied" : label}
    </Button>
  );
}
