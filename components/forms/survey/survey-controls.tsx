'use client'

/**
 * The survey controls as people fill them in (lib/forms/survey/controls.ts):
 * star rating, NPS, agreement scale, matrix, slider, satisfaction faces,
 * ranking, picture choice and Yes / No / Maybe. Shared by every form surface
 * through components/forms/form-renderer.tsx (task forms, standalone and
 * public forms, embeds, the designer preview and the wizard preview).
 *
 * Accessibility: each single-answer scale is a radiogroup of buttons with
 * role="radio" and a roving tabindex (Tab enters at the chosen point, the
 * arrow keys move and choose, Home / End jump), labelled by the field label
 * and described by its help / error. Targets are at least 44px (half-star
 * halves 22px, spaced inside a 44px star). The matrix is one radiogroup per
 * statement; the ranking is a list with Move up / Move down buttons (and
 * drag with a pointer), announcing each move. Colours are form theme tokens
 * (--theme-primary, --theme-on-primary, --theme-surface-border,
 * --theme-card-text, --theme-muted-text and the status colours), so form
 * themes and dark mode apply. `readOnly` (a rule's Make read only) keeps
 * the answer visible and focusable but unchangeable; `disabled` (the field's
 * Read-only) greys it out.
 */

import { useRef, useState, type KeyboardEvent } from 'react'
import { Angry, ArrowDown, ArrowUp, Frown, GripVertical, Heart, Laugh, Meh, Smile, Star, ThumbsUp, type LucideIcon } from 'lucide-react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import {
  csatLabels, formatSurveyValue, isBlankSurveyValue, matrixRows, matrixValue, npsBand, scalePoints, snapToScale, surveyOptions, surveyScale,
  type RatingIcon,
} from '@/lib/forms/survey/controls'
import { OptionPicture } from './survey-icons'
import { cn } from '@/lib/utils'

export interface SurveyControlProps {
  field: TaskFieldDef
  value: unknown
  onChange: (value: unknown) => void
  id: string
  describedBy?: string
  invalid?: boolean
  /** The field's Read-only: greyed out. */
  disabled?: boolean
  /** Read only by a rule: visible and focusable, not changeable. */
  readOnly?: boolean
}

const BORDER = 'var(--theme-surface-border)'
const INVALID = 'var(--status-blocked)'
const ON = { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } as const
const offStyle = (invalid?: boolean) => ({ borderColor: invalid ? INVALID : BORDER, color: 'var(--theme-card-text)' })

function optionText(field: TaskFieldDef, option: string): string {
  return field.option_labels?.[option] ?? option
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v.trim()) {
    try { const parsed = JSON.parse(v); if (Array.isArray(parsed)) return parsed.map(String) } catch { /* comma list */ }
    return v.split(',').map((x) => x.trim()).filter(Boolean)
  }
  return []
}

/* ── Roving radio group ──────────────────────────────────────────────── */

/**
 * Keyboard and focus for a group of role="radio" buttons: one tab stop
 * (the chosen item, else the first), arrows move and choose (wrapping),
 * Home / End. Read only: arrows move focus without choosing.
 */
function useRadioGroup(count: number, selected: number, choose: (index: number) => void, readOnly?: boolean) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const onKeyDown = (event: KeyboardEvent, index: number) => {
    let next: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % count
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + count) % count
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    if (next === null) return
    event.preventDefault()
    refs.current[next]?.focus()
    if (!readOnly) choose(next)
  }
  const itemProps = (index: number) => ({
    ref: (el: HTMLButtonElement | null) => { refs.current[index] = el },
    role: 'radio' as const,
    type: 'button' as const,
    'aria-checked': index === selected,
    tabIndex: index === (selected >= 0 ? selected : 0) ? 0 : -1,
    onKeyDown: (e: KeyboardEvent) => onKeyDown(e, index),
  })
  return { itemProps }
}

