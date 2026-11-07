'use client'

/**
 * The wizard's settings for survey questions (lib/forms/survey/controls.ts),
 * in plain words: how many stars and which symbol; the recommend score's
 * colour bands; a ready-made agreement scale; a grid's statements; a
 * slider's range, step and unit; three or five faces; picture choice icons
 * and "pick several". Kept apart from wizard-steps.tsx so the question
 * card only renders <QuestionSettings />.
 */

import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/ui/field'
import { LIKERT_PRESETS, LIKERT_PRESET_LABELS, SURVEY_OPTION_ICONS, type LikertPreset } from '@/lib/forms/survey/controls'
import { DEFAULT_OPTIONS, type QuestionKind, type WizardQuestion } from '@/lib/forms/wizard/spec'

type Settings = NonNullable<WizardQuestion['settings']>

/** A new question of `kind`: its starting options, statements and settings. */
export function surveyQuestionDefaults(kind: QuestionKind, current?: WizardQuestion): Partial<WizardQuestion> {
  const out: Partial<WizardQuestion> = {}
  const options = DEFAULT_OPTIONS[kind]
  // Choice-like kinds keep the options the question already has; scales start from their own.
  if (options) out.options = current?.options?.length && (kind === 'choice' || kind === 'choices' || kind === 'ranking' || kind === 'image_choice') && current.options.length >= (kind === 'ranking' || kind === 'image_choice' ? 2 : 1) ? current.options : [...options]
  if (kind === 'matrix' && !current?.rows?.length) out.rows = ['Statement 1', 'Statement 2']
  if (kind === 'slider') out.settings = { min: 0, max: 10, step: 1 }
  return out
}

