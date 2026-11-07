"use client"

import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react"
import { AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface FieldProps {
  label: ReactNode
  /** Helper text under the control (hidden while there is an error). */
  description?: ReactNode
  error?: ReactNode
  /** Adds a muted "Optional" after the label (app chrome; the form runtime keeps its asterisk). */
  optional?: boolean
  /** Shown after the label in danger text — form runtime only. */
  required?: boolean
  /** id for the control; generated when omitted. The single child gets it plus aria-describedby / aria-invalid. */
  id?: string
  className?: string
  /** Extra content at the right of the label row (a link, a counter). */
  labelAside?: ReactNode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: ReactElement<any>
}

/**
 * Label + control + description / error, with the aria wiring done:
 * <Field label="Name" error={err}><Input value={…} /></Field>
 */
export function Field({ label, description, error, optional, required, id, className, labelAside, children }: FieldProps) {
  const auto = useId()
  const childProps = (children.props ?? {}) as Record<string, unknown>
  const controlId = id ?? (childProps.id as string | undefined) ?? `f${auto}`
  const descId = `${controlId}-desc`
  const errId = `${controlId}-err`
  const describedBy = [childProps["aria-describedby"], error ? errId : description ? descId : null].filter(Boolean).join(" ") || undefined
  const child = Children.only(children)
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<Record<string, unknown>>, {
        id: controlId,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true } : {}),
        ...(required ? { required: true } : {}),
      })
    : child
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={controlId} className="text-ui font-medium text-fg">
          {label}
          {optional && <span className="ml-1.5 font-normal text-fg-muted">Optional</span>}
          {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        </label>
        {labelAside}
      </div>
      {control}
      {error ? (
        <p id={errId} className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : description ? (
        <p id={descId} className="text-xs text-fg-muted">{description}</p>
      ) : null}
    </div>
  )
}
