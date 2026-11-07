/**
 * Survey controls: nine built-in field types for questionnaires, feedback
 * and research forms, first-class like Text or Single select (the
 * designer's palette, the form wizard, rules, validation, data tables,
 * reports, CSV, task forms, public forms and embeds).
 *
 *   type          value                    data table column(s)
 *   rating        number (1…max, ½ steps)  number
 *   nps           integer 0…10             number
 *   likert        one of `options` (text)  select (the options, in order)
 *   matrix        { <row key>: <option> }  one select column per row: <key>_<row key>
 *   slider        number (min…max, step)   number
 *   csat          integer 1…faces (3 / 5)  number
 *   ranking       options, best first      text (the ordered list)
 *   image_choice  option, or options[]     select (single) / text (several)
 *   yes_no_maybe  Yes / No / Maybe         select
 *
 * Settings live in the field's `survey` object (SurveyFieldConfig); the
 * scale bounds of rating (max) and slider (min / max) use the field's own
 * `min` / `max`, and every option-based control uses `options` /
 * `option_labels` as Single select does. Pure and isomorphic: the engine,
 * the server's validation, the renderer and the designer share it.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { TaskFieldDef, TaskFieldType } from '@/lib/task-field-schema'

export const SURVEY_FIELD_TYPES = ['rating', 'nps', 'likert', 'matrix', 'slider', 'csat', 'ranking', 'image_choice', 'yes_no_maybe'] as const
export type SurveyFieldType = (typeof SURVEY_FIELD_TYPES)[number]

export const SURVEY_FIELD_LABELS: Record<SurveyFieldType, string> = {
  rating: 'Star rating',
  nps: 'NPS (0 to 10)',
  likert: 'Agreement scale',
  matrix: 'Matrix / grid',
  slider: 'Slider',
  csat: 'Satisfaction faces',
  ranking: 'Ranking',
  image_choice: 'Picture choice',
  yes_no_maybe: 'Yes / No / Maybe',
}

export function isSurveyType(type: unknown): type is SurveyFieldType {
  return typeof type === 'string' && (SURVEY_FIELD_TYPES as readonly string[]).includes(type)
}

/** Survey types whose answers come from `options`. */
export const SURVEY_OPTION_TYPES: ReadonlySet<TaskFieldType> = new Set(['likert', 'matrix', 'ranking', 'image_choice', 'yes_no_maybe'])
/** Survey types that store a number. */
export const SURVEY_NUMBER_TYPES: ReadonlySet<TaskFieldType> = new Set(['rating', 'nps', 'slider', 'csat'])

export const RATING_ICONS = ['star', 'heart', 'thumb'] as const
export type RatingIcon = (typeof RATING_ICONS)[number]

export const SURVEY_LIMITS = { rows: 30, rowLabel: 200, optionLabel: 120, unit: 12, scaleLabel: 60, ratingMax: 10, sliderSpan: 1_000_000 } as const

/** Ready-made scales for the Agreement scale (and the matrix's columns). */
export const LIKERT_PRESETS = {
  agree5: ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'],
  agree7: ['Strongly disagree', 'Disagree', 'Somewhat disagree', 'Neither agree nor disagree', 'Somewhat agree', 'Agree', 'Strongly agree'],
  satisfied5: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
  frequency5: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'],
  importance5: ['Not important', 'Slightly important', 'Moderately important', 'Very important', 'Extremely important'],
  quality5: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'],
} as const
export type LikertPreset = keyof typeof LIKERT_PRESETS
export const LIKERT_PRESET_LABELS: Record<LikertPreset, string> = {
  agree5: 'Agreement (5 points)', agree7: 'Agreement (7 points)', satisfied5: 'Satisfaction (5 points)',
  frequency5: 'Frequency (5 points)', importance5: 'Importance (5 points)', quality5: 'Quality (5 points)',
}