function num(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function presetOf(options: string[]): LikertPreset | '' {
  return (Object.keys(LIKERT_PRESETS) as LikertPreset[]).find((k) => LIKERT_PRESETS[k].length === options.length && LIKERT_PRESETS[k].every((o, i) => o === options[i])) ?? ''
}

export function QuestionSettings({ question: q, onChange }: { question: WizardQuestion; onChange: (patch: Partial<WizardQuestion>) => void }) {
  const settings: Settings = q.settings ?? {}
  const set = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    for (const k of Object.keys(next) as Array<keyof Settings>) if (next[k] === undefined) delete next[k]
    onChange({ settings: Object.keys(next).length ? next : undefined })
  }
  const endLabels = (lowHint: string, highHint: string) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Low end label" optional><Input value={settings.low_label ?? ''} maxLength={60} placeholder={lowHint} onChange={(e) => set({ low_label: e.target.value || undefined })} /></Field>
      <Field label="High end label" optional><Input value={settings.high_label ?? ''} maxLength={60} placeholder={highHint} onChange={(e) => set({ high_label: e.target.value || undefined })} /></Field>
    </div>
  )
  switch (q.kind) {
    case 'rating':
      return (
        <div className="space-y-2" data-testid="wizard-survey-settings">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Out of">
              <Select value={String(settings.max ?? 5)} onChange={(e) => set({ max: Number(e.target.value) === 5 ? undefined : Number(e.target.value) })}
                options={[3, 4, 5, 6, 7, 10].map((n) => ({ value: String(n), label: `${n}` }))} />
            </Field>
            <Field label="Symbol">
              <Select value={settings.icon ?? 'star'} onChange={(e) => set({ icon: e.target.value === 'star' ? undefined : e.target.value as Settings['icon'] })}
                options={[{ value: 'star', label: 'Stars' }, { value: 'heart', label: 'Hearts' }, { value: 'thumb', label: 'Thumbs up' }]} />
            </Field>
          </div>
          <Switch checked={settings.half === true} onCheckedChange={(v) => set({ half: v || undefined })} label="Allow half stars" />
        </div>
      )
    case 'nps':
      return (
        <div className="space-y-2" data-testid="wizard-survey-settings">
          <Switch checked={settings.bands === true} onCheckedChange={(v) => set({ bands: v || undefined })} label="Colour the unhappy (0–6), neutral (7–8) and happy (9–10) scores" />
          {endLabels('Not at all likely', 'Extremely likely')}
        </div>
      )
    case 'likert':
    case 'matrix':
      return (
        <div className="space-y-2" data-testid="wizard-survey-settings">
          {q.kind === 'matrix' && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-fg">Statements (one row each)</legend>
              {(q.rows ?? []).map((r, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input value={r} maxLength={300} aria-label={`Statement ${i + 1}`} onChange={(e) => onChange({ rows: (q.rows ?? []).map((x, j) => (j === i ? e.target.value : x)) })} />
                  <Button size="icon" variant="ghost" aria-label={`Remove statement ${i + 1}`} disabled={(q.rows ?? []).length <= 1} onClick={() => onChange({ rows: (q.rows ?? []).filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" leadingIcon={<Plus />} disabled={(q.rows ?? []).length >= 30} onClick={() => onChange({ rows: [...(q.rows ?? []), `Statement ${(q.rows ?? []).length + 1}`] })}>Add statement</Button>
            </fieldset>
          )}
          <Field label={q.kind === 'matrix' ? 'Answer scale (the columns)' : 'Scale'} description="Pick a ready-made scale, or edit the points below (lowest first).">
            <Select value={presetOf(q.options ?? [])} placeholder="Your own scale"
              onChange={(e) => { const k = e.target.value as LikertPreset; if (k) onChange({ options: [...LIKERT_PRESETS[k]] }) }}
              options={(Object.keys(LIKERT_PRESETS) as LikertPreset[]).map((k) => ({ value: k, label: LIKERT_PRESET_LABELS[k] }))} />
          </Field>
        </div>
      )
    case 'slider':
      return (
        <div className="space-y-2" data-testid="wizard-survey-settings">
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Lowest"><Input type="number" value={settings.min ?? 0} onChange={(e) => set({ min: num(e.target.value) })} /></Field>
            <Field label="Highest"><Input type="number" value={settings.max ?? 100} onChange={(e) => set({ max: num(e.target.value) })} /></Field>
            <Field label="Step"><Input type="number" min={0} value={settings.step ?? 1} onChange={(e) => { const n = num(e.target.value); set({ step: n && n > 0 ? n : undefined }) }} /></Field>
            <Field label="Unit" optional><Input value={settings.unit ?? ''} maxLength={12} placeholder="%" onChange={(e) => set({ unit: e.target.value || undefined })} /></Field>
          </div>
          {endLabels('e.g. Not at all', 'e.g. Completely')}
        </div>
      )
    case 'csat':
      return (
        <div data-testid="wizard-survey-settings">
          <Field label="Faces" className="max-w-48">
            <Select value={String(settings.faces ?? 5)} onChange={(e) => set({ faces: e.target.value === '3' ? 3 : undefined })}
              options={[{ value: '5', label: 'Five faces' }, { value: '3', label: 'Three faces' }]} />
          </Field>
        </div>
      )
    case 'image_choice': {
      const icons = settings.icons ?? {}
      return (
        <div className="space-y-2" data-testid="wizard-survey-settings">
          <Switch checked={settings.multiple === true} onCheckedChange={(v) => set({ multiple: v || undefined })} label="People can pick several" />
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-fg">A picture for each option</legend>
            {(q.options ?? []).map((o) => (
              <div key={o} className="grid grid-cols-[1fr_12rem] items-center gap-2 text-sm">
                <span className="truncate text-fg">{o}</span>
                <Select aria-label={`Picture for ${o}`} value={icons[o] ?? ''} placeholder="No picture"
                  onChange={(e) => {
                    const next = { ...icons }
                    if (e.target.value) next[o] = e.target.value as (typeof SURVEY_OPTION_ICONS)[number]; else delete next[o]
                    set({ icons: Object.keys(next).length ? next : undefined })
                  }}
                  options={[{ value: '', label: 'No picture' }, ...SURVEY_OPTION_ICONS.map((i) => ({ value: i, label: i.replace(/-/g, ' ') }))]} />
              </div>
            ))}
          </fieldset>
        </div>
      )
    }
    default:
      return null
  }
}
