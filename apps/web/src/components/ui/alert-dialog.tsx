import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { contentClass, DialogFooter, DialogHeader, overlayClass } from "@/components/ui/dialog"

/*
 * A confirmation that has to be answered: no close button, and clicking outside doesn't dismiss
 * it. Use it for irreversible actions (delete an interview, delete the account, end early).
 */
const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogHeader = DialogHeader
const AlertDialogFooter = DialogFooter

function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay data-slot="alert-dialog-overlay" className={overlayClass} />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(contentClass, className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("mb-0 font-display text-lg leading-tight font-semibold text-popover-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/* Defaults to the destructive style, since that's what these dialogs confirm. */
function AlertDialogAction({ variant = "destructive", ...props }: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Action asChild>
      <Button variant={variant} {...props} />
    </AlertDialogPrimitive.Action>
  )
}

function AlertDialogCancel({ variant = "outline", ...props }: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Cancel asChild>
      <Button variant={variant} {...props} />
    </AlertDialogPrimitive.Cancel>
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
