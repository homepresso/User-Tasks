'use client'

import { Plus, X } from 'lucide-react'
import { VariableInput } from '@/components/automations/variable-input'
import type { FieldButtonAction } from '@/lib/forms/field-buttons'
import { designerInputClass as inputClass, designerInputBase as inputBase } from './designer-controls'
import { cn } from '@/lib/utils'
import {
  DISMISSED_RESPONSE, MESSAGE_DURATION_LABELS, MESSAGE_LIMITS, MESSAGE_TONE_LABELS, MESSAGE_TONES, MIN_READABLE_SECONDS,
  PROMPT_PRESETS, PROMPT_PRESET_LABELS, clampSeconds, defaultEscape, presetButtons,
  type MessageDuration, type MessageStyle, type MessageTone, type PromptButton, type PromptConfig, type PromptPreset,
} from '@/lib/forms/form-messages'

/**
 * The designer's editors for "Show a message" (style, tone, title, text,
 * how long it stays) and "Ask a question" (display, responses, each
 * response's own actions — "If Yes → …" — and whether the steps after the
 * question run). Shared by a Button's On click and the Rules tab; each
 * passes how a response's action list is drawn (`renderBranch`), so the
 * branch offers that place's own action catalog.
 */


function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', value === v ? 'border-primary' : 'border-border', value === v ? 'bg-primary-wash' : '', value === v ? 'text-primary-text' : 'text-fg')}
         >
          {text}
        </button>
      ))}
    </div>
  )
}

function Small({ children }: { children: React.ReactNode }) {
  return <p className="text-2xs text-fg-muted">{children}</p>
}

type Placeholders = Array<{ name: string; group: string; label?: string }>

/** Title + text + tone (both actions). */
function TextAndTone({ action, onChange, placeholders, textPlaceholder }: {
  action: FieldButtonAction
  onChange: (next: FieldButtonAction, tag?: string) => void
  placeholders: Placeholders
  textPlaceholder: string
}) {
  const tone: MessageTone = action.tone ?? 'info'
  return (
    <>
      {/* Both fill placeholders when shown (interpolateButtonText): the picker offers this place's variables. */}
      <div data-testid="message-title">
        <VariableInput value={action.title ?? ''} extraVariables={placeholders} ariaLabel="Title (optional)" placeholder="Title (optional)"
          onChange={(v) => onChange({ ...action, title: v ? v.slice(0, MESSAGE_LIMITS.title) : undefined }, 'message-title')} />
      </div>
      <div data-testid="message-text">
        <VariableInput value={action.text ?? ''} extraVariables={placeholders} ariaLabel="Message text" placeholder={textPlaceholder} onChange={(v) => onChange({ ...action, text: v }, 'message-text')} />
      </div>
      <Seg label="Tone" value={tone} options={MESSAGE_TONES.map((t) => [t, MESSAGE_TONE_LABELS[t]])}
        onChange={(t) => onChange({ ...action, tone: t === 'info' ? undefined : t })} />
    </>
  )
}

/** "Show a message": style (banner / inline), tone, title, text, duration. A message saved before banners shows as "Inline (original)". */
export function MessageActionEditor({ action, onChange, placeholders }: {
  action: FieldButtonAction
  onChange: (next: FieldButtonAction, tag?: string) => void
  placeholders: Placeholders
}) {
  const legacy = !action.style
  const duration: MessageDuration = action.duration ?? 'dismiss'
  const seconds = action.seconds ?? MESSAGE_LIMITS.seconds.default
  return (
    <div className="space-y-1.5" data-testid="message-editor">
      <Seg label="Where it shows" value={typeof action.style === 'string' ? action.style : 'inline'} options={[['banner', 'Banner at the top'], ['inline', legacy ? 'Inline (original)' : 'Inline']]}
        onChange={(style) => onChange({ ...action, style: style as MessageStyle })} />
      <TextAndTone action={action} onChange={onChange} placeholders={placeholders} textPlaceholder="Saved — {{name}}" />
      {!legacy && (
        <>
          <label className="block text-2xs font-medium text-fg-muted">
            How long it stays
            <select aria-label="How long it stays" className={inputClass} value={duration} data-testid="message-duration"
              onChange={(e) => {
                const d = e.target.value as MessageDuration
                const next: FieldButtonAction = { ...action, duration: d === 'dismiss' ? undefined : d, seconds: d === 'auto' ? seconds : undefined }
                onChange(next)
              }}>
              {(Object.keys(MESSAGE_DURATION_LABELS) as MessageDuration[]).map((d) => <option key={d} value={d}>{MESSAGE_DURATION_LABELS[d]}</option>)}
            </select>
          </label>
          {duration === 'auto' && (
            <label className="flex items-center gap-1.5 text-2xs">
              <input type="number" aria-label="Seconds before it hides" min={MESSAGE_LIMITS.seconds.min} max={MESSAGE_LIMITS.seconds.max} className={`${inputBase} w-20`}
                value={seconds} onChange={(e) => onChange({ ...action, seconds: clampSeconds(e.target.value) }, 'message-seconds')} data-testid="message-seconds" />
              seconds (2–60; paused while hovered or focused)
            </label>
          )}
          {duration === 'auto' && seconds < MIN_READABLE_SECONDS && <p className="text-2xs text-warning">Under {MIN_READABLE_SECONDS} seconds is hard to read (WCAG 2.2.1).</p>}
        </>
      )}
      {legacy && <Small>Saved before banners: it keeps its original look. Choose Banner or Inline for tone, title and duration options.</Small>}
    </div>
  )
}

