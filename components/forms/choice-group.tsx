'use client'

import { useRef } from 'react'
import type { FormChoiceGroup, FormSection } from '@/lib/forms/layout'
import { cn } from '@/lib/utils'

/**
 * A choice group (lib/forms/sections.ts — InfoPath's choice group / choice
 * section): the switch that picks which alternative section shows, with the
 * active section under it.
 *
 *  - radio (default): a fieldset of radio buttons (the group label is the legend);
 *  - tabs: a tab list (arrow keys / Home / End move and choose) whose
 *    panel is the active section;
 *  - dropdown: a labelled select.
 *
 * Read-only views show "<label>: <chosen section>" and the chosen section.
 */
export function ChoiceGroupBlock({ group, sections, active, idPrefix, readOnly, onChoose, children }: {
  group: FormChoiceGroup
  /** The alternatives' definitions (title per key). */
  sections: Map<string, FormSection>
  active: string
  idPrefix: string
  readOnly: boolean
  onChoose?: (sectionKey: string) => void
  children: React.ReactNode
}) {
  const base = `${idPrefix}choice-${group.key}`
  const title = (key: string) => sections.get(key)?.title || key
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const display = group.display ?? 'radio'
  const choose = (key: string) => { if (key !== active) onChoose?.(key) }

  if (readOnly || !onChoose) {
    return (
      <div className="flex flex-col gap-2" data-choice-group={group.key} data-choice-active={active}>
        <p className="text-xs text-fg-muted" data-choice-readonly><span className="font-semibold text-fg">{group.label}:</span> {title(active)}</p>
        {children}
      </div>
    )
  }

  if (display === 'tabs') {
    const index = Math.max(0, group.sections.indexOf(active))
    const onKeyDown = (e: React.KeyboardEvent) => {
      const last = group.sections.length - 1
      const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
          : e.key === 'Home' ? 0 : e.key === 'End' ? last : null
      if (next === null) return
      e.preventDefault()
      choose(group.sections[next])
      requestAnimationFrame(() => tabs.current[next]?.focus())
    }
    return (
      <div className="flex flex-col gap-2" data-choice-group={group.key} data-choice-display="tabs" data-choice-active={active}>
        <p id={`${base}-label`} className="text-xs font-semibold text-fg">{group.label}</p>
        <div role="tablist" aria-labelledby={`${base}-label`} className="flex flex-wrap gap-1 border-b border-border" onKeyDown={onKeyDown}>
          {group.sections.map((key, i) => (
            <button key={key} ref={(el) => { tabs.current[i] = el }} type="button" role="tab" id={`${base}-tab-${key}`} aria-selected={key === active} aria-controls={`${base}-panel`}
              tabIndex={key === active ? 0 : -1} onClick={() => choose(key)} data-choice-option={key}
              className={cn('-mb-px min-h-10 rounded-t-md border border-b-0 px-3 text-sm font-medium', key === active ? 'border-border bg-card text-primary-text' : 'border-transparent text-fg-muted hover:text-fg')}>
              {title(key)}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${active}`}>{children}</div>
      </div>
    )
  }

  if (display === 'dropdown') {
    return (
      <div className="flex flex-col gap-2" data-choice-group={group.key} data-choice-display="dropdown" data-choice-active={active}>
        <div>
          <label htmlFor={`${base}-select`} className="mb-1 block text-xs font-semibold text-fg">{group.label}</label>
          <select id={`${base}-select`} value={active} onChange={(e) => choose(e.target.value)} data-choice-select
            className="h-10 w-full rounded-lg border border-input-border bg-input px-2 text-sm text-fg sm:w-auto sm:min-w-[16rem]">
            {group.sections.map((key) => <option key={key} value={key}>{title(key)}</option>)}
          </select>
        </div>
        {children}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2" data-choice-group={group.key} data-choice-display="radio" data-choice-active={active}>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-xs font-semibold text-fg">{group.label}</legend>
        <div className="flex flex-wrap gap-2">
          {group.sections.map((key) => (
            <label key={key} className={cn('flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm', key === active ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')} data-choice-option={key}>
              <input type="radio" className="h-4 w-4 accent-primary" name={base} value={key} checked={key === active} onChange={() => choose(key)} />
              {title(key)}
            </label>
          ))}
        </div>
      </fieldset>
      {children}
    </div>
  )
}
