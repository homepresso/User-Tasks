'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { serverRead } from '@/lib/server-read'
import { compareSemver, coercePropValue } from '@/lib/forms/custom-controls/manifest'
import { customConfigFromManifest } from '@/lib/forms/custom-controls/field'
import type { ControlPropSpec, FormControlManifest } from '@/lib/forms/custom-controls/contract'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import { DISPLAY_FIELD_TYPES, type TaskFieldDef } from '@/lib/task-field-schema'
import { ControlIcon } from './control-icon'
import { useFormControls } from './custom-controls-palette'
import { LookupProperties } from './lookup-properties'
import { AttachmentsProperties } from './attachments-properties'
import { DynamicProp } from './dynamic-value-editor'
import { controlPropType, isBindableProp } from '@/lib/forms/dynamic-values'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * Properties of a placed custom control: its version, the designer
 * properties its manifest declares (an editor per prop type), which form
 * fields feed its declared context, and — when it asks for them — the
 * lookup source and upload limits. Generated from the pinned version's
 * manifest, so what can be set always matches what the control accepts.
 */


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t pt-3 border-border">
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function PropEditor({ prop, value, onChange, id, bare }: { prop: ControlPropSpec; value: unknown; onChange: (value: unknown) => void; id: string; bare?: boolean }) {
  const label = prop.label ?? prop.name
  const hint = prop.description ? <p className="mt-0.5 text-2xs text-fg-muted">{prop.description}</p> : null
  switch (prop.type) {
    case 'boolean':
      return (
        <div>
          <label className="flex items-center gap-1.5 text-2xs">
            <input className="accent-primary" id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
            {label}
          </label>
          {hint}
        </div>
      )
    case 'select':
      return (
        <div>
          {!bare && <Label>{label}</Label>}
          <AutocompleteSelect
            value={typeof value === 'string' ? value : ''}
            options={(prop.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value }))}
            onChange={(next) => onChange(next || undefined)}
            clearable={!prop.required}
          />
          {hint}
        </div>
      )
    case 'number':
      return (
        <div>
          {!bare && <Label htmlFor={id}>{label}</Label>}
          <input id={id} type="number" className={inputClass} min={prop.min} max={prop.max} value={typeof value === 'number' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? undefined : coercePropValue(prop, e.target.value))} />
          {hint}
        </div>
      )
    case 'color':
      return (
        <div>
          {!bare && <Label htmlFor={id}>{label}</Label>}
          <div className="flex gap-1">
            <input type="color" aria-label={`${label} colour picker`} className="h-8 w-9 rounded border border-border" value={typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
            <input id={id} className={`${inputClass} font-mono`} value={typeof value === 'string' ? value : ''} placeholder="#2563eb" onChange={(e) => onChange(e.target.value || undefined)} />
          </div>
          {hint}
        </div>
      )
    case 'string[]':
      return (
        <div>
          {!bare && <Label htmlFor={id}>{label} (one per line)</Label>}
          <textarea id={id} rows={3} className="w-full rounded-md border px-2 py-1 text-xs"
            value={Array.isArray(value) ? value.join('\n') : ''} onChange={(e) => onChange(coercePropValue(prop, e.target.value))} />
          {hint}
        </div>
      )
    case 'json':
    case 'text':
      return (
        <div>
          {!bare && <Label htmlFor={id}>{label}{prop.type === 'json' ? ' (JSON)' : ''}</Label>}
          <textarea id={id} rows={prop.type === 'json' ? 4 : 3} className={`w-full rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2 ${prop.type === 'json' ? 'font-mono' : ''}`}
            defaultValue={prop.type === 'json' ? (value === undefined ? '' : JSON.stringify(value, null, 2)) : typeof value === 'string' ? value : ''}
            onBlur={(e) => onChange(e.target.value.trim() === '' ? undefined : prop.type === 'json' ? coercePropValue(prop, e.target.value) : e.target.value)} />
          {hint}
        </div>
      )
    default:
      return (
        <div>
          {!bare && <Label htmlFor={id}>{label}</Label>}
          <input id={id} className={inputClass} value={typeof value === 'string' ? value : value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value || undefined)} />
          {hint}
        </div>
      )
  }
}