function groupProps(p: SurveyControlProps, extra?: { labelledBy?: string }) {
  return {
    id: p.id,
    role: 'radiogroup' as const,
    'aria-labelledby': extra?.labelledBy ?? `${p.id}-label`,
    'aria-describedby': p.describedBy,
    'aria-required': (p.field.required && !p.readOnly) || undefined,
    'aria-invalid': p.invalid || undefined,
    'aria-readonly': p.readOnly || undefined,
    'aria-disabled': p.disabled || undefined,
    ...(p.readOnly ? { 'data-read-only': '' } : {}),
  }
}

/** "Clear" for an optional answer (radios can't be unticked). */
function ClearButton({ p, label = 'Clear answer' }: { p: SurveyControlProps; label?: string }) {
  if (p.field.required || p.readOnly || p.disabled || isBlankSurveyValue(p.field, p.value)) return null
  return (
    <button type="button" onClick={() => p.onChange(p.field.type === 'ranking' || (p.field.type === 'image_choice' && p.field.survey?.multiple) ? [] : null)}
      className="mt-1 block min-h-6 rounded px-1 text-2xs font-medium text-fg-muted underline-offset-2 hover:text-fg hover:underline" data-survey-clear>
      {label}
    </button>
  )
}

function EndLabels({ low, high, className }: { low?: string; high?: string; className?: string }) {
  if (!low && !high) return null
  return (
    <div className={cn('mt-1 flex justify-between gap-3 text-2xs text-fg-muted', className)} aria-hidden>
      <span>{low}</span>
      <span className="text-right">{high}</span>
    </div>
  )
}

/* ── Star rating ─────────────────────────────────────────────────────── */

const RATING_ICON: Record<RatingIcon, LucideIcon> = { star: Star, heart: Heart, thumb: ThumbsUp }
const RATING_COLOR: Record<RatingIcon, string> = { star: 'var(--theme-warning)', heart: 'var(--theme-danger)', thumb: 'var(--theme-primary)' }
const RATING_NOUN: Record<RatingIcon, [string, string]> = { star: ['star', 'stars'], heart: ['heart', 'hearts'], thumb: ['thumb', 'thumbs'] }

/** One rating symbol, filled to `fill` (0, 0.5 or 1). */
function RatingGlyph({ icon, fill, size = 28 }: { icon: RatingIcon; fill: number; size?: number }) {
  const Icon = RATING_ICON[icon]
  const color = RATING_COLOR[icon]
  return (
    <span className="relative inline-block" style={{ width: size, height: size }} aria-hidden>
      <Icon size={size} strokeWidth={1.5} style={{ color: 'var(--theme-muted-text)' }} className="absolute inset-0" />
      {fill > 0 && (
        <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
          <Icon size={size} strokeWidth={1.5} style={{ color, fill: color }} />
        </span>
      )}
    </span>
  )
}

export function RatingControl(p: SurveyControlProps) {
  const { field } = p
  const scale = surveyScale(field)!
  const icon = field.survey?.icon ?? 'star'
  const points = scalePoints(scale)
  const current = num(p.value)
  const [hover, setHover] = useState<number | null>(null)
  const selected = current === null ? -1 : points.indexOf(current)
  const choose = (i: number) => p.onChange(points[i])
  const { itemProps } = useRadioGroup(points.length, selected, choose, p.readOnly)
  const shown = hover ?? current ?? 0
  const [one, many] = RATING_NOUN[icon]
  const whole = Array.from({ length: scale.max }, (_, i) => i + 1)
  const interactive = !p.readOnly && !p.disabled
  return (
    <div>
      <div {...groupProps(p)} className={cn('flex flex-wrap items-center', p.disabled && 'opacity-60')} onPointerLeave={() => setHover(null)} data-survey="rating">
        {whole.map((n) => {
          const fill = shown >= n ? 1 : shown >= n - 0.5 ? 0.5 : 0
          const halves = field.survey?.half ? [n - 0.5, n] : [n]
          return (
            <span key={n} className="relative inline-flex size-11 items-center justify-center">
              <RatingGlyph icon={icon} fill={fill} />
              <span className="absolute inset-0 flex">
                {halves.map((point) => {
                  const i = points.indexOf(point)
                  return (
                    <button key={point} {...itemProps(i)} aria-label={`${point} ${point === 1 ? one : many} out of ${scale.max}`}
                      disabled={p.disabled}
                      onClick={() => { if (!p.readOnly) choose(i) }}
                      onPointerEnter={() => { if (interactive) setHover(point) }}
                      onFocus={() => { if (interactive) setHover(null) }}
                      className={cn('h-full flex-1 rounded-md bg-transparent', p.readOnly ? 'cursor-default' : 'cursor-pointer')} data-value={point} />
                  )
                })}
              </span>
            </span>
          )
        })}
        <span className="ml-2 min-w-10 text-sm tabular-nums text-fg-muted" aria-hidden>{current !== null ? `${current} / ${scale.max}` : ''}</span>
      </div>
      <EndLabels low={field.survey?.low_label} high={field.survey?.high_label} className="max-w-[min(100%,28rem)]" />
      <ClearButton p={p} />
    </div>
  )
}

