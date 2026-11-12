'use client'

import type { DesignerField } from '@/lib/forms/designer-state'
import { RICH_TEXT_DEFAULT_MAX, RICH_TEXT_MAX, type RichTextConfig } from '@/lib/forms/rich-text'
import { TEXT_LIST_DEFAULT_ITEM_LENGTH, TEXT_LIST_DEFAULT_MAX_ITEMS, TEXT_LIST_MAX_ITEM_LENGTH, TEXT_LIST_MAX_ITEMS, TEXT_LIST_STYLE_LABELS, TEXT_LIST_STYLES, type TextListConfig, type TextListStyle } from '@/lib/forms/text-list'
import type { UrlFieldConfig } from '@/lib/forms/link-field'
import { PEOPLE_DEFAULT_MAX, PEOPLE_MAX, type UserFieldConfig } from '@/lib/forms/people-field'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * Inspector sections of the Rich text, Text list, URL (link text), Person
 * (several people / teams) and Multi-select (show as) fields.
 */

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Fieldset({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <fieldset className="space-y-2 border-t pt-3 border-border" data-testid={testId}>
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('h-7 flex-1 rounded border text-2xs font-medium', value === v ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')}>
          {text}
        </button>
      ))}
    </div>
  )
}

function clean<T extends object>(obj: T): T | undefined {
  const out = { ...obj } as Record<string, unknown>
  for (const key of Object.keys(out)) if (out[key] === undefined || out[key] === '') delete out[key]
  return Object.keys(out).length ? out as T : undefined
}

