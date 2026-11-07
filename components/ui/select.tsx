import { forwardRef } from "react"
import { ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { CONTROL_HEIGHT, controlClass, type ControlSize } from "./input"

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: ControlSize
  /** Options as data; or pass <option> children. */
  options?: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  /** A first, empty option ("Choose…"). */
  placeholder?: string
  wrapperClassName?: string
}

/**
 * Styled native <select>: accessible, mobile-friendly, no dependency. The OS
 * chevron is replaced by a 16px ChevronsUpDown. Rich pickers (search,
 * multi-select) stay in searchable-*-picker.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, size = "md", options, placeholder, children, ...props }, ref) => (
    <div className={cn("relative inline-flex w-full", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(controlClass, CONTROL_HEIGHT[size], "cursor-pointer appearance-none truncate pl-2.5 pr-8", size === "lg" && "text-sm", className)}
        {...props}
      >
        {placeholder != null && <option value="">{placeholder}</option>}
        {options?.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        {children}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
    </div>
  ),
)
Select.displayName = "Select"