/* ── NPS ─────────────────────────────────────────────────────────────── */

const BAND_COLOR = { detractor: 'var(--theme-danger)', passive: 'var(--theme-warning)', promoter: 'var(--theme-success)' } as const

export function NpsControl(p: SurveyControlProps) {
  const { field } = p
  const points = Array.from({ length: 11 }, (_, i) => i)
  const current = num(p.value)
  const selected = current === null ? -1 : points.indexOf(Math.round(current))
  const choose = (i: number) => p.onChange(points[i])
  const { itemProps } = useRadioGroup(points.length, selected, choose, p.readOnly)
  const low = field.survey?.low_label ?? 'Not at all likely'
  const high = field.survey?.high_label ?? 'Extremely likely'
  return (
    <div className="max-w-[40rem]">
      <div {...groupProps(p)} className={cn('grid grid-cols-6 gap-1.5 sm:grid-cols-11', p.disabled && 'opacity-60')} data-survey="nps">
        {points.map((n, i) => {
          const on = i === selected
          const band = npsBand(n)
          return (
            <button key={n} {...itemProps(i)} disabled={p.disabled}
              aria-label={`${n}${n === 0 ? ` (${low})` : n === 10 ? ` (${high})` : ''}`}
              onClick={() => { if (!p.readOnly) choose(i) }}
              className={cn('relative flex min-h-11 min-w-11 items-center justify-center overflow-hidden rounded-md border text-sm font-medium tabular-nums transition-colors', p.readOnly ? 'cursor-default' : 'hover:bg-subtle')}
              style={on ? ON : offStyle(p.invalid)} data-value={n}>
              {n}
              {field.survey?.bands && <span aria-hidden className="absolute inset-x-0 bottom-0 h-1" style={{ backgroundColor: BAND_COLOR[band] }} />}
            </button>
          )
        })}
      </div>
      <EndLabels low={`0 · ${low}`} high={`${high} · 10`} />
      <ClearButton p={p} />
    </div>
  )
}

/* ── Agreement scale (Likert) and Yes / No / Maybe ───────────────────── */

export function LikertControl(p: SurveyControlProps) {
  const options = surveyOptions(p.field)
  const current = typeof p.value === 'string' ? p.value : p.value == null ? '' : String(p.value)
  const selected = options.indexOf(current)
  const choose = (i: number) => p.onChange(options[i])
  const { itemProps } = useRadioGroup(options.length, selected, choose, p.readOnly)
  return (
    <div>
      <div {...groupProps(p)} className={cn('flex flex-col gap-1.5 sm:grid sm:gap-1', p.disabled && 'opacity-60')}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} data-survey="likert">
        {options.map((o, i) => {
          const on = i === selected
          return (
            <button key={o} {...itemProps(i)} disabled={p.disabled} onClick={() => { if (!p.readOnly) choose(i) }}
              className={cn('flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-left text-xs sm:flex-col sm:justify-start sm:px-1.5 sm:text-center', p.readOnly ? 'cursor-default' : 'hover:bg-subtle')}
              style={on ? ON : offStyle(p.invalid)} data-value={o}>
              <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: on ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
                {on && <span className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-on-primary)' }} />}
              </span>
              <span className="leading-tight">{optionText(p.field, o)}</span>
            </button>
          )
        })}
      </div>
      <ClearButton p={p} />
    </div>
  )
}

