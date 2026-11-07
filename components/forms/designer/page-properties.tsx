'use client'

import { ArrowLeft, ArrowRight, Copy, Trash2 } from 'lucide-react'
import { FORM_PAGE_ICONS, isPaged, type FormPage, type FormPageIcon, type StepIndicator } from '@/lib/forms/layout'
import { movePage, pageFieldKeys, pageProblems, pageSettings, updatePage, updatePageSettings } from '@/lib/forms/pages'
import type { DesignerState } from '@/lib/forms/designer-state'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { PAGE_ICONS } from '@/components/forms/page-icons'
import { VisibleWhenEditor } from './field-properties'
import { LoadModeEditor } from './load-mode-editor'
import { lazyLoadProblems } from '@/lib/forms/lazy-load'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'

/**
 * Properties of the selected step / tab (title, description, icon, its
 * "Visible when" rule; When to load; duplicate, reorder, delete) and the settings every
 * step shares (indicator, Next / Back labels, skipping ahead, the review
 * step, resuming on form pages).
 */


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0 border-border">
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function Check({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-xs text-fg">
      <input id={id} type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

const INDICATORS: Array<[StepIndicator, string]> = [['numbered', 'Numbered'], ['progress', 'Progress bar'], ['dots', 'Dots']]

export function PageProperties({ state, page, onChange, onDelete, onDuplicate, allowRules = true, allowResume = true }: {
  state: DesignerState
  page: FormPage
  onChange: (next: DesignerState, tag?: string) => void
  onDelete: () => void
  onDuplicate: () => void
  /** Conditional pages (off for start forms, whose inputs are checked without the layout). */
  allowRules?: boolean
  /** The "resume later" option (reusable forms' pages). */
  allowResume?: boolean
}) {
  if (!isPaged(state.layout)) return null
  const layout = state.layout
  const steps = layout.mode === 'steps'
  const noun = steps ? 'Step' : 'Tab'
  const index = layout.pages.findIndex((p) => p.id === page.id)
  const settings = pageSettings(layout)
  const id = (name: string) => `pp-${page.id}-${name}`
  const set = (patch: Partial<Omit<FormPage, 'id' | 'rows'>>, tag?: string) => onChange({ ...state, layout: updatePage(layout, page.id, patch) }, tag)
  const setSettings = (patch: Parameters<typeof updatePageSettings>[1], tag?: string) => onChange({ ...state, layout: updatePageSettings(layout, patch) }, tag)
  const problems = pageProblems(layout)
  // Steps: rules test answers from earlier steps; tabs: any other tab's fields.
  const earlier = new Set((steps ? layout.pages.slice(0, index) : layout.pages.filter((p) => p.id !== page.id)).flatMap(pageFieldKeys))
  const ruleFields = state.fields.filter((f) => earlier.has(f.key) && !DISPLAY_FIELD_TYPES.has(f.type))
  const fieldCount = pageFieldKeys(page).length

  return (
    <div className="space-y-3" data-page-properties={page.id}>
      <Section title={`${noun} ${index + 1}`}>
        <div>
          <Label htmlFor={id('title')}>Title</Label>
          <input id={id('title')} className={inputClass} value={page.title} maxLength={80}
            onChange={(e) => set({ title: e.target.value }, `pt-${page.id}`)} aria-invalid={problems.blocking[page.id] ? true : undefined} data-page-title />
          {problems.blocking[page.id] && <p className="mt-1 text-2xs text-danger">{problems.blocking[page.id]}</p>}
        </div>
        <div>
          <Label htmlFor={id('desc')}>Description (optional)</Label>
          <textarea id={id('desc')} rows={2} className="w-full rounded-md border px-2 py-1 text-xs" value={page.description ?? ''} maxLength={300}
            onChange={(e) => set({ description: e.target.value || undefined }, `pd-${page.id}`)} />
        </div>
        <div>
          <Label>Icon (optional)</Label>
          <div className="grid grid-cols-9 gap-1" role="radiogroup" aria-label={`${noun} icon`}>
            <button type="button" role="radio" aria-checked={!page.icon} onClick={() => set({ icon: undefined })} className={cn('flex h-7 items-center justify-center rounded border text-2xs', !page.icon ? 'border-primary' : 'border-border', !page.icon ? 'bg-primary-wash' : '')}
             >None</button>
            {FORM_PAGE_ICONS.map((name) => {
              const Icon = PAGE_ICONS[name as FormPageIcon]
              const on = page.icon === name
              return (
                <button key={name} type="button" role="radio" aria-checked={on} aria-label={name.replace(/-/g, ' ')} title={name.replace(/-/g, ' ')} onClick={() => set({ icon: name })}
                  className={cn('flex h-7 items-center justify-center rounded border', on ? 'border-primary' : 'border-border', on ? 'bg-primary-wash' : '', on ? 'text-primary-text' : 'text-fg')}
                 >
                  <Icon size={13} aria-hidden />
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 pt-1">
          <button type="button" className="flex items-center gap-1 rounded border px-2 py-1 text-2xs disabled:opacity-30 border-border" disabled={index === 0}
            onClick={() => onChange({ ...state, layout: movePage(layout, page.id, -1) })} aria-label={`Move ${noun.toLowerCase()} earlier`}><ArrowLeft size={11} aria-hidden /> Earlier</button>
          <button type="button" className="flex items-center gap-1 rounded border px-2 py-1 text-2xs disabled:opacity-30 border-border" disabled={index === layout.pages.length - 1}
            onClick={() => onChange({ ...state, layout: movePage(layout, page.id, 1) })} aria-label={`Move ${noun.toLowerCase()} later`}>Later <ArrowRight size={11} aria-hidden /></button>
          <button type="button" className="flex items-center gap-1 rounded border px-2 py-1 text-2xs border-border" onClick={onDuplicate} data-duplicate-page>
            <Copy size={11} aria-hidden /> Duplicate
          </button>
          <button type="button" className="flex items-center gap-1 rounded border px-2 py-1 text-2xs disabled:opacity-30 border-border text-danger"
            disabled={layout.pages.length <= 1} onClick={onDelete} title={layout.pages.length <= 1 ? 'A form needs at least one page: switch to Single page instead' : undefined} data-delete-page>
            <Trash2 size={11} aria-hidden /> Delete
          </button>
        </div>
        <p className="text-2xs text-fg-muted">{fieldCount} field{fieldCount === 1 ? '' : 's'} on this {noun.toLowerCase()}.</p>
      </Section>

      {allowRules && (
        <Section title="Visible when">
          {ruleFields.length > 0 || page.visible_when || (state.layout.state?.flags ?? []).length > 0 ? (
            <VisibleWhenEditor rule={page.visible_when} fields={ruleFields} flags={(state.layout.state?.flags ?? []).map((f) => f.key)} onChange={(rule, typing) => set({ visible_when: rule }, typing ? `pv-${page.id}` : undefined)} />
          ) : (
            <p className="text-2xs text-fg-muted">{steps ? 'Add fields to an earlier step to show this step only for some answers.' : 'Add fields to another tab to show this tab only for some answers.'}</p>
          )}
          {problems.warnings[page.id] && page.visible_when && <p className="text-2xs text-warning">{problems.warnings[page.id]}</p>}
          <p className="text-2xs text-fg-muted">A hidden {noun.toLowerCase()} is skipped{steps ? ' and not counted in the progress' : ''}; its fields are not required.</p>
        </Section>
      )}

      <Section title="When to load">
        <LoadModeEditor idPrefix={id('load')} noun={steps ? 'step' : 'tab'} load={page.load} preload={page.preload}
          problem={lazyLoadProblems(state.layout, state.fields)[`page:${page.id}`]} onChange={(patch) => set(patch)} />
      </Section>

      <Section title={steps ? 'All steps' : 'All tabs'}>
        {steps && (
          <>
            <div>
              <Label>Progress indicator</Label>
              <div className="flex gap-1" role="radiogroup" aria-label="Progress indicator">
                {INDICATORS.map(([value, text]) => (
                  <button key={value} type="button" role="radio" aria-checked={settings.indicator === value} onClick={() => setSettings({ indicator: value === 'numbered' ? undefined : value })}
                    className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', settings.indicator === value ? 'border-primary' : 'border-border', settings.indicator === value ? 'bg-primary-wash' : '', settings.indicator === value ? 'text-primary-text' : 'text-fg')}
                    data-indicator={value}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor={id('back')}>Back button</Label>
                <input id={id('back')} className={inputClass} placeholder="Back" maxLength={40} value={layout.page_settings?.back_label ?? ''} onChange={(e) => setSettings({ back_label: e.target.value }, 'ps-back')} />
              </div>
              <div>
                <Label htmlFor={id('next')}>Next button</Label>
                <input id={id('next')} className={inputClass} placeholder="Next" maxLength={40} value={layout.page_settings?.next_label ?? ''} onChange={(e) => setSettings({ next_label: e.target.value }, 'ps-next')} />
              </div>
            </div>
            <Check id={id('skip')} checked={settings.allow_skip} onChange={(v) => setSettings({ allow_skip: v })}>
              Allow skipping ahead <span className="block text-2xs text-fg-muted">The stepper opens any step; every visible field is still checked on submit.</span>
            </Check>
            <Check id={id('review')} checked={settings.review} onChange={(v) => setSettings({ review: v })}>
              Review step before submitting <span className="block text-2xs text-fg-muted">A read-only summary of the answers, with the form&apos;s buttons.</span>
            </Check>
            {settings.review && (
              <div>
                <Label htmlFor={id('review-title')}>Review step title</Label>
                <input id={id('review-title')} className={inputClass} placeholder="Review your answers" maxLength={80} value={layout.page_settings?.review_title ?? ''} onChange={(e) => setSettings({ review_title: e.target.value }, 'ps-review')} />
              </div>
            )}
          </>
        )}
        {allowResume && (
          <Check id={id('resume')} checked={settings.resume} onChange={(v) => setSettings({ resume: v })}>
            Let people resume later <span className="block text-2xs text-fg-muted">On the form&apos;s page (/f/…), unsent answers{steps ? ' and the step' : ''} are kept in that browser. Task forms keep drafts already.</span>
          </Check>
        )}
        <p className="text-2xs text-fg-muted">{steps ? 'The form’s buttons show on the last step' : 'The form’s buttons show under every tab'}; all {steps ? 'steps' : 'tabs'} are one submission.</p>
      </Section>
    </div>
  )
}