/**
 * "Ask a question": text, tone, banner / dialog, preset or custom responses;
 * per response its label, style, actions ("If Yes → …") and whether the
 * steps after the question run; Escape's answer; a name for rules.
 */
export function PromptActionEditor({ action, onChange, placeholders, renderBranch }: {
  action: FieldButtonAction
  onChange: (next: FieldButtonAction, tag?: string) => void
  placeholders: Placeholders
  /** Draw a response's action list (that place's own action catalog, no questions). */
  renderBranch: (actions: FieldButtonAction[], onChange: (next: FieldButtonAction[], tag?: string) => void, response: string) => React.ReactNode
}) {
  const prompt: PromptConfig<FieldButtonAction> = action.prompt ?? { display: 'banner', preset: 'yes_no', buttons: presetButtons('yes_no') as Array<PromptButton<FieldButtonAction>> }
  const setPrompt = (patch: Partial<PromptConfig<FieldButtonAction>>, tag?: string) => onChange({ ...action, prompt: { ...prompt, ...patch } }, tag)
  const setButton = (i: number, patch: Partial<PromptButton<FieldButtonAction>>, tag?: string) => setPrompt({ buttons: prompt.buttons.map((b, j) => (j === i ? { ...b, ...patch } : b)) }, tag)
  const escapeDefault = defaultEscape(prompt.buttons)
  return (
    <div className="space-y-1.5" data-testid="prompt-editor">
      <TextAndTone action={action} onChange={onChange} placeholders={placeholders} textPlaceholder="Delete the selected rows?" />
      <Seg label="Shown as" value={prompt.display} options={[['banner', 'Banner with buttons'], ['dialog', 'Dialog (modal)']]} onChange={(display) => setPrompt({ display })} />
      <label className="block text-2xs font-medium text-fg-muted">
        Responses
        <select aria-label="Responses" className={inputClass} value={prompt.preset} data-testid="prompt-preset"
          onChange={(e) => {
            const preset = e.target.value as PromptPreset
            // Keep what each response already does when its value survives the switch.
            const fresh = (preset === 'custom' ? prompt.buttons : presetButtons(preset)) as Array<PromptButton<FieldButtonAction>>
            const buttons = fresh.map((b) => { const old = prompt.buttons.find((x) => x.value === b.value); return old ? { ...b, ...(old.then ? { then: old.then } : {}) } : b })
            setPrompt({ preset, buttons, escape: undefined })
          }}>
          {PROMPT_PRESETS.map((p) => <option key={p} value={p}>{PROMPT_PRESET_LABELS[p]}</option>)}
        </select>
      </label>
      <ol className="space-y-1.5" aria-label="Responses">
        {prompt.buttons.map((b, i) => (
          <li key={`${b.value}-${i}`} className="space-y-1 rounded border p-1.5 border-border" data-prompt-branch={b.value}>
            <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-1">
              <input aria-label={`Label of the ${b.value} button`} className={inputClass} value={b.label} maxLength={MESSAGE_LIMITS.label}
                onChange={(e) => setButton(i, { label: e.target.value }, `prompt-label-${i}`)} />
              {prompt.preset === 'custom'
                ? <input aria-label="Response value" className={`${inputClass} font-mono`} value={b.value} maxLength={40}
                    onChange={(e) => setButton(i, { value: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'answer' }, `prompt-value-${i}`)} />
                : <code className="truncate text-2xs text-fg-muted">event.response = {b.value}</code>}
              {prompt.preset === 'custom' && prompt.buttons.length > 1
                ? <button type="button" className="rounded p-0.5" aria-label={`Remove the ${b.label} response`} onClick={() => setPrompt({ buttons: prompt.buttons.filter((_, j) => j !== i) })}><X size={10} /></button>
                : <span />}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Style of ${b.label}`} className={`${inputBase} w-28`} value={b.style ?? 'secondary'} onChange={(e) => setButton(i, { style: e.target.value as PromptButton['style'] })}>
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="danger">Danger</option>
              </select>
              <label className="flex items-center gap-1 text-2xs" title="Run the steps after the question when this is the answer">
                <input className="accent-primary" type="checkbox" checked={b.continue === true} onChange={(e) => setButton(i, { continue: e.target.checked || undefined })} data-testid={`prompt-continue-${b.value}`} />
                Then continue with the next steps
              </label>
            </div>
            <div className="ml-2 space-y-1 border-l-2 border-primary-wash pl-2">
              <p className="text-2xs font-semibold">If {b.label} →</p>
              {renderBranch(b.then ?? [], (then, tag) => setButton(i, { then: then.length ? then : undefined }, tag ? `prompt-${i}-${tag}` : undefined), b.value)}
              {!b.then?.length && <Small>{b.continue ? 'Nothing extra — the next steps run.' : 'Nothing — the remaining steps stop.'}</Small>}
            </div>
          </li>
        ))}
      </ol>
      {prompt.preset === 'custom' && prompt.buttons.length < MESSAGE_LIMITS.buttons && (
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text"
          onClick={() => { let n = prompt.buttons.length + 1; while (prompt.buttons.some((b) => b.value === `answer_${n}`)) n++; setPrompt({ buttons: [...prompt.buttons, { value: `answer_${n}`, label: `Answer ${n}`, style: 'secondary' }] }) }}>
          <Plus size={10} /> Add a response
        </button>
      )}
      <div className="grid grid-cols-2 gap-1">
        <label className="block text-2xs font-medium text-fg-muted">
          Escape / close answers
          <select aria-label="Escape answers" className={inputClass} value={prompt.escape ?? ''} onChange={(e) => setPrompt({ escape: e.target.value || undefined })}>
            <option value="">{escapeDefault ? `${prompt.buttons.find((b) => b.value === escapeDefault)?.label} (default)` : 'Closed — stops (default)'}</option>
            {prompt.buttons.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            <option value={DISMISSED_RESPONSE}>Closed — stops</option>
          </select>
        </label>
        <label className="block text-2xs font-medium text-fg-muted">
          Name (for rules)
          <input aria-label="Question name" className={`${inputClass} font-mono`} value={prompt.id ?? ''} maxLength={40} placeholder="confirm_delete"
            onChange={(e) => setPrompt({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || undefined }, 'prompt-id')} />
        </label>
      </div>
      <Small>The steps after the question wait for the answer. A rule on “A question is answered” can also react to <code>{'{{event.response}}'}</code>.</Small>
    </div>
  )
}

/** A response's action list: numbered editors plus "+ Add an action" (no questions inside a question). */
export function BranchActions({ actions, onChange, options, renderAction, create }: {
  actions: FieldButtonAction[]
  onChange: (next: FieldButtonAction[], tag?: string) => void
  options: Array<{ group?: string; items: Array<{ value: string; label: string }> }>
  renderAction: (action: FieldButtonAction, i: number, common: {
    index: number; count: number
    onChange: (next: FieldButtonAction, tag?: string) => void
    onMove: (delta: number) => void
    onRemove: () => void
  }) => React.ReactNode
  /** Builds a new action of a type. */
  create: (type: string) => FieldButtonAction
}) {
  return (
    <div className="space-y-1">
      {actions.map((action, i) => renderAction(action, i, {
        index: i, count: actions.length,
        onChange: (next, tag) => onChange(actions.map((a, j) => (j === i ? next : a)), tag ? `${tag}-${i}` : undefined),
        onMove: (delta) => { const next = [...actions]; const [a] = next.splice(i, 1); next.splice(Math.max(0, Math.min(next.length, i + delta)), 0, a); onChange(next) },
        onRemove: () => onChange(actions.filter((_, j) => j !== i)),
      }))}
      {actions.length < MESSAGE_LIMITS.branchActions && (
        <select aria-label="Add an action to this response" className={inputClass} value="" data-testid="prompt-branch-add"
          onChange={(e) => { const t = e.target.value; if (t) onChange([...actions, create(t)]) }}>
          <option value="">+ Add an action…</option>
          {options.map((g, gi) => (g.group
            ? <optgroup key={gi} label={g.group}>{g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
            : g.items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)))}
        </select>
      )}
    </div>
  )
}
