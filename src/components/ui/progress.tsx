import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

type ProgressAccessibleName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never };

type ProgressProps = Omit<
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
  "aria-label" | "aria-labelledby"
> & ProgressAccessibleName;

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, ...props }, ref) => {
  const normalizedValue = typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 0;

  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={normalizedValue}
      className={cn("relative h-4 w-full overflow-hidden rounded-full bg-secondary", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - normalizedValue}%)` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
