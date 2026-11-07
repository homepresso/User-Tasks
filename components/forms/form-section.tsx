'use client'

import { ChevronDown, Minus, Plus } from 'lucide-react'
import type { FormSection } from '@/lib/forms/layout'
import { cn } from '@/lib/utils'
import { useCellMotion, useFormMotion } from './form-motion'

/**
 * One section of a form (lib/forms/sections.ts): a fieldset whose legend is
 * the title, an optional description, and its rows.
 *
 *  - Collapsible: the legend's button toggles it (aria-expanded,
 *    aria-controls the body). A section holding an error always shows open.
 *  - Optional: until the person adds it, only the title, description and an
 *    "Add <title>" button show; once added, a "Remove" button sits in its
 *    header. Read-only views show "Not included" for a section left out.
 *  - Bordered (default) or plain.
 */
export function FormSectionBlock({ section, idPrefix, included, collapsed, readOnly, hasError, onToggle, onInclude, children }: {
  section: FormSection
  idPrefix: string
  /** Optional sections: added by the person. Others: always true. */
  included: boolean
  collapsed: boolean
  readOnly: boolean
  /** A field inside has an error (the section shows open). */
  hasError?: boolean
  onToggle?: () => void
  onInclude?: (included: boolean) => void
  children: React.ReactNode
}) {
  const bodyId = `${idPrefix}section-${section.key}`
  const open = included && (!section.collapsible || !collapsed || Boolean(hasError))
  const bordered = section.style !== 'plain'
  const titleClass = 'text-sm font-semibold'
  const motion = useFormMotion()
  // Shown later (a rule, "Add"): fades up.
  const reveal = useCellMotion(motion.on && !readOnly)
  return (
    <fieldset
      className={cn('min-w-0', bordered ? 'rounded-lg border px-3 pb-3 pt-1' : 'pt-1', bordered ? 'border-border' : '')}
      data-form-section={section.key}
      data-section-included={included ? 'true' : 'false'}
      data-section-collapsed={open ? 'false' : 'true'}
      data-fm={reveal === 'reveal' ? 'fade' : undefined}
    >
      <legend className={cn('flex w-full items-center gap-2', bordered && 'px-1', 'text-fg')}>
        {section.collapsible && included ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={bodyId}
            className={cn('flex min-w-0 flex-1 items-center gap-1.5 rounded text-left', titleClass)}
            data-section-toggle={section.key}
          >
            <ChevronDown size={14} aria-hidden className={cn('shrink-0 transition-transform duration-[var(--fm-collapse-dur,var(--ds-dur-fast))] ease-[var(--ds-ease-standard)]', !open && '-rotate-90')} />
            <span className="truncate">{section.title}</span>
          </button>
        ) : (
          <span className={cn('min-w-0 flex-1 truncate', titleClass)}>{section.title}</span>
        )}
        {section.optional && included && !readOnly && onInclude && (
          <button
            type="button"
            onClick={() => onInclude(false)}
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium hover:underline text-primary-text"
            aria-label={`Remove ${section.title}`}
            data-section-remove={section.key}
          >
            <Minus size={12} aria-hidden /> Remove
          </button>
        )}
      </legend>
      {section.description && <p className="mb-2 whitespace-pre-wrap text-xs text-fg-muted">{section.description}</p>}
      {!included ? (
        readOnly || !onInclude ? (
          <p className="text-xs italic text-fg-muted" data-section-not-included>Not included</p>
        ) : (
          <button
            type="button"
            onClick={() => onInclude(true)}
            className="mt-1 flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs font-medium border-border text-primary-text"
            data-section-add={section.key}
          >
            <Plus size={13} aria-hidden /> {section.add_label || `Add ${section.title}`}
          </button>
        )
      ) : (
        motion.on && section.collapsible && !readOnly ? (
          // Form animations: collapse / expand with the grid-rows trick (app/form-motion.css); inert while closed.
          <div id={bodyId} className="fm-collapse" data-open={open ? 'true' : 'false'} inert={!open || undefined} aria-hidden={!open || undefined}>
            <div><div className="pt-1">{children}</div></div>
          </div>
        ) : (
          <div id={bodyId} hidden={!open} className="pt-1">
            {children}
          </div>
        )
      )}
    </fieldset>
  )
}
