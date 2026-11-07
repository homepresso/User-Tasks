import { forwardRef, type ReactNode } from "react"
import { Slot } from "@radix-ui/react-slot"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Kbd } from "./kbd"

/**
 * Button (docs/design/foundations.md). One `primary` per page header or
 * dialog footer; `secondary` for the rest, `ghost` in toolbars and rows.
 *
 * Legacy names stay as aliases for one release: `default` → primary,
 * `outline` → secondary, `destructive` → danger, size `default` → md.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost" | "link"
export type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon" | "icon-lg"
type LegacyVariant = "default" | "outline" | "destructive"
type LegacySize = "default"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | LegacyVariant
  size?: ButtonSize | LegacySize
  asChild?: boolean
  /** Shows a spinner in place of the leading icon, keeps the width, sets aria-busy and disables the button. */
  loading?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  /** Keyboard shortcut hint shown right-aligned ("⌘S"). */
  kbd?: ReactNode
}

const VARIANT_ALIAS: Record<LegacyVariant, ButtonVariant> = { default: "primary", outline: "secondary", destructive: "danger" }

export function resolveButtonVariant(v: ButtonProps["variant"] = "primary"): ButtonVariant {
  return (VARIANT_ALIAS as Record<string, ButtonVariant>)[v] ?? (v as ButtonVariant)
}
export function resolveButtonSize(s: ButtonProps["size"] = "md"): ButtonSize {
  return s === "default" ? "md" : s
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-fg shadow-elev-1 hover:bg-primary-hover active:bg-[color-mix(in_srgb,var(--theme-primary)_88%,black)]",
  secondary:
    "border border-border bg-panel text-fg hover:border-border-strong hover:bg-subtle active:bg-muted",
  ghost: "text-fg-muted hover:bg-subtle hover:text-fg active:bg-muted",
  danger: "bg-danger text-danger-fg shadow-elev-1 hover:bg-[color-mix(in_srgb,var(--theme-danger)_90%,black)]",
  "danger-ghost": "text-danger hover:bg-danger-wash",
  link: "h-auto px-0 text-primary-text underline-offset-4 hover:underline",
}

const SIZES: Record<ButtonSize, string> = {
  sm: "h-[max(var(--ds-control-h-sm),var(--ds-touch-min))] px-2.5 text-xs gap-1.5 [--btn-icon:14px]",
  md: "h-[max(var(--ds-control-h),var(--ds-touch-min))] px-3 text-[length:var(--ds-control-text)] leading-5 gap-1.5 [--btn-icon:16px]",
  lg: "h-[max(var(--ds-control-h-lg),var(--ds-touch-min))] px-3.5 text-sm gap-2 [--btn-icon:16px]",
  "icon-sm": "size-[var(--ds-control-h-sm)] min-h-[var(--ds-touch-min)] min-w-[var(--ds-touch-min)] [--btn-icon:14px]",
  icon: "size-[var(--ds-control-h)] min-h-[var(--ds-touch-min)] min-w-[var(--ds-touch-min)] [--btn-icon:16px]",
  "icon-lg": "size-[var(--ds-control-h-lg)] min-h-[var(--ds-touch-min)] min-w-[var(--ds-touch-min)] [--btn-icon:16px]",
}

/** Class string for a button look (for links or triggers that can't be a <Button>). */
export function buttonVariants({ variant, size, className }: { variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; className?: string } = {}) {
  const v = resolveButtonVariant(variant)
  const s = resolveButtonSize(size)
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium",
    "transition-[color,background-color,border-color,box-shadow,opacity] duration-[var(--ds-dur-fast)] ease-[var(--ds-ease-standard)]",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none aria-[disabled=true]:cursor-not-allowed aria-[disabled=true]:opacity-45",
    SIZES[s],
    VARIANTS[v],
    className,
  )
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, leadingIcon, trailingIcon, kbd, disabled, children, ...props }, ref) => {
    const classes = buttonVariants({ variant, size, className })
    if (asChild) {
      return <Slot ref={ref} className={classes} aria-busy={loading || undefined} {...props}>{children}</Slot>
    }
    const lead = loading ? <Loader2 className="size-[var(--btn-icon)] animate-spin" aria-hidden="true" /> : leadingIcon
    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {lead != null && <span className="inline-flex shrink-0 [&>svg]:size-[var(--btn-icon)]" aria-hidden="true">{lead}</span>}
        {children}
        {trailingIcon != null && <span className="inline-flex shrink-0 [&>svg]:size-[var(--btn-icon)]" aria-hidden="true">{trailingIcon}</span>}
        {kbd != null && <Kbd className="ml-1">{kbd}</Kbd>}
      </button>
    )
  },
)
Button.displayName = "Button"

export { Button }