export function SegmentedControl(p: SurveyControlProps) {
  const options = surveyOptions(p.field)
  const current = p.value == null ? '' : String(p.value)
  const selected = options.indexOf(current)
  const choose = (i: number) => p.onChange(options[i])
  const { itemProps } = useRadioGroup(options.length, selected, choose, p.readOnly)
  return (
    <div>
      <div {...groupProps(p)} className={cn('inline-flex max-w-full overflow-hidden rounded-lg border', p.disabled && 'opacity-60')}
        style={{ borderColor: p.invalid ? INVALID : BORDER }} data-survey="yes_no_maybe">
        {options.map((o, i) => {
          const on = i === selected
          return (
            <button key={o} {...itemProps(i)} disabled={p.disabled} onClick={() => { if (!p.readOnly) choose(i) }}
              className={cn('min-h-11 min-w-20 px-4 text-sm font-medium', i > 0 && 'border-l', p.readOnly ? 'cursor-default' : 'hover:bg-subtle')}
              style={on ? { ...ON, borderLeftColor: BORDER } : { borderColor: BORDER, color: 'var(--theme-card-text)' }} data-value={o}>
              {optionText(p.field, o)}
            </button>
          )
        })}
      </div>
      <ClearButton p={p} />
    </div>
  )
}

/* ── Satisfaction faces (CSAT) ───────────────────────────────────────── */

const FACES: Record<3 | 5, LucideIcon[]> = { 3: [Frown, Meh, Smile], 5: [Angry, Frown, Meh, Smile, Laugh] }

export function CsatControl(p: SurveyControlProps) {
  const faces: 3 | 5 = p.field.survey?.faces === 3 ? 3 : 5
  const labels = csatLabels(p.field)
  const current = num(p.value)
  const selected = current === null ? -1 : Math.round(current) - 1
  const choose = (i: number) => p.onChange(i + 1)
  const { itemProps } = useRadioGroup(faces, selected, choose, p.readOnly)
  return (
    <div>
      <div {...groupProps(p)} className={cn('flex flex-wrap gap-1.5', p.disabled && 'opacity-60')} data-survey="csat">
        {FACES[faces].map((Face, i) => {
          const on = i === selected
          return (
            <button key={i} {...itemProps(i)} disabled={p.disabled} aria-label={labels[i]} onClick={() => { if (!p.readOnly) choose(i) }}
              className={cn('flex min-h-11 w-[4.5rem] flex-col items-center gap-1 rounded-lg border px-1 py-2 text-2xs leading-tight', p.readOnly ? 'cursor-default' : 'hover:bg-subtle')}
              style={on ? ON : offStyle(p.invalid)} data-value={i + 1}>
              <Face size={28} strokeWidth={1.6} aria-hidden />
              <span>{labels[i]}</span>
            </button>
          )
        })}
      </div>
      <ClearButton p={p} />
    </div>
  )
}

/* ── Slider ──────────────────────────────────────────────────────────── */