function whole(value: string): number | undefined {
  if (!value.trim()) return undefined
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function RichTextProperties({ field, onPatch }: { field: DesignerField; onPatch: (config: RichTextConfig | undefined, tag?: string) => void }) {
  const config = field.rich_text ?? {}
  const id = (name: string) => `rtp-${field._id}-${name}`
  return (
    <Fieldset title="Rich text" testId="rich-text-properties">
      <div>
        <Label>Toolbar</Label>
        <Segmented label="Toolbar" value={config.toolbar ?? 'basic'} options={[['basic', 'Basic'], ['full', 'Full']]}
          onChange={(toolbar) => onPatch(clean({ ...config, toolbar: toolbar === 'basic' ? undefined : toolbar }))} />
        <p className="mt-1 text-2xs text-fg-muted">Basic: bold, italic, underline, lists, link, clear. Full adds strikethrough, headings, quote and code.</p>
      </div>
      <div>
        <Label htmlFor={id('max')}>Longest text (characters)</Label>
        <input id={id('max')} type="number" min={1} max={RICH_TEXT_MAX} className={inputClass} value={config.max_length ?? ''} placeholder={String(RICH_TEXT_DEFAULT_MAX)}
          onChange={(e) => onPatch(clean({ ...config, max_length: whole(e.target.value) }), `rt-max-${field._id}`)} />
      </div>
      <p className="text-2xs text-fg-muted">Stored as safe HTML; the plain text is <code className="text-primary-text">{`{{form.${field.key}_text}}`}</code>.</p>
    </Fieldset>
  )
}

export function TextListProperties({ field, onPatch }: { field: DesignerField; onPatch: (config: TextListConfig | undefined, tag?: string) => void }) {
  const config = field.text_list ?? {}
  const id = (name: string) => `tlp-${field._id}-${name}`
  const set = (patch: Partial<TextListConfig>, tag?: string) => onPatch(clean({ ...config, ...patch }), tag)
  return (
    <Fieldset title="Text list" testId="text-list-properties">
      <div>
        <Label>Markers</Label>
        <Segmented<TextListStyle> label="Markers" value={config.style ?? 'bulleted'} options={TEXT_LIST_STYLES.map((s) => [s, TEXT_LIST_STYLE_LABELS[s]])}
          onChange={(style) => set({ style: style === 'bulleted' ? undefined : style })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={id('min')}>Fewest items</Label>
          <input id={id('min')} type="number" min={0} max={TEXT_LIST_MAX_ITEMS} className={inputClass} value={config.min_items ?? ''} placeholder="0"
            onChange={(e) => set({ min_items: whole(e.target.value) }, `tl-min-${field._id}`)} />
        </div>
        <div>
          <Label htmlFor={id('max')}>Most items</Label>
          <input id={id('max')} type="number" min={1} max={TEXT_LIST_MAX_ITEMS} className={inputClass} value={config.max_items ?? ''} placeholder={String(TEXT_LIST_DEFAULT_MAX_ITEMS)}
            onChange={(e) => set({ max_items: whole(e.target.value) }, `tl-max-${field._id}`)} />
        </div>
      </div>
      <div>
        <Label htmlFor={id('len')}>Longest item (characters)</Label>
        <input id={id('len')} type="number" min={1} max={TEXT_LIST_MAX_ITEM_LENGTH} className={inputClass} value={config.item_max_length ?? ''} placeholder={String(TEXT_LIST_DEFAULT_ITEM_LENGTH)}
          onChange={(e) => set({ item_max_length: whole(e.target.value) }, `tl-len-${field._id}`)} />
      </div>
    </Fieldset>
  )
}

export function UrlProperties({ field, fields, onPatch }: { field: DesignerField; fields: Array<Pick<TaskFieldDef, 'key' | 'label' | 'type'>>; onPatch: (config: UrlFieldConfig | undefined, tag?: string) => void }) {
  const config = field.url_config ?? {}
  const id = (name: string) => `urlp-${field._id}-${name}`
  const set = (patch: Partial<UrlFieldConfig>, tag?: string) => onPatch(clean({ ...config, ...patch }), tag)
  const sources = fields.filter((f) => f.key !== field.key && ['text', 'textarea', 'label', 'choice'].includes(f.type))
  return (
    <Fieldset title="Link display" testId="url-properties">
      <div>
        <Label htmlFor={id('field')}>Link text from a field</Label>
        <select id={id('field')} className={inputClass} value={config.text_field ?? ''} onChange={(e) => set({ text_field: e.target.value || undefined })}>
          <option value="">None</option>
          {config.text_field && !sources.some((f) => f.key === config.text_field) && <option value={config.text_field}>{config.text_field} (missing)</option>}
          {sources.map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor={id('text')}>Link text</Label>
        <input id={id('text')} className={inputClass} value={config.link_text ?? ''} placeholder="e.g. Open the contract" maxLength={200}
          onChange={(e) => set({ link_text: e.target.value || undefined }, `url-text-${field._id}`)} />
        <p className="mt-1 text-2xs text-fg-muted">Shown instead of the address in read-only views (the field above wins when it has a value).</p>
      </div>
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={config.new_tab !== false} onChange={(e) => set({ new_tab: e.target.checked ? undefined : false })} />
        Open in a new tab
      </label>
    </Fieldset>
  )
}

export function PersonProperties({ field, onPatch }: { field: DesignerField; onPatch: (config: UserFieldConfig | undefined, tag?: string) => void }) {
  const config = field.user_config ?? {}
  const id = (name: string) => `upp-${field._id}-${name}`
  const set = (patch: Partial<UserFieldConfig>, tag?: string) => {
    const next = { ...config, ...patch }
    if (!next.multiple) delete next.max
    onPatch(clean(next), tag)
  }
  return (
    <Fieldset title="People" testId="person-properties">
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={config.multiple === true} onChange={(e) => set({ multiple: e.target.checked || undefined })} />
        Several people
      </label>
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={config.allow_teams === true} onChange={(e) => set({ allow_teams: e.target.checked || undefined })} />
        Teams too
      </label>
      {config.multiple && (
        <div>
          <Label htmlFor={id('max')}>Most picks</Label>
          <input id={id('max')} type="number" min={1} max={PEOPLE_MAX} className={inputClass} value={config.max ?? ''} placeholder={String(PEOPLE_DEFAULT_MAX)}
            onChange={(e) => set({ max: whole(e.target.value) }, `up-max-${field._id}`)} />
        </div>
      )}
      <p className="text-2xs text-fg-muted">
        {config.multiple || config.allow_teams
          ? 'The value is a list of { kind, id, name } — loop over it in a workflow.'
          : 'The value is one person’s id.'}
      </p>
    </Fieldset>
  )
}

export function MultiChoiceDisplayProperty({ field, onPatch }: { field: DesignerField; onPatch: (patch: Partial<TaskFieldDef>) => void }) {
  const value = field.display === 'checkboxes' || field.display === 'listbox' ? field.display : 'pills'
  return (
    <div>
      <Label>Show as</Label>
      <Segmented label="Show as" value={value} options={[['pills', 'Pills'], ['checkboxes', 'Checkboxes'], ['listbox', 'List box']]}
        onChange={(mode) => onPatch({ display: mode === 'pills' ? undefined : mode })} />
    </div>
  )
}
