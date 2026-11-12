import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/* Status variants lead with a dot, so the state isn't carried by colour alone. */
const dot = "before:size-1.5 before:rounded-full before:bg-current"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        live: cn(dot, "bg-primary text-primary-foreground motion-safe:before:animate-pulse"),
        ended: cn(dot, "bg-secondary text-muted-foreground"),
        pending: cn(dot, "border-border text-foreground before:bg-warning"),
        success: cn(dot, "border-border text-foreground before:bg-success"),
        error: cn(dot, "border-border text-foreground before:bg-destructive"),
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge }
