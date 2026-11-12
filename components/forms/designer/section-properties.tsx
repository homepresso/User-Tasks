'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { CHOICE_GROUP_DISPLAYS, CHOICE_GROUP_DISPLAY_LABELS, CHOICE_GROUP_LIMITS, isPaged, type FormChoiceGroup, type FormSection } from '@/lib/forms/layout'
import {
  addChoiceGroup, designerChoiceGroupProblems, designerSectionProblems, removeChoiceGroup, removeSection, updateChoiceGroup, updateSection, type DesignerState,
} from '@/lib/forms/designer-state'
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
      <ChoiceGroupSettings state={state} section={section} onChange={onChange} />
      <div>
        <p className="mb-1 text-2xs font-medium text-fg-muted">When to load</p>
        <LoadModeEditor idPrefix={id('load')} noun="section" load={section.load} preload={section.preload}
          problem={lazyLoadProblems(state.layout, state.fields)[`section:${section.key}`]} onChange={(patch) => set(patch)} />
      </div>
    </div>
  )
}

/** The page (or '' on a single-page form) each section's rows sit on. */
function sectionPages(state: DesignerState): Map<string, string> {
  const out = new Map<string, string>()
  const grids = isPaged(state.layout) ? state.layout.pages.map((p) => ({ id: p.id, rows: p.rows })) : [{ id: '', rows: state.layout.rows }]
  for (const grid of grids) for (const row of grid.rows) if (row.section && !out.has(row.section)) out.set(row.section, grid.id)
  return out
}

/**
 * Choice group (lib/forms/sections.ts — InfoPath's choice group): this
 * section and 1–5 others on the same page become alternatives — one shows
 * at a time, picked with a switch; the others' fields are not required and
 * not kept. Create one here, or edit the group this section belongs to.
 */
function ChoiceGroupSettings({ state, section, onChange }: { state: DesignerState; section: FormSection; onChange: (next: DesignerState, tag?: string) => void }) {
  const id = (name: string) => `sp-${section.key}-cg-${name}`
  const groups = state.layout.choice_groups ?? []
  const group = groups.find((g) => g.sections.includes(section.key))
  const pages = sectionPages(state)
  const titles = new Map((state.layout.sections ?? []).map((s) => [s.key, s.title || s.key]))
  const grouped = new Set(groups.filter((g) => g !== group).flatMap((g) => g.sections))
  // Alternatives: sections on this section's page that no other group uses.
  const candidates = (state.layout.sections ?? []).filter((s) => pages.get(s.key) === pages.get(section.key) && !grouped.has(s.key))
  const [picked, setPicked] = useState<string[]>([])
  if (!group) {
    const others = candidates.filter((s) => s.key !== section.key)
    return (
      <div className="space-y-1 rounded border border-dashed border-border p-2" data-choice-group-create={section.key}>
        <p className="text-2xs font-medium text-fg-muted">Choice group</p>
        {others.length === 0
          ? <p className="text-2xs text-fg-muted">Add another section on this {isPaged(state.layout) ? 'step / tab' : 'form'} to offer it as an alternative: one of them shows at a time, picked with a switch.</p>
          : (
            <>
              <p className="text-2xs text-fg-muted">Show one of several sections at a time, with a switch above it. Alternatives to <strong>{section.title}</strong>:</p>
              {others.map((s) => (
                <label key={s.key} className="flex items-center gap-1.5 text-2xs">
                  <input type="checkbox" className="accent-primary" checked={picked.includes(s.key)} disabled={!picked.includes(s.key) && picked.length >= CHOICE_GROUP_LIMITS.max - 1}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, s.key] : picked.filter((k) => k !== s.key))} data-choice-group-pick={s.key} />
                  {s.title || s.key}
                </label>
              ))}
              <button type="button" disabled={picked.length < 1} className="text-2xs font-semibold text-primary-text disabled:opacity-40"
                onClick={() => { const made = addChoiceGroup(state, [section.key, ...picked], `Choose: ${section.title}`); if (made) { onChange(made.state); setPicked([]) } }} data-choice-group-add>
                Create choice group
              </button>
            </>
          )}
      </div>
    )
  }
  const problem = designerChoiceGroupProblems(state)[group.key]
  const set = (patch: Partial<FormChoiceGroup>, tag?: string) => onChange(updateChoiceGroup(state, group.key, patch), tag)
  return (
    <fieldset className="space-y-1.5 rounded border border-primary/40 p-2" data-choice-group-settings={group.key}>
      <legend className="px-1 text-2xs font-semibold text-primary-text">Choice group</legend>
      <div>
        <Label htmlFor={id('label')}>Switch label</Label>
        <input id={id('label')} className={inputClass} value={group.label} onChange={(e) => set({ label: e.target.value }, `cgl-${group.key}`)} data-choice-group-label />
      </div>
      <div>
        <Label htmlFor={id('key')}>Key</Label>
        <input id={id('key')} className={`${inputClass} font-mono`} value={group.key} aria-invalid={Boolean(problem)}
          onChange={(e) => { const key = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 52); if (key) set({ key }, `cgk-${group.key}`) }} />
        <p className={cn('mt-0.5 text-2xs', problem ? 'text-danger' : 'text-fg-muted')}>
          {problem ?? <>The chosen section&apos;s key is submitted as <code>{group.key}</code> — rules read <code>{`{{form.${group.key}}}`}</code> and may set it.</>}
        </p>
      </div>
      <div>
        <Label htmlFor={id('display')}>Switch</Label>
        <select id={id('display')} className={inputClass} value={group.display ?? 'radio'} onChange={(e) => set({ display: e.target.value as FormChoiceGroup['display'] })} data-choice-group-display>
          {CHOICE_GROUP_DISPLAYS.map((d) => <option key={d} value={d}>{CHOICE_GROUP_DISPLAY_LABELS[d]}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={id('default')}>Shown first</Label>
        <select id={id('default')} className={inputClass} value={group.default ?? group.sections[0]} onChange={(e) => set({ default: e.target.value === group.sections[0] ? undefined : e.target.value })}>
          {group.sections.map((k) => <option key={k} value={k}>{titles.get(k) ?? k}</option>)}
        </select>
      </div>
      <div className="space-y-0.5">
        <p className="text-2xs font-medium text-fg-muted">Alternatives ({CHOICE_GROUP_LIMITS.min}–{CHOICE_GROUP_LIMITS.max})</p>
        {candidates.map((s) => {
          const on = group.sections.includes(s.key)
          return (
            <label key={s.key} className="flex items-center gap-1.5 text-2xs">
              <input type="checkbox" className="accent-primary" checked={on} disabled={(!on && group.sections.length >= CHOICE_GROUP_LIMITS.max) || (on && group.sections.length <= CHOICE_GROUP_LIMITS.min)}
                onChange={(e) => set({ sections: e.target.checked ? [...group.sections, s.key] : group.sections.filter((k) => k !== s.key) })} />
              {s.title || s.key}
            </label>
          )
        })}
      </div>
      <p className="text-2xs text-fg-muted">Only the chosen section shows; the others&apos; fields are not required, not checked and stored empty.</p>
      <button type="button" className="text-2xs font-medium text-danger" onClick={() => onChange(removeChoiceGroup(state, group.key))} data-choice-group-remove>Remove choice group (the sections stay)</button>
    </fieldset>
  )
}
