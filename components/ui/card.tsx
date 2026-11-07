import { cn } from "@/lib/utils"

/**
 * Card: panel background, 1px border, radius md, no shadow (cards are flat).
 *
 * New code: <Card padding="none"> with CardHeader / CardBody / CardFooter, or
 * padding="md" for a simple box. Without `padding` the legacy 24px padding
 * applies so existing callers keep their layout for one release.
 * Never nest a bordered Card in a Card: use variant="inset" or a divider.
 */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** interactive: whole-card link (hover border-strong + elev-1). inset: subtle well, no border. */
  variant?: "default" | "interactive" | "inset"
  /** none · sm 12px · md 16px · lg 20px. Omitted = legacy 24px. */
  padding?: "none" | "sm" | "md" | "lg"
}

const PADDING = { none: "p-0", sm: "p-3", md: "p-4", lg: "p-5" } as const

export function Card({ className, variant = "default", padding, ...props }: CardProps) {
  return (
    <div
      data-variant={variant}
      className={cn(
        "rounded-lg text-fg",
        variant === "inset" ? "bg-subtle" : "border border-border bg-panel",
        variant === "interactive" &&
          "cursor-pointer transition-[border-color,box-shadow] duration-[var(--ds-dur-fast)] ease-[var(--ds-ease-standard)] hover:border-border-strong hover:shadow-elev-1",
        padding ? PADDING[padding] : "p-6",
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, title, description, actions, children, ...props }: Omit<React.HTMLAttributes<HTMLDivElement>, "title"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Buttons at the right of the header. */
  actions?: React.ReactNode
}) {
  return (
    // The title keeps at least 14rem (or the whole row); actions that don't fit beside it wrap under it.
    <div className={cn("flex flex-wrap items-start gap-3 p-4", className)} {...props}>
      <div className="min-w-[min(100%,14rem)] flex-1">
        {title != null && <CardTitle>{title}</CardTitle>}
        {description != null && <CardDescription>{description}</CardDescription>}
        {children}
      </div>
      {actions != null && <div className="flex max-w-full shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold tracking-[-0.006em] text-fg", className)} {...props} />
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-0.5 max-w-[72ch] text-ui text-fg-muted", className)} {...props} />
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 rounded-b-lg border-t border-border-subtle bg-subtle px-4 py-3", className)} {...props} />
}