export function SliderControl(p: SurveyControlProps) {
  const { field } = p
  const scale = surveyScale(field)!
  const current = num(p.value)
  const unit = field.survey?.unit
  const shown = current ?? snapToScale((scale.min + scale.max) / 2, scale)
  const text = (n: number) => `${n.toLocaleString()}${unit ? ` ${unit}` : ''}`
  return (
    <div className={cn('max-w-[36rem]', p.disabled && 'opacity-60')} data-survey="slider">
      <div className="flex items-center gap-3">
        <input
          id={p.id}
          type="range"
          min={scale.min}
          max={scale.max}
          step={scale.step}
          value={shown}
          disabled={p.disabled}
          aria-labelledby={`${p.id}-label`}
          aria-describedby={p.describedBy}
          aria-invalid={p.invalid || undefined}
          aria-required={(field.required && !p.readOnly) || undefined}
          aria-readonly={p.readOnly || undefined}
          aria-valuetext={current === null ? 'Not answered yet' : text(current)}
          {...(p.readOnly ? { 'data-read-only': '' } : {})}
          onChange={(e) => { if (!p.readOnly) p.onChange(snapToScale(Number(e.target.value), scale)) }}
          // A click on the track without moving still answers (the thumb sits in the middle until then).
          onPointerUp={(e) => { if (!p.readOnly && current === null) p.onChange(snapToScale(Number((e.target as HTMLInputElement).value), scale)) }}
          className={cn('h-11 w-full cursor-pointer accent-primary', current === null && 'opacity-50', p.readOnly && 'cursor-default')}
          style={{ accentColor: 'var(--theme-primary)' }}
        />
        {!field.survey?.hide_value && (
          <output htmlFor={p.id} className="min-w-16 rounded-md border px-2 py-1 text-center text-sm tabular-nums" style={offStyle(p.invalid)} aria-hidden>
            {current === null ? '—' : text(current)}
          </output>
        )}
      </div>
      <EndLabels low={field.survey?.low_label ?? text(scale.min)} high={field.survey?.high_label ?? text(scale.max)} className={field.survey?.hide_value ? '' : 'mr-[4.75rem]'} />
      <ClearButton p={p} />
    </div>
  )
}

/* ── Matrix ──────────────────────────────────────────────────────────── */