/** The faces' meanings, worst first (value = position, 1-based). */
export const CSAT_LABELS: Record<3 | 5, string[]> = {
  3: ['Unhappy', 'Neutral', 'Happy'],
  5: ['Very unsatisfied', 'Unsatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
}
export const YES_NO_MAYBE = ['Yes', 'No', 'Maybe']

/** Icons a Picture choice option can show instead of an image (lucide names, see components/forms/survey/survey-icons.tsx). */
export const SURVEY_OPTION_ICONS = [
  'smile', 'frown', 'meh', 'heart', 'star', 'thumbs-up', 'thumbs-down', 'coffee', 'pizza', 'utensils', 'salad', 'cake',
  'car', 'bike', 'bus', 'train', 'plane', 'footprints', 'home', 'building', 'briefcase', 'laptop', 'smartphone', 'monitor',
  'book', 'graduation-cap', 'music', 'camera', 'film', 'gamepad', 'dumbbell', 'trophy', 'gift', 'shopping-cart', 'mail',
  'phone', 'message-circle', 'video', 'users', 'user', 'globe', 'map-pin', 'calendar', 'clock', 'sun', 'moon', 'cloud',
  'leaf', 'tree', 'flower', 'dog', 'cat', 'zap', 'shield', 'lock', 'wrench', 'lightbulb', 'rocket', 'palette', 'check', 'x',
] as const
export type SurveyOptionIcon = (typeof SURVEY_OPTION_ICONS)[number]

export interface MatrixRow { key: string; label: string }

export interface SurveyFieldConfig {
  /** rating: the symbol (default star). */
  icon?: RatingIcon
  /** rating: half steps (0.5, 1, 1.5 …). */
  half?: boolean
  /** nps / slider / rating: words at the low and high ends ("Not likely" … "Very likely"). */
  low_label?: string
  high_label?: string
  /** nps: colour the detractor (0–6) / passive (7–8) / promoter (9–10) bands. */
  bands?: boolean
  /** slider: the step (default 1). */
  step?: number
  /** slider: a unit after the value ("kg", "%", "hours"). */
  unit?: string
  /** slider: don't show the value beside the track. */
  hide_value?: boolean
  /** csat: 3 or 5 faces (default 5). */
  faces?: 3 | 5
  /** matrix: the statements (rows); the columns are the field's `options`. */
  rows?: MatrixRow[]
  /** image_choice: pick several (the value is a list). */
  multiple?: boolean
  /** image_choice: per option, `icon:<name>` (SURVEY_OPTION_ICONS) or an https / site-relative image URL. */
  images?: Record<string, string>
  /** image_choice: cards per row on wide screens (default 3). */
  columns?: 2 | 3 | 4
}

/* ── Normalising ─────────────────────────────────────────────────────── */

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

function finite(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** snake_case row key from a label (a matrix row's column suffix). */
export function matrixRowKey(label: string): string {
  return String(label ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

/** An option image: `icon:<known icon>`, an https URL or a site-relative path; anything else is dropped. */
export function cleanOptionImage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  if (!s || s.length > 2000) return undefined
  if (s.startsWith('icon:')) return (SURVEY_OPTION_ICONS as readonly string[]).includes(s.slice(5)) ? s : undefined
  if (/^\/(?!\/)[^\s"'<>\\]*$/.test(s)) return s
  try {
    const url = new URL(s)
    return url.protocol === 'https:' && !/["'<>\s\\]/.test(s) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export function normalizeMatrixRows(raw: unknown): MatrixRow[] {
  if (!Array.isArray(raw)) return []
  const rows: MatrixRow[] = []
  const used = new Set<string>()
  for (const entry of raw) {
    const label = cleanText(isPlainObject(entry) ? entry.label ?? entry.key : entry, SURVEY_LIMITS.rowLabel)
    if (!label) continue
    let key = matrixRowKey(isPlainObject(entry) && typeof entry.key === 'string' && entry.key.trim() ? entry.key : label) || `row_${rows.length + 1}`
    if (!/^[a-z0-9]/.test(key)) key = `row_${key}`
    let unique = key
    for (let i = 2; used.has(unique); i++) unique = `${key}_${i}`
    used.add(unique)
    rows.push({ key: unique, label })
    if (rows.length >= SURVEY_LIMITS.rows) break
  }
  return rows
}

/**
 * A survey field's settings, cleaned for its type (settings of other types
 * dropped); undefined when nothing is set. Called by normalizeTaskFields.
 */
export function normalizeSurveyConfig(type: SurveyFieldType, raw: unknown, options: string[] = []): SurveyFieldConfig | undefined {
  const r = isPlainObject(raw) ? raw : {}
  const out: SurveyFieldConfig = {}
  const labels = () => {
    const low = cleanText(r.low_label, SURVEY_LIMITS.scaleLabel)
    const high = cleanText(r.high_label, SURVEY_LIMITS.scaleLabel)
    if (low) out.low_label = low
    if (high) out.high_label = high
  }
  switch (type) {
    case 'rating':
      if ((RATING_ICONS as readonly string[]).includes(String(r.icon))) out.icon = r.icon as RatingIcon
      if (r.half === true) out.half = true
      labels()
      break
    case 'nps':
      labels()
      if (r.bands === true) out.bands = true
      break
    case 'slider': {
      const step = finite(r.step)
      if (step !== undefined && step > 0 && step <= SURVEY_LIMITS.sliderSpan) out.step = step
      const unit = cleanText(r.unit, SURVEY_LIMITS.unit)
      if (unit) out.unit = unit
      if (r.hide_value === true) out.hide_value = true
      labels()
      break
    }
    case 'csat':
      if (Number(r.faces) === 3) out.faces = 3
      break
    case 'matrix': {
      const rows = normalizeMatrixRows(r.rows)
      if (rows.length) out.rows = rows
      break
    }
    case 'image_choice': {
      if (r.multiple === true) out.multiple = true
      const columns = Number(r.columns)
      if (columns === 2 || columns === 4) out.columns = columns
      if (isPlainObject(r.images)) {
        const images: Record<string, string> = {}
        for (const option of options) {
          const image = cleanOptionImage(r.images[option])
          if (image) images[option] = image
        }
        if (Object.keys(images).length) out.images = images
      }
      break
    }
    default:
      break
  }
  return Object.keys(out).length ? out : undefined
}

/** What a new field of a survey type starts with (the designer's palette and the type switcher). */
export function surveyFieldDefaults(type: SurveyFieldType): Partial<TaskFieldDef> {
  switch (type) {
    case 'rating': return { max: 5 }
    case 'nps': return { survey: { low_label: 'Not at all likely', high_label: 'Extremely likely' } }
    case 'likert': return { options: [...LIKERT_PRESETS.agree5] }
    case 'matrix': return { options: [...LIKERT_PRESETS.quality5], survey: { rows: [{ key: 'quality', label: 'Quality' }, { key: 'value_for_money', label: 'Value for money' }, { key: 'service', label: 'Service' }] } }
    case 'slider': return { min: 0, max: 100, survey: { step: 1 } }
    case 'csat': return {}
    case 'ranking': return { options: ['Price', 'Quality', 'Speed', 'Support'] }
    case 'image_choice': return { options: ['Coffee', 'Tea', 'Juice'], survey: { images: { Coffee: 'icon:coffee', Tea: 'icon:leaf', Juice: 'icon:salad' } } }
    case 'yes_no_maybe': return { options: [...YES_NO_MAYBE] }
  }
}

/* ── Scales ──────────────────────────────────────────────────────────── */

export interface SurveyScale { min: number; max: number; step: number }

/** The numeric scale of a number-valued survey control (null for the others). */
export function surveyScale(field: Pick<TaskFieldDef, 'type' | 'min' | 'max' | 'survey'>): SurveyScale | null {
  switch (field.type) {
    case 'rating': {
      const max = Math.round(Math.min(SURVEY_LIMITS.ratingMax, Math.max(2, field.max ?? 5)))
      return field.survey?.half ? { min: 0.5, max, step: 0.5 } : { min: 1, max, step: 1 }
    }
    case 'nps': return { min: 0, max: 10, step: 1 }
    case 'csat': return { min: 1, max: field.survey?.faces === 3 ? 3 : 5, step: 1 }
    case 'slider': {
      const min = field.min ?? 0
      const max = field.max !== undefined && field.max > min ? field.max : min + 100
      const step = field.survey?.step && field.survey.step > 0 ? field.survey.step : 1
      return { min, max, step }
    }
    default: return null
  }
}

/** Every point of an integer-ish scale (rating, NPS, CSAT; a slider's points only when there are ≤ 101). */
export function scalePoints(scale: SurveyScale): number[] {
  const count = Math.floor((scale.max - scale.min) / scale.step + 1e-9) + 1
  if (count > 101) return []
  return Array.from({ length: count }, (_, i) => roundTo(scale.min + i * scale.step, scale.step))
}

function decimals(step: number): number {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : Math.min(6, s.length - i - 1)
}

/** A value rounded to the step's precision (0.1 + 0.2 → 0.3). */
export function roundTo(value: number, step: number): number {
  return Number(value.toFixed(decimals(step)))
}

/** The nearest value on the scale (clamped). */
export function snapToScale(value: number, scale: SurveyScale): number {
  const clamped = Math.min(scale.max, Math.max(scale.min, value))
  return roundTo(scale.min + Math.round((clamped - scale.min) / scale.step) * scale.step, scale.step)
}

/** NPS band of a score. */
export function npsBand(score: number): 'detractor' | 'passive' | 'promoter' {
  return score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor'
}

/** The faces' labels for a CSAT field. */
export function csatLabels(field: Pick<TaskFieldDef, 'survey'>): string[] {
  return CSAT_LABELS[field.survey?.faces === 3 ? 3 : 5]
}

/** Whether a CSAT score counts as satisfied (the top two of five, the top one of three). */
export function csatSatisfied(score: number, faces: 3 | 5): boolean {
  return faces === 3 ? score >= 3 : score >= 4
}

/** The options of an option-based survey control (yes_no_maybe falls back to Yes / No / Maybe). */
export function surveyOptions(field: Pick<TaskFieldDef, 'type' | 'options'>): string[] {
  const options = field.options ?? []
  if (field.type === 'yes_no_maybe' && !options.length) return [...YES_NO_MAYBE]
  return options
}

export function matrixRows(field: Pick<TaskFieldDef, 'survey'>): MatrixRow[] {
  return field.survey?.rows ?? []
}

/** Image choice holding a list. */
export function isMultiSurvey(field: Pick<TaskFieldDef, 'type' | 'survey'>): boolean {
  return field.type === 'ranking' || (field.type === 'image_choice' && field.survey?.multiple === true)
}

/* ── Values ──────────────────────────────────────────────────────────── */

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value ?? '').trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
      } catch { /* a comma list */ }
    }
    return s.split(',').map((v) => v.trim()).filter(Boolean)
  }
  return value === undefined || value === null ? [] : [String(value)]
}

/** A matrix answer as { row key: option } (an object, or its JSON text); anything else → {}. */
export function matrixValue(value: unknown): Record<string, string> {
  let raw = value
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try { raw = JSON.parse(raw) } catch { raw = null }
  }
  if (!isPlainObject(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (v === null || v === undefined || typeof v === 'object') continue
    const s = String(v).trim()
    if (s) out[k] = s
  }
  return out
}

/** Whether a survey value is empty (not answered). */
export function isBlankSurveyValue(field: Pick<TaskFieldDef, 'type' | 'survey'>, value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (field.type === 'matrix') return Object.keys(matrixValue(value)).length === 0
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'string' && value.trim() === ''
}

/** Validation of a non-blank survey value (null = fine). `required` adds the matrix's "every row" check. */
export function surveyValueError(field: TaskFieldDef, value: unknown, required = false): string | null {
  const label = field.label
  const scale = surveyScale(field)
  if (scale) {
    if (typeof value === 'object') return `${label} has an invalid value`
    const n = toNumber(value)
    if (n === null) return `${label} must be a number`
    if (n < scale.min || n > scale.max) return `${label} must be between ${scale.min} and ${scale.max}`
    const steps = (n - scale.min) / scale.step
    if (Math.abs(steps - Math.round(steps)) > 1e-6) return `${label} must be in steps of ${scale.step}`
    return null
  }
  const options = surveyOptions(field)
  switch (field.type) {
    case 'matrix': {
      if (typeof value === 'string' && !value.trim().startsWith('{')) return `${label} has an invalid value`
      if (typeof value !== 'string' && !isPlainObject(value)) return `${label} has an invalid value`
      const answers = matrixValue(value)
      const rows = matrixRows(field)
      const known = new Set(rows.map((r) => r.key))
      for (const [row, answer] of Object.entries(answers)) {
        if (!known.has(row)) return `${label}: "${row}" is not one of its rows`
        if (!options.includes(answer)) return `${label}: answer each row with one of: ${options.join(', ')}`
      }
      if (required) {
        const missing = rows.filter((r) => !answers[r.key])
        if (missing.length) return `${label}: answer every row (${missing.slice(0, 3).map((r) => r.label).join(', ')}${missing.length > 3 ? '…' : ''})`
      }
      return null
    }
    case 'ranking': {
      if (typeof value === 'object' && !Array.isArray(value)) return `${label} has an invalid value`
      const list = toList(value)
      if (new Set(list).size !== list.length) return `${label}: each option can only be ranked once`
      const bad = list.find((v) => !options.includes(v))
      if (bad !== undefined) return `${label}: "${bad.slice(0, 60)}" is not one of its options`
      if (list.length !== options.length) return `${label}: rank all ${options.length} options`
      return null
    }
    case 'image_choice': {
      if (field.survey?.multiple) {
        if (typeof value === 'object' && !Array.isArray(value)) return `${label} has an invalid value`
        const list = toList(value)
        const bad = list.find((v) => !options.includes(v))
        if (bad !== undefined) return `${label} must be from: ${options.join(', ')}`
        if (new Set(list).size !== list.length) return `${label}: each option can only be picked once`
        if (field.min !== undefined && list.length < field.min) return `${label}: choose at least ${field.min}`
        if (field.max !== undefined && list.length > field.max) return `${label}: choose at most ${field.max}`
        return null
      }
      break
    }
    default:
      break
  }
  // likert, yes_no_maybe, single image_choice: one of the options.
  if (typeof value === 'object') return `${label} has an invalid value`
  const s = String(value).trim()
  return options.includes(s) ? null : `${label} must be one of: ${options.join(', ')}`
}

/** A submitted survey value in its stored type (call after validation). */
export function coerceSurveyValue(field: TaskFieldDef, value: unknown): string | number | string[] | Record<string, string> | null {
  if (field.type === 'matrix') {
    const answers = matrixValue(value)
    const known = new Set(matrixRows(field).map((r) => r.key))
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(answers)) if (known.has(k)) out[k] = v
    return Object.keys(out).length ? out : null
  }
  if (isMultiSurvey(field)) return toList(value)
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null
  if (SURVEY_NUMBER_TYPES.has(field.type)) return toNumber(value)
  return typeof value === 'string' ? value.trim() : String(value)
}

/** The value as text for people (read-only views, emails, CSV cells of single-value controls). */
export function formatSurveyValue(field: TaskFieldDef, value: unknown): string {
  if (isBlankSurveyValue(field, value)) return '—'
  const label = (v: string) => field.option_labels?.[v] ?? v
  switch (field.type) {
    case 'rating': {
      const scale = surveyScale(field)!
      return `${toNumber(value) ?? String(value)} / ${scale.max}`
    }
    case 'nps': return `${toNumber(value) ?? String(value)} / 10`
    case 'csat': {
      const n = toNumber(value)
      const text = n !== null ? csatLabels(field)[Math.round(n) - 1] : undefined
      return text ? `${text} (${n})` : String(value)
    }
    case 'slider': {
      const n = toNumber(value)
      return `${n === null ? String(value) : n.toLocaleString()}${field.survey?.unit ? ` ${field.survey.unit}` : ''}`
    }
    case 'matrix': {
      const answers = matrixValue(value)
      return matrixRows(field).filter((r) => answers[r.key]).map((r) => `${r.label}: ${label(answers[r.key])}`).join('; ') || '—'
    }
    case 'ranking': return toList(value).map((v, i) => `${i + 1}. ${label(v)}`).join(', ')
    case 'image_choice': return toList(value).map(label).join(', ')
    default: return label(String(value))
  }
}

/* ── Configuration problems (the designer flags them; saving keeps them) ─ */

export function surveyConfigProblem(field: TaskFieldDef): string | null {
  const options = surveyOptions(field)
  if (SURVEY_OPTION_TYPES.has(field.type) && options.length < 2) {
    return field.type === 'matrix' ? 'Add at least two columns (the scale)' : 'Add at least two options'
  }
  if (field.type === 'matrix' && !matrixRows(field).length) return 'Add at least one row (statement)'
  if (field.type === 'yes_no_maybe' && options.length > 3) return 'Yes / No / Maybe has at most three answers'
  if (field.type === 'likert' && options.length > 11) return 'An agreement scale has at most 11 points'
  if (field.type === 'slider') {
    const min = field.min ?? 0
    const max = field.max ?? 100
    if (max <= min) return 'The maximum must be greater than the minimum'
    if (max - min > SURVEY_LIMITS.sliderSpan) return 'The slider spans too much (at most 1,000,000)'
    const step = field.survey?.step ?? 1
    if (step > max - min) return 'The step is larger than the range'
  }
  if (field.type === 'rating' && field.max !== undefined && (field.max < 2 || field.max > SURVEY_LIMITS.ratingMax)) return `A rating goes up to between 2 and ${SURVEY_LIMITS.ratingMax}`
  return null
}

/* ── Data tables, CSV and workflow mapping ───────────────────────────── */

export interface SurveyColumn {
  key: string
  name: string
  /** Data table column type (custom_tables): number, select, text. */
  type: 'number' | 'select' | 'text'
  options?: string[]
  /** The submission path that fills it (form.<path>). */
  path: string
}

/**
 * The data table columns a survey field maps to: one for most controls; a
 * matrix gets one select column per row (`<key>_<row key>`, "Label: Row"),
 * so reports group and count every statement like any other choice.
 */
export function surveyColumns(field: TaskFieldDef, name = field.label): SurveyColumn[] {
  switch (field.type) {
    case 'rating': case 'nps': case 'slider': case 'csat':
      return [{ key: field.key, name, type: 'number', path: field.key }]
    case 'matrix':
      return matrixRows(field).map((r) => ({ key: `${field.key}_${r.key}`, name: `${name}: ${r.label}`.slice(0, 100), type: 'select', options: surveyOptions(field), path: `${field.key}.${r.key}` }))
    case 'ranking':
      return [{ key: field.key, name, type: 'text', path: field.key }]
    case 'image_choice':
      return field.survey?.multiple ? [{ key: field.key, name, type: 'text', path: field.key }] : [{ key: field.key, name, type: 'select', options: surveyOptions(field), path: field.key }]
    default:
      return [{ key: field.key, name, type: 'select', options: surveyOptions(field), path: field.key }]
  }
}

/** CSV columns of a survey field: a matrix gets one per row (`<key>.<row key>`), a ranking "A > B > C". */
export function surveyCsvColumns(field: TaskFieldDef): Array<{ header: string; cell: (values: Record<string, unknown>) => unknown }> {
  if (field.type === 'matrix') {
    return matrixRows(field).map((r) => ({ header: `${field.key}.${r.key}`, cell: (values) => matrixValue(values[field.key])[r.key] ?? '' }))
  }
  if (field.type === 'ranking') return [{ header: field.key, cell: (values) => toList(values[field.key]).join(' > ') }]
  if (isMultiSurvey(field)) return [{ header: field.key, cell: (values) => toList(values[field.key]).join(', ') }]
  return [{ header: field.key, cell: (values) => values[field.key] ?? '' }]
}

/** Matrix row values a rule / condition can test: `<key>.<row key>` with the row's label. */
export function surveyConditionSubjects(field: TaskFieldDef): Array<{ value: string; label: string }> {
  if (field.type !== 'matrix') return []
  return matrixRows(field).map((r) => ({ value: `${field.key}.${r.key}`, label: `${field.label || field.key}: ${r.label}` }))
}
