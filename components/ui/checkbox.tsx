import { forwardRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type NativeInput = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">

export interface CheckboxProps extends NativeInput {
  /** Optional label rendered to the right (13px). */
  label?: ReactNode
  description?: ReactNode
}

// Native inputs with `appearance: none`: 16px, border-strong; checked = primary
// fill with an on-primary check (SVG mask, so it takes the token colour).
const CHECK_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-7'/%3E%3C/svg%3E\")"
const DASH_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='M4 8h8'/%3E%3C/svg%3E\")"

const boxBase = cn(
  "peer relative size-4 shrink-0 cursor-pointer appearance-none border border-border-strong bg-input",
  "transition-colors duration-[var(--ds-dur-instant)]",
  "checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary",
  "after:pointer-events-none after:absolute after:inset-0 after:bg-primary-fg after:opacity-0 checked:after:opacity-100 indeterminate:after:opacity-100",
  "disabled:cursor-not-allowed disabled:opacity-45",
)

function Labelled({ control, label, description, className }: { control: ReactNode; label?: ReactNode; description?: ReactNode; className?: string }) {
  if (label == null) return <>{control}</>
  return (
    <label className={cn("inline-flex cursor-pointer items-start gap-2 text-ui text-fg has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60", className)}>
      <span className="mt-0.5 inline-flex">{control}</span>
      <span className="min-w-0">
        <span className="block">{label}</span>
        {description != null && <span className="block text-xs text-fg-muted">{description}</span>}
      </span>
    </label>
  )
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(({ className, label, description, ...props }, ref) => (
  <Labelled
    label={label}
    description={description}
    className={label != null ? className : undefined}
    control={
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          boxBase,
          "rounded-sm after:[mask-image:var(--ds-check-mask)] after:[mask-size:100%] indeterminate:after:[mask-image:var(--ds-dash-mask)]",
          label == null && className,
        )}
        style={{ ["--ds-check-mask" as string]: CHECK_MASK, ["--ds-dash-mask" as string]: DASH_MASK }}
        {...props}
      />
    }
  />
))
Checkbox.displayName = "Checkbox"

export const Radio = forwardRef<HTMLInputElement, CheckboxProps>(({ className, label, description, ...props }, ref) => (
  <Labelled
    label={label}
    description={description}
    className={label != null ? className : undefined}
    control={
      <input
        ref={ref}
        type="radio"
        className={cn(boxBase, "rounded-full after:m-auto after:size-1.5 after:rounded-full after:[inset:0] checked:after:opacity-100", label == null && className)}
        {...props}
      />
    }
  />
))
Radio.displayName = "Radio"