function MatrixRowGroup({ p, rowKey, rowLabel, columns, answer, onAnswer, index, template }: {
  p: SurveyControlProps; rowKey: string; rowLabel: string; columns: string[]; answer: string | undefined; onAnswer: (value: string) => void; index: number; template: string
}) {
  const selected = answer ? columns.indexOf(answer) : -1
  const { itemProps } = useRadioGroup(columns.length, selected, (i) => onAnswer(columns[i]), p.readOnly)
  const labelId = `${p.id}-row-${rowKey}`
  return (
    <div className={cn('grid gap-1.5 py-2 sm:items-center sm:gap-1 sm:py-1 sm:[grid-template-columns:var(--matrix-cols)]', index > 0 && 'border-t')}
      style={{ borderColor: BORDER, ['--matrix-cols' as string]: template }}
      role="radiogroup" aria-labelledby={labelId} aria-required={(p.field.required && !p.readOnly) || undefined} aria-readonly={p.readOnly || undefined} data-matrix-row={rowKey}>
      <span id={labelId} className="text-sm text-fg">{rowLabel}</span>
      <div className="flex flex-wrap gap-1.5 sm:contents">
        {columns.map((c, i) => {
          const on = i === selected
          return (
            <button key={c} {...itemProps(i)} disabled={p.disabled} aria-label={optionText(p.field, c)} onClick={() => { if (!p.readOnly) onAnswer(c) }}
              className={cn('flex min-h-11 items-center justify-center gap-1.5 rounded-md border px-2 text-xs sm:min-w-11 sm:border-transparent', p.readOnly ? 'cursor-default' : 'hover:bg-subtle')}
              style={on ? { ...ON } : { borderColor: p.invalid && !answer ? INVALID : BORDER, color: 'var(--theme-card-text)' }} data-value={c}>
              <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: on ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
                {on && <span className="size-1.5 rounded-full" style={{ backgroundColor: 'var(--theme-on-primary)' }} />}
              </span>
              <span className="sm:sr-only">{optionText(p.field, c)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MatrixControl(p: SurveyControlProps) {
  const rows = matrixRows(p.field)
  const columns = surveyOptions(p.field)
  const answers = matrixValue(p.value)
  const template = `minmax(8rem, 1.6fr) repeat(${columns.length}, minmax(3rem, 1fr))`
  return (
    <div id={p.id} role="group" aria-labelledby={`${p.id}-label`} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined}
      className={cn('rounded-lg border px-3 py-1', p.disabled && 'opacity-60')} style={{ borderColor: p.invalid ? INVALID : BORDER }} data-survey="matrix">
      <div className="hidden gap-1 border-b py-2 text-center text-2xs font-medium text-fg-muted sm:grid sm:[grid-template-columns:var(--matrix-cols)]" style={{ ['--matrix-cols' as string]: template, borderColor: BORDER }} aria-hidden>
        <span />
        {columns.map((c) => <span key={c} className="leading-tight">{optionText(p.field, c)}</span>)}
      </div>
      {rows.map((r, i) => (
        <MatrixRowGroup key={r.key} p={p} index={i} rowKey={r.key} rowLabel={r.label} columns={columns} answer={answers[r.key]} template={template}
          onAnswer={(v) => p.onChange({ ...answers, [r.key]: v })} />
      ))}
      {!p.field.required && !p.readOnly && !p.disabled && Object.keys(answers).length > 0 && (
        <button type="button" onClick={() => p.onChange(null)} className="mb-1 min-h-6 rounded px-1 text-2xs font-medium text-fg-muted hover:text-fg hover:underline" data-survey-clear>Clear answers</button>
      )}
    </div>
  )
}

/* ── Picture choice ──────────────────────────────────────────────────── */

export function ImageChoiceControl(p: SurveyControlProps) {
  const { field } = p
  const options = surveyOptions(field)
  const multiple = field.survey?.multiple === true
  const picked = multiple ? list(p.value) : p.value == null || p.value === '' ? [] : [String(p.value)]
  const selected = multiple ? -1 : options.indexOf(picked[0] ?? '')
  const choose = (i: number) => p.onChange(options[i])
  const { itemProps } = useRadioGroup(options.length, selected, choose, p.readOnly)
  const cols = field.survey?.columns ?? 3
  const grid = cols === 2 ? 'sm:grid-cols-2' : cols === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
  const toggle = (o: string) => p.onChange(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])
  return (
    <div>
      <div {...(multiple
        ? { id: p.id, role: 'group', 'aria-labelledby': `${p.id}-label`, 'aria-describedby': p.describedBy, 'aria-invalid': p.invalid || undefined, ...(p.readOnly ? { 'data-read-only': '' } : {}) }
        : groupProps(p))}
      className={cn('grid grid-cols-2 gap-2', grid, p.disabled && 'opacity-60')} data-survey="image_choice">
        {options.map((o, i) => {
          const on = picked.includes(o)
          const image = field.survey?.images?.[o]
          const content = (
            <>
              {image ? <span className={cn('flex w-full items-center justify-center overflow-hidden rounded-md', image.startsWith('icon:') ? 'h-14' : '')}><OptionPicture image={image} size={image.startsWith('icon:') ? 36 : 40} /></span> : null}
              <span className="text-sm font-medium leading-tight">{optionText(field, o)}</span>
            </>
          )
          const className = cn('flex min-h-11 flex-col items-center justify-center gap-2 rounded-lg border-2 p-2 text-center transition-colors', p.readOnly ? 'cursor-default' : 'hover:bg-subtle')
          const style = on ? { borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-card-text)' } : offStyle(p.invalid)
          return multiple ? (
            <button key={o} type="button" role="checkbox" aria-checked={on} aria-readonly={p.readOnly || undefined} disabled={p.disabled}
              onClick={() => { if (!p.readOnly) toggle(o) }} className={className} style={style} data-value={o}>{content}</button>
          ) : (
            <button key={o} {...itemProps(i)} disabled={p.disabled} onClick={() => { if (!p.readOnly) choose(i) }} className={className} style={style} data-value={o}>{content}</button>
          )
        })}
      </div>
      <ClearButton p={p} />
    </div>
  )
}

/* ── Ranking ─────────────────────────────────────────────────────────── */

function RankItem({ id, index, count, label, disabled, readOnly, onMove }: {
  id: string; index: number; count: number; label: string; disabled?: boolean; readOnly?: boolean; onMove: (from: number, to: number) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: disabled || readOnly })
  const fixed = disabled || readOnly
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, borderColor: BORDER, color: 'var(--theme-card-text)' }}
      className={cn('flex min-h-11 items-center gap-2 rounded-lg border bg-input px-2', isDragging && 'relative z-10 shadow-elev-2')} data-rank-item={id}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }} aria-hidden>{index + 1}</span>
      {!fixed && (
        <button type="button" {...attributes} {...listeners} aria-label={`Drag ${label}`} aria-roledescription="sortable" tabIndex={-1}
          className="flex size-8 cursor-grab touch-none items-center justify-center rounded text-fg-muted active:cursor-grabbing">
          <GripVertical size={16} aria-hidden />
        </button>
      )}
      <span className="min-w-0 flex-1 py-2 text-sm">{label}</span>
      {!fixed && (
        <span className="flex shrink-0">
          <button type="button" aria-label={`Move ${label} up (now ${index + 1} of ${count})`} disabled={index === 0} onClick={() => onMove(index, index - 1)}
            className="flex size-11 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg disabled:opacity-30"><ArrowUp size={16} aria-hidden /></button>
          <button type="button" aria-label={`Move ${label} down (now ${index + 1} of ${count})`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}
            className="flex size-11 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg disabled:opacity-30"><ArrowDown size={16} aria-hidden /></button>
        </span>
      )}
    </li>
  )
}

