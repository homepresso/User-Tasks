'use client'

/**
 * The designer inspector's settings for the survey controls
 * (lib/forms/survey/controls.ts): scale, symbol and half steps of a star
 * rating; NPS end labels and colour bands; the agreement scale's points
 * (presets or your own); a matrix's statements and columns; a slider's
 * range, step and unit; 3 or 5 faces; ranking options; picture choice
 * options with an icon or image each; Yes / No / Maybe answers.
 */

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { DesignerField } from '@/lib/forms/designer-state'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import {
  LIKERT_PRESETS, LIKERT_PRESET_LABELS, RATING_ICONS, SURVEY_OPTION_ICONS, matrixRowKey, surveyOptions, type LikertPreset, type MatrixRow, type SurveyFieldConfig,
} from '@/lib/forms/survey/controls'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'

type Patch = (patch: Partial<TaskFieldDef>, tag?: string) => void

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 border-t pt-3 border-border" data-survey-properties>
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-2xs">
      <input className="accent-primary" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

function Segments<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
            className={cn('h-7 flex-1 rounded border text-2xs font-medium', value === o.value ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function num(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** An ordered list of texts (options, statements) with move / remove / add. */
function ListEditor({ items, onChange, noun, min = 1, max = 50, extra }: {
  items: string[]; onChange: (items: string[]) => void; noun: string; min?: number; max?: number
  /** Per item, something beside it (a picture choice's icon). */
  extra?: (item: string, index: number) => React.ReactNode
}) {
  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input aria-label={`${noun} ${i + 1}`} className={inputClass} value={item} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          {extra?.(item, i)}
          <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === 0} aria-label={`Move ${noun.toLowerCase()} ${i + 1} up`} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }}><ArrowUp size={11} /></button>
          <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === items.length - 1} aria-label={`Move ${noun.toLowerCase()} ${i + 1} down`} onClick={() => { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n) }}><ArrowDown size={11} /></button>
          <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={items.length <= min} aria-label={`Remove ${noun.toLowerCase()} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><X size={11} /></button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => onChange([...items, `${noun} ${items.length + 1}`])}>
          <Plus size={11} /> Add {noun.toLowerCase()}
        </button>
      )}
    </div>
  )
}

function presetOf(options: string[]): LikertPreset | '' {
  return (Object.keys(LIKERT_PRESETS) as LikertPreset[]).find((k) => LIKERT_PRESETS[k].length === options.length && LIKERT_PRESETS[k].every((o, i) => o === options[i])) ?? ''
}

function ScaleOptions({ field, onPatch, noun = 'Point', title = 'Scale' }: { field: DesignerField; onPatch: Patch; noun?: string; title?: string }) {
  const options = field.options ?? []
  const id = `sp-${field._id}`
  return (
    <Section title={title}>
      <div>
        <Label htmlFor={`${id}-preset`}>Ready-made scale</Label>
        <select id={`${id}-preset`} className={inputClass} value={presetOf(options)} onChange={(e) => { const k = e.target.value as LikertPreset; if (k) onPatch({ options: [...LIKERT_PRESETS[k]], option_labels: undefined }) }}>
          <option value="">Your own</option>
          {(Object.keys(LIKERT_PRESETS) as LikertPreset[]).map((k) => <option key={k} value={k}>{LIKERT_PRESET_LABELS[k]}</option>)}
        </select>
      </div>
      <ListEditor items={options} noun={noun} min={2} max={11} onChange={(next) => onPatch({ options: next }, `options-${field._id}`)} />
      <p className="text-2xs text-fg-muted">From the lowest to the highest: charts and averages read them in this order.</p>
    </Section>
  )
}

function EndLabels({ field, onPatch, survey }: { field: DesignerField; onPatch: Patch; survey: SurveyFieldConfig }) {
  const id = `sp-${field._id}`
  const set = (patch: Partial<SurveyFieldConfig>) => onPatch({ survey: { ...survey, ...patch } }, `survey-labels-${field._id}`)
  return (
    <div className="grid grid-cols-2 gap-1">
      <div>
        <Label htmlFor={`${id}-low`}>Low end label</Label>
        <input id={`${id}-low`} className={inputClass} value={survey.low_label ?? ''} placeholder="e.g. Not likely" onChange={(e) => set({ low_label: e.target.value || undefined })} />
      </div>
      <div>
        <Label htmlFor={`${id}-high`}>High end label</Label>
        <input id={`${id}-high`} className={inputClass} value={survey.high_label ?? ''} placeholder="e.g. Very likely" onChange={(e) => set({ high_label: e.target.value || undefined })} />
      </div>
    </div>
  )
}

export function SurveyProperties({ field, onPatch }: { field: DesignerField; onPatch: Patch }) {
  const survey: SurveyFieldConfig = field.survey ?? {}
  const setSurvey = (patch: Partial<SurveyFieldConfig>, tag?: string) => onPatch({ survey: { ...survey, ...patch } }, tag)
  const id = `sp-${field._id}`
  switch (field.type) {
    case 'rating':
      return (
        <Section title="Rating">
          <div className="grid grid-cols-2 gap-1">
            <div>
              <Label htmlFor={`${id}-max`}>Out of</Label>
              <select id={`${id}-max`} className={inputClass} value={field.max ?? 5} onChange={(e) => onPatch({ max: Number(e.target.value) })}>
                {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor={`${id}-icon`}>Symbol</Label>
              <select id={`${id}-icon`} className={inputClass} value={survey.icon ?? 'star'} onChange={(e) => setSurvey({ icon: e.target.value as SurveyFieldConfig['icon'] })}>
                {RATING_ICONS.map((i) => <option key={i} value={i}>{i === 'star' ? 'Stars' : i === 'heart' ? 'Hearts' : 'Thumbs up'}</option>)}
              </select>
            </div>
          </div>
          <Check checked={survey.half === true} onChange={(v) => setSurvey({ half: v || undefined })}>Allow half steps (3.5)</Check>
          <EndLabels field={field} onPatch={onPatch} survey={survey} />
        </Section>
      )
    case 'nps':
      return (
        <Section title="NPS scale">
          <EndLabels field={field} onPatch={onPatch} survey={survey} />
          <Check checked={survey.bands === true} onChange={(v) => setSurvey({ bands: v || undefined })}>Colour the detractor / passive / promoter bands</Check>
          <p className="text-2xs text-fg-muted">0–6 detractors, 7–8 passives, 9–10 promoters. NPS = % promoters − % detractors.</p>
        </Section>
      )
    case 'likert':
      return <ScaleOptions field={field} onPatch={onPatch} />
    case 'matrix': {
      const rows: MatrixRow[] = survey.rows ?? []
      const setRows = (labels: string[]) => {
        // Keep each surviving row's key (its data column), new rows get one from their label.
        const next = labels.map((label, i) => ({ key: rows[i]?.key ?? (matrixRowKey(label) || `row_${i + 1}`), label }))
        setSurvey({ rows: next }, `matrix-rows-${field._id}`)
      }
      return (
        <>
          <Section title="Statements (rows)">
            <ListEditor items={rows.map((r) => r.label)} noun="Statement" max={30} onChange={setRows} />
            <p className="text-2xs text-fg-muted">Each statement is answered on the scale below. Rules and conditions read <code>{`${field.key}.<row>`}</code>; a data table gets one column per statement.</p>
          </Section>
          <ScaleOptions field={field} onPatch={onPatch} noun="Column" title="Scale (columns)" />
        </>
      )
    }
    case 'slider':
      return (
        <Section title="Slider">
          <div className="grid grid-cols-3 gap-1">
            <div>
              <Label htmlFor={`${id}-min`}>Lowest</Label>
              <input id={`${id}-min`} type="number" className={inputClass} value={field.min ?? 0} onChange={(e) => onPatch({ min: num(e.target.value) }, `slider-min-${field._id}`)} />
            </div>
            <div>
              <Label htmlFor={`${id}-maxv`}>Highest</Label>
              <input id={`${id}-maxv`} type="number" className={inputClass} value={field.max ?? 100} onChange={(e) => onPatch({ max: num(e.target.value) }, `slider-max-${field._id}`)} />
            </div>
            <div>
              <Label htmlFor={`${id}-step`}>Step</Label>
              <input id={`${id}-step`} type="number" min={0} className={inputClass} value={survey.step ?? 1} onChange={(e) => setSurvey({ step: num(e.target.value) }, `slider-step-${field._id}`)} />
            </div>
          </div>
          <div>
            <Label htmlFor={`${id}-unit`}>Unit (optional)</Label>
            <input id={`${id}-unit`} className={inputClass} maxLength={12} value={survey.unit ?? ''} placeholder="e.g. %, kg, hours" onChange={(e) => setSurvey({ unit: e.target.value || undefined }, `slider-unit-${field._id}`)} />
          </div>
          <Check checked={survey.hide_value !== true} onChange={(v) => setSurvey({ hide_value: v ? undefined : true })}>Show the value beside the slider</Check>
          <EndLabels field={field} onPatch={onPatch} survey={survey} />
        </Section>
      )
    case 'csat':
      return (
        <Section title="Faces">
          <Segments label="How many faces" value={survey.faces === 3 ? 3 : 5} options={[{ value: 3, label: '3 faces' }, { value: 5, label: '5 faces' }]} onChange={(v) => setSurvey({ faces: v === 3 ? 3 : undefined })} />
          <p className="text-2xs text-fg-muted">Stored as 1 (worst) to {survey.faces === 3 ? 3 : 5}. CSAT % counts the {survey.faces === 3 ? 'happy face' : 'top two faces'}.</p>
        </Section>
      )
    case 'ranking':
      return (
        <Section title="Options to rank">
          <ListEditor items={field.options ?? []} noun="Option" min={2} max={20} onChange={(next) => onPatch({ options: next }, `options-${field._id}`)} />
          <p className="text-2xs text-fg-muted">People drag (or use Move up / down) to put them in order, best first. Stored as the ordered list.</p>
        </Section>
      )
    case 'image_choice': {
      const options = field.options ?? []
      const images = survey.images ?? {}
      const setImage = (option: string, image: string) => {
        const next = { ...images }
        if (image) next[option] = image; else delete next[option]
        setSurvey({ images: Object.keys(next).length ? next : undefined }, `images-${field._id}`)
      }
      return (
        <Section title="Pictures">
          <ListEditor items={options} noun="Option" min={2} max={24} onChange={(next) => {
            // Carry each option's picture across a rename (same position).
            const moved = Object.fromEntries(next.flatMap((o, i) => { const img = images[options[i]] ?? images[o]; return img ? [[o, img]] : [] }))
            onPatch({ options: next, survey: { ...survey, images: Object.keys(moved).length ? moved : undefined } }, `options-${field._id}`)
          }}
          extra={(option) => {
            const image = images[option] ?? ''
            const icon = image.startsWith('icon:') ? image.slice(5) : image ? 'url' : ''
            return (
              <select aria-label={`Picture for ${option}`} className={cn(inputClass, 'w-24 shrink-0')} value={icon}
                onChange={(e) => setImage(option, e.target.value === 'url' ? (image.startsWith('icon:') ? '' : image) || 'https://' : e.target.value ? `icon:${e.target.value}` : '')}>
                <option value="">No picture</option>
                <option value="url">Image URL…</option>
                {SURVEY_OPTION_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            )
          }} />
          {options.filter((o) => images[o] && !images[o].startsWith('icon:')).map((o) => (
            <div key={o}>
              <Label htmlFor={`${id}-img-${o}`}>Image URL for {o} (https)</Label>
              <input id={`${id}-img-${o}`} className={inputClass} value={images[o]} onChange={(e) => setImage(o, e.target.value)} />
            </div>
          ))}
          <Check checked={survey.multiple === true} onChange={(v) => onPatch({ survey: { ...survey, multiple: v || undefined }, ...(v ? {} : { min: undefined, max: undefined }) })}>People can pick several</Check>
          {survey.multiple && (
            <div className="grid grid-cols-2 gap-1">
              <div>
                <Label htmlFor={`${id}-pmin`}>Choose at least</Label>
                <input id={`${id}-pmin`} type="number" min={0} className={inputClass} value={field.min ?? ''} onChange={(e) => onPatch({ min: num(e.target.value) })} />
              </div>
              <div>
                <Label htmlFor={`${id}-pmax`}>Choose at most</Label>
                <input id={`${id}-pmax`} type="number" min={1} className={inputClass} value={field.max ?? ''} onChange={(e) => onPatch({ max: num(e.target.value) })} />
              </div>
            </div>
          )}
          <Segments label="Cards per row" value={survey.columns ?? 3} options={[{ value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]} onChange={(v) => setSurvey({ columns: v === 3 ? undefined : v as 2 | 4 })} />
          <p className="text-2xs text-fg-muted">The option text is the card&apos;s name for screen readers, so pictures are decorative.</p>
        </Section>
      )
    }
    case 'yes_no_maybe':
      return (
        <Section title="Answers">
          <ListEditor items={surveyOptions(field)} noun="Answer" min={2} max={3} onChange={(next) => onPatch({ options: next }, `options-${field._id}`)} />
          <p className="text-2xs text-fg-muted">Two or three answers shown as one segmented control (rename them, e.g. Agree / Disagree / Not sure).</p>
        </Section>
      )
    default:
      return null
  }
}
