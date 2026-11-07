'use client'

import { Trash2 } from 'lucide-react'
import type { FormSection } from '@/lib/forms/layout'
import { designerSectionProblems, removeSection, updateSection, type DesignerState } from '@/lib/forms/designer-state'
import { sectionFieldKeys, sectionIncludedKey } from '@/lib/forms/sections'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { VisibleWhenEditor } from './field-properties'
import { LoadModeEditor } from './load-mode-editor'
import { lazyLoadProblems } from '@/lib/forms/lazy-load'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * Properties of the selected section (lib/forms/sections.ts): title, key,
 * description, optional (with its Add label), collapsible / start collapsed,
 * bordered / plain, Visible when, When to load; remove (its fields stay, outside it).
 */


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Check({ id, checked, onChange, children, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-xs text-fg" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input id={id} type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

export function SectionProperties({ state, section, onChange, onRemoved, allowOptional = true }: {
  state: DesignerState
  section: FormSection
  onChange: (next: DesignerState, tag?: string) => void
  onRemoved: () => void
  /** Optional sections (off for start forms, whose inputs map to workflow variables). */
  allowOptional?: boolean
}) {
  const id = (name: string) => `sp-${section.key}-${name}`
  const set = (patch: Partial<FormSection>, tag?: string) => onChange(updateSection(state, section.key, patch), tag)
  const problem = designerSectionProblems(state)[section.key]
  const inside = new Set(sectionFieldKeys(state.layout, section.key))
  const ruleFields = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && !inside.has(f.key))
  const flags = (state.layout.state?.flags ?? []).map((f) => f.key)
  return (
    <div className="space-y-3 text-xs" aria-label={`Properties of section ${section.title}`} data-section-properties={section.key}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-2xs font-semibold text-fg-muted">Section · {inside.size} field{inside.size === 1 ? '' : 's'}</p>
        <button type="button" onClick={() => { onChange(removeSection(state, section.key)); onRemoved() }} className="rounded p-1" aria-label="Remove section (its fields stay)" title="Remove the section — its fields stay on the form"><Trash2 size={12} /></button>
      </div>
      <div>
        <Label htmlFor={id('title')}>Title</Label>
        <input id={id('title')} className={inputClass} value={section.title} onChange={(e) => set({ title: e.target.value }, `st-${section.key}`)} data-section-title-input />
      </div>
      <div>
        <Label htmlFor={id('key')}>Key</Label>
        <input id={id('key')} className={`${inputClass} font-mono`} value={section.key} onChange={(e) => {
          const key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 52)
          // Rows find their section by key: never blank, never another section's.
          if (key && !(state.layout.sections ?? []).some((s) => s.key === key && s.key !== section.key)) set({ key }, `sk-${section.key}`)
        }} aria-invalid={Boolean(problem)} />
        <p className={cn('mt-0.5 text-2xs', problem ? 'text-danger' : 'text-fg-muted')}>
          {problem ?? <>Rules target <code>section:{section.key}</code>{section.optional ? <>; the submission records <code>{sectionIncludedKey(section.key)}</code></> : null}.</>}
        </p>
      </div>
      <div>
        <Label htmlFor={id('desc')}>Description</Label>
        <textarea id={id('desc')} rows={2} className="w-full rounded-md border px-2 py-1 text-xs" value={section.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined }, `sd-${section.key}`)} />
      </div>
      <div className="space-y-1.5">
        <Check id={id('optional')} checked={Boolean(section.optional)} disabled={!allowOptional} onChange={(optional) => set({ optional })}>
          Optional — the person chooses to add it
          <span className="block text-2xs text-fg-muted">{allowOptional ? 'Until added (or after Remove) its fields are not required, not checked and stored empty.' : 'Not available on start forms.'}</span>
        </Check>
        {section.optional && (
          <div className="pl-5">
            <Label htmlFor={id('add')}>Add button text</Label>
            <input id={id('add')} className={inputClass} placeholder={`Add ${section.title}`} value={section.add_label ?? ''} onChange={(e) => set({ add_label: e.target.value || undefined }, `sa-${section.key}`)} />
          </div>
        )}
        <Check id={id('collapsible')} checked={Boolean(section.collapsible)} onChange={(collapsible) => set({ collapsible })}>Collapsible</Check>
        {section.collapsible && (
          <div className="pl-5"><Check id={id('collapsed')} checked={Boolean(section.collapsed)} onChange={(collapsed) => set({ collapsed })}>Start collapsed</Check></div>
        )}
      </div>
      <div>
        <p className="mb-1 text-2xs font-medium text-fg-muted">Style</p>
        <div className="flex gap-1" role="radiogroup" aria-label="Section style">
          {(['bordered', 'plain'] as const).map((style) => {
            const on = (section.style ?? 'bordered') === style
            return (
              <button key={style} type="button" role="radio" aria-checked={on} onClick={() => set({ style })}
                className={cn('flex-1 rounded border px-2 py-1 text-xs capitalize', on ? 'border-primary' : 'border-border', on ? 'bg-primary-wash' : '', on ? 'text-primary-text' : '')}
               >
                {style}
              </button>
            )
          })}
        </div>
      </div>
      {(ruleFields.length > 0 || flags.length > 0 || section.visible_when) && (
        <div>
          <p className="mb-1 text-2xs font-medium text-fg-muted">Visible when</p>
          <VisibleWhenEditor rule={section.visible_when} fields={ruleFields} flags={flags} onChange={(rule, typing) => set({ visible_when: rule }, typing ? `sv-${section.key}` : undefined)} />
          <p className="mt-0.5 text-2xs text-fg-muted">A hidden section&apos;s fields are not required. Rules can also show, hide, collapse or expand <code>section:{section.key}</code>.</p>
        </div>
      )}
      <div>
        <p className="mb-1 text-2xs font-medium text-fg-muted">When to load</p>
        <LoadModeEditor idPrefix={id('load')} noun="section" load={section.load} preload={section.preload}
          problem={lazyLoadProblems(state.layout, state.fields)[`section:${section.key}`]} onChange={(patch) => set(patch)} />
      </div>
    </div>
  )
}
