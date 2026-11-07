"use client"

import type { ReactNode } from "react"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * One block of a settings page (§5.14, the Stripe / Vercel pattern): the
 * title (16/600) and description (13 muted) in a 240px left column, the
 * controls on the right, a hairline between sections. Stacks below lg.
 */
export function SettingsSection({ title, description, children, className, id, aside }: {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  /** Extra content under the description (a docs link, a status pill). */
  aside?: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        "grid gap-x-8 gap-y-4 border-b border-border-subtle py-6 first:pt-0 last:border-b-0 lg:grid-cols-[240px_minmax(0,1fr)]",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 id={id ? `${id}-title` : undefined} className="text-base font-semibold text-fg">{title}</h2>
        {description != null && <p className="mt-1 text-ui text-fg-muted">{description}</p>}
        {aside != null && <div className="mt-3">{aside}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** A stack of SettingsSections (no card around them). */
export function SettingsSections({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col", className)}>{children}</div>
}

/**
 * Sticky bottom bar for a dirty settings form: "Unsaved changes · Discard ·
 * Save". Render it inside the <form> (Save is type="submit") or pass onSave.
 * Hidden while the form is clean, unless there is an error to show.
 */
export function SettingsSaveBar({ dirty, saving = false, error, onDiscard, onSave, saveLabel = "Save changes", saveTestId, className }: {
  dirty: boolean
  saving?: boolean
  error?: string | null
  onDiscard?: () => void
  /** Without onSave, Save submits the surrounding form. */
  onSave?: () => void
  saveLabel?: string
  saveTestId?: string
  className?: string
}) {
  if (!dirty && !saving && !error) return null
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className={cn(
        "ds-toast sticky bottom-4 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-elevated px-4 py-2.5 shadow-elev-2",
        className,
      )}
    >
      {error ? (
        <p role="alert" className="flex min-w-0 flex-1 items-center gap-1.5 text-ui text-danger">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{error}</span>
        </p>
      ) : (
        <p className="min-w-0 flex-1 text-ui text-fg-muted">{saving ? "Saving…" : "Unsaved changes"}</p>
      )}
      {onDiscard && (
        <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={saving || !dirty}>
          Discard
        </Button>
      )}
      <Button
        type={onSave ? "button" : "submit"}
        size="sm"
        onClick={onSave}
        loading={saving}
        disabled={!dirty}
        data-testid={saveTestId}
      >
        {saveLabel}
      </Button>
    </div>
  )
}
