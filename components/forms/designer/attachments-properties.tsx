'use client'

import { useState } from 'react'
import {
  ATTACHMENT_DEFAULTS, ATTACHMENT_LIMITS, ATTACHMENT_TYPE_PRESET_LABELS, ATTACHMENT_TYPE_PRESETS, allowsImages, attachmentsConfigProblem,
  attachmentsCountKey, normalizeAttachmentsConfig, type AttachmentTypePreset, type AttachmentsConfig,
} from '@/lib/forms/attachments'
import type { DesignerField } from '@/lib/forms/designer-state'

const inputClass = 'h-8 w-full rounded-md border px-2 text-xs outline-none focus-visible:ring-2'
const inputStyle: React.CSSProperties = {
  borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)',
  ['--tw-ring-color' as string]: 'var(--theme-primary)',
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{children}</label>
}

function num(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * The Attachments field's settings: how many files, how large, which
 * types (presets and custom extensions / MIME types) and the phone camera.
 * The instance may cap the size per file lower (FORM_ATTACHMENT_MAX_MB).
 */
export function AttachmentsProperties({ field, onPatch }: { field: DesignerField; onPatch: (config: AttachmentsConfig, tag?: string) => void }) {
  const config = field.attachments ?? {}
  const id = (name: string) => `ap-${field._id}-${name}`
  const types = config.types?.length ? config.types : (config.custom_types?.length ? [] : ['any' as const])
  const [customText, setCustomText] = useState((config.custom_types ?? []).join(', '))
  const set = (patch: Partial<AttachmentsConfig>, tag?: string) => {
    const next: Record<string, unknown> = { ...config, ...patch }
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
    onPatch(next as AttachmentsConfig, tag)
  }
  const toggleType = (preset: AttachmentTypePreset) => {
    if (preset === 'any') return set({ types: ['any'] })
    const current = types.filter((t) => t !== 'any')
    const next = current.includes(preset) ? current.filter((t) => t !== preset) : [...current, preset]
    set({ types: next.length ? next : (config.custom_types?.length ? [] : ['any']) })
  }
  const problem = attachmentsConfigProblem(config)

  return (
    <fieldset className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--theme-surface-border)' }} data-attachments-properties>
      <legend className="pr-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Files</legend>
      <div className="grid grid-cols-2 gap-1">
        <div>
          <Label htmlFor={id('min')}>At least (files)</Label>
          <input id={id('min')} type="number" min={0} max={ATTACHMENT_LIMITS.maxFiles} className={inputClass} style={inputStyle} placeholder={field.required ? '1' : '0'}
            value={config.min_files ?? ''} onChange={(e) => set({ min_files: num(e.target.value) }, `amin-${field._id}`)} />
        </div>
        <div>
          <Label htmlFor={id('max')}>At most (files)</Label>
          <input id={id('max')} type="number" min={1} max={ATTACHMENT_LIMITS.maxFiles} className={inputClass} style={inputStyle} placeholder={String(ATTACHMENT_DEFAULTS.max_files)}
            value={config.max_files ?? ''} onChange={(e) => set({ max_files: num(e.target.value) }, `amax-${field._id}`)} />
        </div>
        <div>
          <Label htmlFor={id('size')}>Max size per file (MB)</Label>
          <input id={id('size')} type="number" min={0.1} step={0.5} max={ATTACHMENT_LIMITS.maxFileMb} className={inputClass} style={inputStyle} placeholder={String(ATTACHMENT_DEFAULTS.max_file_mb)}
            value={config.max_file_mb ?? ''} onChange={(e) => set({ max_file_mb: num(e.target.value) }, `asize-${field._id}`)} />
        </div>
        <div>
          <Label htmlFor={id('total')}>Max total (MB)</Label>
          <input id={id('total')} type="number" min={0.1} step={1} max={ATTACHMENT_LIMITS.maxTotalMb} className={inputClass} style={inputStyle} placeholder="files × size"
            value={config.max_total_mb ?? ''} onChange={(e) => set({ max_total_mb: num(e.target.value) }, `atotal-${field._id}`)} />
        </div>
      </div>
      <div>
        <Label>Allowed types</Label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Allowed file types">
          {ATTACHMENT_TYPE_PRESETS.map((preset) => {
            const on = types.includes(preset)
            return (
              <button key={preset} type="button" role="checkbox" aria-checked={on} onClick={() => toggleType(preset)}
                className="rounded-full border px-2.5 py-1 text-[10px] font-medium"
                style={on
                  ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                  : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                {ATTACHMENT_TYPE_PRESET_LABELS[preset]}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <Label htmlFor={id('custom')}>Also allow (extensions or MIME types)</Label>
        <input id={id('custom')} className={`${inputClass} font-mono`} style={inputStyle} placeholder=".dwg, application/zip, image/*" value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onBlur={() => {
            const normalized = normalizeAttachmentsConfig({ custom_types: customText.split(/[\s,;]+/) }).custom_types
            setCustomText((normalized ?? []).join(', '))
            set({ custom_types: normalized })
          }} />
      </div>
      {allowsImages(config) && (
        <label className="flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={config.camera === true} onChange={(e) => set({ camera: e.target.checked || undefined })} style={{ accentColor: 'var(--theme-primary)' }} />
          Offer the camera on phones
        </label>
      )}
      <p className="text-[10px]" style={{ color: problem ? 'var(--status-blocked)' : 'var(--theme-muted-text)' }}>
        {problem ?? <>Programs, scripts and web pages are always refused; content is checked on upload. Downstream: a list of files, and <code style={{ color: 'var(--theme-primary-text)' }}>{`{{task_data.${attachmentsCountKey(field.key)}}}`}</code>.</>}
      </p>
    </fieldset>
  )
}