export function CustomControlProperties({ state, field, onPatch }: {
  state: DesignerState
  field: DesignerField
  onPatch: (patch: Partial<TaskFieldDef>, tag?: string) => void
}) {
  const config = field.custom
  const { data: controls = [] } = useFormControls()
  const control = controls.find((c) => c.tag === config?.tag)
  const { data: manifest, isLoading } = useQuery({
    queryKey: ['form-control-version', config?.tag, config?.version],
    enabled: Boolean(config),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await serverRead('forms.controlVersion', { tag: config!.tag, version: config!.version })
      if (error) throw new Error(error.message)
      return (data?.manifest ?? null) as FormControlManifest | null
    },
  })
  if (!config) {
    return <p className="text-2xs text-danger">This field has no control. Remove it and place one from the Custom palette group.</p>
  }
  const id = (name: string) => `cc-${field._id}-${name}`
  const props = config.props ?? {}
  const others = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type))
  const versions = [...(control?.versions ?? [])].sort((a, b) => compareSemver(b.version, a.version))

  async function switchVersion(version: string) {
    if (!version || version === config!.version) return
    const { data } = await serverRead('forms.controlVersion', { tag: config!.tag, version })
    if (data?.manifest) onPatch({ custom: customConfigFromManifest(data.manifest as FormControlManifest, config) })
  }

  return (
    <div className="space-y-3" data-custom-control-properties={config.tag}>
      <div className="flex items-start gap-2 rounded-md border p-2 border-border">
        <ControlIcon className="text-primary-text" icon={config.icon} size={16} style={{ marginTop: 2 }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">{config.name ?? config.tag}</p>
          <p className="truncate font-mono text-2xs text-fg-muted">&lt;{config.tag}&gt; · stores {config.value_type}{config.output ? ` · workflow gets ${config.output.type}` : ''}</p>
          {control?.trusted
            ? <p className="mt-0.5 text-2xs text-danger">Trusted: renders in the page without the sandbox.</p>
            : <p className="mt-0.5 flex items-center gap-1 text-2xs text-fg-muted"><ShieldCheck size={10} aria-hidden /> Runs in a sandboxed frame</p>}
        </div>
      </div>

      {!control && <p className="flex items-start gap-1 text-2xs text-danger"><AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden /> This control is not in the library (or is disabled) — it won&apos;t load.</p>}

      <div>
        <Label>Version</Label>
        <AutocompleteSelect
          value={config.version}
          options={(versions.length ? versions : [{ version: config.version }]).map((v) => ({ value: v.version, label: v.version === control?.latest_version ? `${v.version} (latest)` : v.version }))}
          onChange={(value) => { void switchVersion(value) }}
        />
        {control && control.latest_version !== config.version && compareSemver(control.latest_version, config.version) > 0 && (
          <button type="button" className="mt-1 text-2xs font-medium underline text-primary-text" onClick={() => void switchVersion(control.latest_version)}>
            Upgrade to {control.latest_version}
          </button>
        )}
      </div>

      {config.output && (config.output.choices?.length ?? 0) > 1 && (
        <div data-control-output-choice>
          <Label>Workflow output</Label>
          <AutocompleteSelect
            value={config.output_choice ?? config.output.choices![0].value}
            options={config.output.choices!.map((c) => ({ value: c.value, label: c.label }))}
            onChange={(value) => onPatch({ custom: { ...config, output_choice: value === config.output!.choices![0].value ? undefined : value } })}
          />
          <p className="mt-0.5 text-2xs text-fg-muted">
            What <span className="font-mono">{`{{${field.key}}}`}</span> holds in the workflow.{config.output.extras ? ` Also: ${Object.keys(config.output.extras).map((s) => `${field.key}_${s}`).join(', ')}.` : ''} The full value is <span className="font-mono">{`${field.key}_raw`}</span>.
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="text-2xs text-fg-muted">Loading the control&apos;s properties…</p>
      ) : manifest && manifest.props.length > 0 ? (
        <Section title="Control properties">
          {manifest.props.map((prop) => {
            const editor = (bare: boolean) => (
              <PropEditor
                key={prop.name}
                prop={prop}
                bare={bare}
                id={id(`prop-${prop.name}`)}
                value={props[prop.name] ?? prop.default}
                onChange={(value) => {
                  const next = { ...props }
                  if (value === undefined) delete next[prop.name]
                  else next[prop.name] = value
                  onPatch({ custom: { ...config, props: Object.keys(next).length ? next : undefined } }, `cprop-${field._id}-${prop.name}`)
                }}
              />
            )
            // Bindable props (lib/forms/dynamic-values.ts): the host resolves them and sends the value as the prop.
            if (!isBindableProp(prop) || prop.type === 'boolean') return editor(false)
            const json = prop.type === 'json'
            return (
              <DynamicProp key={prop.name} state={state} field={field} prop={`props.${prop.name}`} label={`${prop.label ?? prop.name}${json ? ' (JSON)' : prop.type === 'string[]' ? ' (one per line)' : ''}`}
                expects={controlPropType(prop.type)} onPatch={onPatch} htmlFor={id(`prop-${prop.name}`)}>
                {editor(true)}
              </DynamicProp>
            )
          })}
        </Section>
      ) : null}

      {manifest && manifest.context.length > 0 && (
        <Section title="Values it reads">
          {manifest.context.map((ctx) => (
            <div key={ctx.name}>
              <Label>{ctx.label ?? ctx.name}</Label>
              <AutocompleteSelect
                value={config.context_map?.[ctx.name] ?? ''}
                placeholder="Not connected"
                clearable
                options={others.map((f) => ({ value: f.key, label: f.label || f.key }))}
                onChange={(value) => {
                  const map = { ...(config.context_map ?? {}) }
                  if (value) map[ctx.name] = value
                  else delete map[ctx.name]
                  onPatch({ custom: { ...config, context_map: Object.keys(map).length ? map : undefined } })
                }}
              />
              {ctx.description && <p className="mt-0.5 text-2xs text-fg-muted">{ctx.description}</p>}
            </div>
          ))}
          <p className="text-2xs text-fg-muted">Only the connected fields&apos; values are shared with the control (read-only).</p>
        </Section>
      )}

      {config.capabilities?.includes('lookup') && (
        <Section title="Lookup source">
          <LookupProperties state={state} field={{ ...field, lookup: field.lookup ?? { source: 'table' } }} onPatch={(lookup, tag) => onPatch({ lookup }, tag)} />
        </Section>
      )}
      {config.value_type === 'files' && (
        <Section title="Uploads">
          <AttachmentsProperties field={field} onPatch={(attachments, tag) => onPatch({ attachments }, tag)} />
        </Section>
      )}
      {manifest?.network && (
        <p className="text-2xs text-fg-muted">
          Asks for network access to {manifest.network.allowed_hosts.join(', ')}{control && control.approved_hosts.length ? ` — approved: ${control.approved_hosts.join(', ')}` : ' — not approved (no network until an admin approves it in Extensibility)'}.
        </p>
      )}
      {manifest?.accessibility?.keyboard && <p className="text-2xs text-fg-muted">Keyboard: {manifest.accessibility.keyboard}</p>}
    </div>
  )
}
