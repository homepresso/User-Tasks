'use client'

import { AlertTriangle } from 'lucide-react'
import type { FormPartLoad } from '@/lib/forms/layout'
import { cn } from '@/lib/utils'

/**
 * "When to load" on a step / tab or a section (lib/forms/lazy-load.ts):
 * On form open (default) / When first shown / When a rule loads it, and,
 * for the lazy two, "Preload in background". `problem`: a "rule" part no
 * rule loads.
 */

const MODES: Array<{ value: FormPartLoad; label: string }> = [
  { value: 'eager', label: 'On form open' },
  { value: 'visible', label: 'When first shown' },
  { value: 'rule', label: 'When a rule loads it' },
]

export function LoadModeEditor({ idPrefix, noun, load, preload, problem, onChange }: {
  idPrefix: string
  /** "tab", "step" or "section" (help texts). */
  noun: 'tab' | 'step' | 'section'
  load: FormPartLoad | undefined
  preload: boolean | undefined
  problem?: string | null
  onChange: (patch: { load?: FormPartLoad; preload?: boolean }) => void
}) {
  const mode = load ?? 'eager'
  const shown = noun === 'section' ? 'is expanded or first scrolled into view' : 'is first opened'
  const help: Record<FormPartLoad, string> = {
    eager: `Its controls load with the form.`,
    visible: `Its controls load when the ${noun} ${shown}: Data tables, lookups, custom controls and bound properties wait until then.`,
    rule: `Its controls load when a rule runs “Load section / tab” on it. Until then it shows a placeholder.`,
  }
  return (
    <div className="space-y-1.5" data-load-mode-editor={idPrefix}>
      <div className="flex gap-1" role="radiogroup" aria-label="When to load">
        {MODES.map((m) => {
          const on = mode === m.value
          return (
            <button key={m.value} type="button" role="radio" aria-checked={on}
              onClick={() => onChange(m.value === 'eager' ? { load: undefined, preload: undefined } : { load: m.value })}
              className={cn('min-h-7 flex-1 rounded border px-1 py-0.5 text-2xs font-medium leading-tight', on ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')}
              data-load-mode={m.value}>
              {m.label}
            </button>
          )
        })}
      </div>
      <p className="text-2xs text-fg-muted">{help[mode]} Values, defaults and required checks are not affected: a submit loads any part it has to check.</p>
      {mode !== 'eager' && (
        <label htmlFor={`${idPrefix}-preload`} className="flex items-start gap-2 text-xs text-fg">
          <input id={`${idPrefix}-preload`} type="checkbox" className="mt-0.5" checked={Boolean(preload)} onChange={(e) => onChange({ preload: e.target.checked || undefined })} data-load-preload />
          <span>Preload in background
            <span className="block text-2xs text-fg-muted">Once the form is idle, warm this {noun}&apos;s custom controls and bound properties so it opens faster.</span>
          </span>
        </label>
      )}
      {problem && (
        <p className="flex items-start gap-1 text-2xs text-warning" role="status" data-load-problem>
          <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden /> {problem}
        </p>
      )}
    </div>
  )
}
