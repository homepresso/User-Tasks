import { cn } from "@/lib/utils"

/** Keyboard key hint ("⌘K", "Esc"): in tooltips, menus and button `kbd` slots. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-border bg-muted px-1 font-mono text-2xs font-medium text-fg-muted shadow-[inset_0_-1px_0_var(--ds-border)]",
        className,
      )}
      {...props}
    />
  )
}
