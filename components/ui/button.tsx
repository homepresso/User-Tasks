import { forwardRef } from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive"
  size?: "default" | "sm" | "lg" | "icon"
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      asChild = false,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--theme-primary)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none",
          // Theme-variable variants: the previous hardcoded grays/white were
          // unreadable on dark-canvas themes (ghost text vanished, outline
          // buttons flashed white cards on navy surfaces).
          variant === "default" &&
            "themed-btn-primary shadow-sm hover:shadow-md",
          variant === "outline" &&
            "border border-[color:var(--theme-surface-border)] bg-[color:var(--theme-card-bg)] text-[color:var(--theme-card-text)] hover:bg-[color:var(--theme-primary-light)]",
          variant === "ghost" &&
            "text-[color:var(--theme-card-text)] hover:bg-[color:var(--theme-primary-light)]",
          variant === "destructive" &&
            "bg-[color:var(--theme-danger)] text-[color:var(--theme-on-danger)] hover:opacity-90",
          size === "default" && "h-10 px-4 py-2 text-sm",
          size === "sm" && "h-8 px-3 text-xs",
          size === "lg" && "h-12 px-6 text-base",
          size === "icon" && "h-10 w-10",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