export function RankingControl(p: SurveyControlProps) {
  const options = surveyOptions(p.field)
  const stored = list(p.value).filter((v) => options.includes(v))
  // Unanswered: the options in their own order until the person moves one (or keeps it).
  const order = stored.length ? [...stored, ...options.filter((o) => !stored.includes(o))] : options
  const answered = stored.length > 0
  const [announcement, setAnnouncement] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const move = (from: number, to: number) => {
    if (p.readOnly || p.disabled || to < 0 || to >= order.length) return
    const next = arrayMove(order, from, to)
    p.onChange(next)
    setAnnouncement(`${optionText(p.field, order[from])} moved to position ${to + 1} of ${order.length}`)
  }
  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return
    move(order.indexOf(String(event.active.id)), order.indexOf(String(event.over.id)))
  }
  return (
    <div className={cn(p.disabled && 'opacity-60')} data-survey="ranking">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol id={p.id} aria-labelledby={`${p.id}-label`} aria-describedby={p.describedBy} aria-invalid={p.invalid || undefined} {...(p.readOnly ? { 'data-read-only': '' } : {})}
            className={cn('space-y-1.5 rounded-lg', p.invalid && 'outline outline-1 outline-offset-2')} style={p.invalid ? { outlineColor: INVALID } : undefined}>
            {order.map((o, i) => (
              <RankItem key={o} id={o} index={i} count={order.length} label={optionText(p.field, o)} disabled={p.disabled} readOnly={p.readOnly} onMove={move} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-fg-muted">
        {!answered && !p.readOnly && !p.disabled && (
          <button type="button" onClick={() => p.onChange([...order])} className="min-h-6 rounded border px-2 py-0.5 font-medium text-fg hover:bg-subtle" style={{ borderColor: BORDER }} data-survey-keep-order>
            Keep this order
          </button>
        )}
        <span>{answered ? 'Your order, best first.' : 'Not ranked yet: move the options into your order, best first.'}</span>
        <ClearButton p={p} label="Reset" />
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  )
}

/* ── Dispatch and read-only answers ──────────────────────────────────── */

export function SurveyFieldControl(p: SurveyControlProps) {
  switch (p.field.type) {
    case 'rating': return <RatingControl {...p} />
    case 'nps': return <NpsControl {...p} />
    case 'likert': return <LikertControl {...p} />
    case 'matrix': return <MatrixControl {...p} />
    case 'slider': return <SliderControl {...p} />
    case 'csat': return <CsatControl {...p} />
    case 'ranking': return <RankingControl {...p} />
    case 'image_choice': return <ImageChoiceControl {...p} />
    case 'yes_no_maybe': return <SegmentedControl {...p} />
    default: return null
  }
}

/** A survey answer, read only (completed tasks, viewers, the submission detail): drawn, with the text beside it. */
export function SurveyAnswerView({ field, value }: { field: TaskFieldDef; value: unknown }) {
  const text = formatSurveyValue(field, value)
  if (isBlankSurveyValue(field, value)) return <p className="text-sm text-fg">—</p>
  switch (field.type) {
    case 'rating': {
      const scale = surveyScale(field)!
      const n = num(value) ?? 0
      const icon = field.survey?.icon ?? 'star'
      return (
        <p className="flex items-center gap-1 text-sm text-fg" data-survey-answer="rating">
          <span className="sr-only">{text}</span>
          <span className="inline-flex" aria-hidden>
            {Array.from({ length: scale.max }, (_, i) => <RatingGlyph key={i} icon={icon} fill={n >= i + 1 ? 1 : n >= i + 0.5 ? 0.5 : 0} size={18} />)}
          </span>
          <span className="ml-1 tabular-nums text-fg-muted" aria-hidden>{text}</span>
        </p>
      )
    }
    case 'nps': {
      const n = num(value)
      const band = n === null ? null : npsBand(Math.round(n))
      return (
        <p className="flex items-center gap-2 text-sm text-fg" data-survey-answer="nps">
          <span className="tabular-nums">{text}</span>
          {band && <span className="rounded-full px-2 py-0.5 text-2xs font-medium" style={{ backgroundColor: `color-mix(in srgb, ${BAND_COLOR[band]} 14%, transparent)`, color: BAND_COLOR[band] }}>{band === 'promoter' ? 'Promoter' : band === 'passive' ? 'Passive' : 'Detractor'}</span>}
        </p>
      )
    }
    case 'csat': {
      const n = num(value)
      const faces: 3 | 5 = field.survey?.faces === 3 ? 3 : 5
      const Face = n !== null ? FACES[faces][Math.round(n) - 1] : null
      return <p className="flex items-center gap-2 text-sm text-fg" data-survey-answer="csat">{Face && <Face size={18} aria-hidden />}{text}</p>
    }
    case 'matrix': {
      const answers = matrixValue(value)
      return (
        <table className="w-full max-w-lg text-sm" data-survey-answer="matrix">
          <tbody>
            {matrixRows(field).map((r) => (
              <tr key={r.key} className="border-b last:border-0" style={{ borderColor: BORDER }}>
                <th scope="row" className="py-1 pr-3 text-left font-normal text-fg-muted">{r.label}</th>
                <td className="py-1 text-fg">{answers[r.key] ? optionText(field, answers[r.key]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'ranking':
      return (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm text-fg" data-survey-answer="ranking">
          {list(value).map((v) => <li key={v}>{optionText(field, v)}</li>)}
        </ol>
      )
    case 'image_choice': {
      const picked = field.survey?.multiple ? list(value) : [String(value)]
      return (
        <ul className="flex flex-wrap gap-1.5 text-sm text-fg" data-survey-answer="image_choice">
          {picked.map((v) => {
            const image = field.survey?.images?.[v]
            return (
              <li key={v} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5" style={{ borderColor: BORDER }}>
                {image?.startsWith('icon:') && <OptionPicture image={image} size={14} />}
                {optionText(field, v)}
              </li>
            )
          })}
        </ul>
      )
    }
    default:
      return <p className="text-sm text-fg" data-survey-answer={field.type}>{text}</p>
  }
}
