'use client'

import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SearchableMultiOptionPicker } from '@/components/ui/searchable-multi-option-picker'
import {
  createLogDestinationAction,
  listLogExportWorkflowOptions,
  updateLogDestinationAction,
  type LogDestinationRow,
} from '@/app/actions/log-destinations'
import {
  buildCreateInput,
  buildUpdateInput,
  DATADOG_SITES,
  DESTINATION_TYPES,
  emptyForm,
  EVENT_CATEGORIES,
  exportsRestricted,
  FIELD_TYPES,
  fieldVisible,
  formFromDestination,
  newSecret,
  SEVERITIES,
  TYPE_LABELS,
  validateForm,
  type DestinationForm,
  type DestinationType,
} from './form-state'
import { SecretInput } from './secret-input'
import { TYPE_ICONS } from './destination-status'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>{hint}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold pt-2">{children}</h3>
}

const selectClass = 'flex h-10 w-full rounded-lg border px-3 text-sm'
const selectStyle: React.CSSProperties = {
  borderColor: 'var(--theme-surface-border)',
  backgroundColor: 'var(--theme-topbar)',
  color: 'var(--theme-topbar-text)',
}

export function DestinationDialog({
  open,
  onOpenChange,
  destination,
  canViewSettings,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  destination: LogDestinationRow | null
  canViewSettings: boolean
  onSaved: (result: { name: string; signingSecret?: string }) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(40rem,94vw)] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl p-6 shadow-xl dialog-content"
          style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">
                {destination ? `Edit ${destination.name}` : 'Add log destination'}
              </Dialog.Title>
              <Dialog.Description className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                Events are shipped continuously, at least once, usually within seconds.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 hover:opacity-70" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          {/* Keyed so reopening for another destination starts from fresh state. */}
          {open && (
            <DestinationFormBody
              key={destination?.id ?? 'new'}
              destination={destination}
              canViewSettings={canViewSettings}
              onCancel={() => onOpenChange(false)}
              onSaved={onSaved}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DestinationFormBody({
  destination,
  canViewSettings,
  onCancel,
  onSaved,
}: {
  destination: LogDestinationRow | null
  canViewSettings: boolean
  onCancel: () => void
  onSaved: (result: { name: string; signingSecret?: string }) => void
}) {
  const mode = destination ? 'edit' : 'create'
  const [form, setForm] = useState<DestinationForm>(() => (destination ? formFromDestination(destination) : emptyForm('webhook')))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof DestinationForm>(key: K, value: DestinationForm[K]) => setForm((prev) => ({ ...prev, [key]: value }))

  const { data: workflows } = useQuery({
    queryKey: ['log-export-workflow-options'],
    queryFn: async () => {
      const result = await listLogExportWorkflowOptions()
      return result.ok ? result.data : []
    },
    staleTime: 60_000,
  })
  const workflowOptions = useMemo(
    () => (workflows ?? []).map((w) => ({ value: w.id, label: w.name })),
    [workflows],
  )

  async function save() {
    const invalid = validateForm(form, mode)
    if (invalid) { setError(invalid); return }
    setSaving(true)
    setError(null)
    try {
      if (destination) {
        const result = await updateLogDestinationAction(String(destination.id), buildUpdateInput(form, destination))
        if (!result.ok) { setError(result.error); return }
        onSaved({ name: result.data.log_destination.name })
      } else {
        const result = await createLogDestinationAction(buildCreateInput(form))
        if (!result.ok) { setError(result.error); return }
        onSaved({ name: result.data.log_destination.name, signingSecret: result.data.signing_secret })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const restricted = exportsRestricted(form.categories)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => { e.preventDefault(); void save() }}
    >
      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Production Splunk" />
        </Field>
        <Field label="Type">
          <select
            className={selectClass}
            style={selectStyle}
            value={form.type}
            disabled={mode === 'edit'}
            onChange={(e) => setForm((prev) => ({ ...emptyForm(e.target.value as DestinationType), name: prev.name, categories: prev.categories, types: prev.types, minSeverity: prev.minSeverity, workflowIds: prev.workflowIds }))}
          >
            {DESTINATION_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
          </select>
        </Field>
      </div>

      <TypeFields form={form} set={set} setForm={setForm} mode={mode} />

      <SectionTitle>Filters</SectionTitle>
      <Field label="Categories" hint="None selected = every category.">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {EVENT_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.categories.includes(category)}
                onChange={(e) => set('categories', e.target.checked
                  ? [...form.categories, category]
                  : form.categories.filter((c) => c !== category))}
                className="accent-[color:var(--theme-primary)]"
              />
              {category}
            </label>
          ))}
        </div>
      </Field>
      {restricted && !canViewSettings && (
        <InlineNotice
          tone="warning"
          message="These filters include audit and security events, which need the View settings permission. Pick categories without audit and security."
        />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Event types" hint="Comma-separated, * as a wildcard, e.g. workflow.run.*, *.failed">
          <Input value={form.types} onChange={(e) => set('types', e.target.value)} placeholder="All types" />
        </Field>
        <Field label="Minimum severity">
          <select className={selectClass} style={selectStyle} value={form.minSeverity} onChange={(e) => set('minSeverity', e.target.value)}>
            <option value="">Any (debug and up)</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Workflows" hint="Only events of these workflows. None selected = all.">
        <SearchableMultiOptionPicker
          options={workflowOptions}
          values={form.workflowIds}
          onChange={(values) => set('workflowIds', values)}
          placeholder="All workflows"
          searchPlaceholder="Search workflows…"
          emptyLabel="No workflows"
        />
      </Field>

      <SectionTitle>Delivery</SectionTitle>
      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
          className="accent-[color:var(--theme-primary)]"
        />
        Enabled (uncheck to save paused)
      </label>
      {mode === 'create' && (
        <Field label="Start from">
          <select
            className={selectClass}
            style={selectStyle}
            value={form.startFrom}
            onChange={(e) => set('startFrom', e.target.value as DestinationForm['startFrom'])}
          >
            <option value="now">Now — only new events</option>
            <option value="retention_start">Start of retention — also send events still retained</option>
          </select>
        </Field>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Add destination' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

function TypeFields({
  form,
  set,
  setForm,
  mode,
}: {
  form: DestinationForm
  set: <K extends keyof DestinationForm>(key: K, value: DestinationForm[K]) => void
  setForm: React.Dispatch<React.SetStateAction<DestinationForm>>
  mode: 'create' | 'edit'
}) {
  const Icon = TYPE_ICONS[form.type]
  return (
    <>
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5"><Icon size={14} /> {TYPE_LABELS[form.type]}</span>
      </SectionTitle>

      {form.type === 'splunk_hec' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label="HEC URL" hint="Base URL; events go to /services/collector/event">
              <Input value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://splunk.example.com:8088" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="HEC token">
              <SecretInput value={form.token} onChange={(v) => set('token', v)} placeholder="00000000-0000-0000-0000-000000000000" ariaLabel="HEC token" />
            </Field>
          </div>
          <Field label="Index (optional)"><Input value={form.index} onChange={(e) => set('index', e.target.value)} placeholder="Token default" /></Field>
          <Field label="Sourcetype (optional)"><Input value={form.sourcetype} onChange={(e) => set('sourcetype', e.target.value)} placeholder="usertasks:event" /></Field>
          <Field label="Source (optional)"><Input value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="usertasks" /></Field>
          <Field label="Host (optional)"><Input value={form.host} onChange={(e) => set('host', e.target.value)} /></Field>
        </div>
      )}

      {form.type === 'datadog' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Site">
            <select className={selectClass} style={selectStyle} value={form.site} onChange={(e) => set('site', e.target.value)}>
              {DATADOG_SITES.map((site) => <option key={site} value={site}>{site}</option>)}
            </select>
          </Field>
          <Field label="Service (optional)"><Input value={form.service} onChange={(e) => set('service', e.target.value)} placeholder="usertasks" /></Field>
          <div className="sm:col-span-2">
            <Field label="API key">
              <SecretInput value={form.apiKey} onChange={(v) => set('apiKey', v)} placeholder="Datadog API key" ariaLabel="API key" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Tags (optional)" hint="Comma-separated ddtags, e.g. env:prod, team:ops">
              <Input value={form.tags} onChange={(e) => set('tags', e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {form.type === 'otlp_http' && (
        <>
          <Field label="Endpoint" hint="OTLP/HTTP base endpoint; logs go to /v1/logs">
            <Input value={form.endpoint} onChange={(e) => set('endpoint', e.target.value)} placeholder="https://otel-collector.example.com:4318" />
          </Field>
          <KeyValueEditor
            label="Resource attributes (optional)"
            rows={form.resourceAttributes}
            onChange={(rows) => set('resourceAttributes', rows)}
            keyPlaceholder="deployment.environment"
          />
        </>
      )}

      {form.type === 'webhook' && (
        <>
          <Field label="URL" hint="Receives POST { events: [...] } batches">
            <Input value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://hooks.example.com/usertasks" />
          </Field>
          <Field
            label="Signing secret"
            hint={mode === 'create'
              ? 'Leave blank to generate one — it is shown once after saving.'
              : 'HMAC-SHA256 key for X-UserTasks-Signature.'}
          >
            <SecretInput value={form.signingSecret} onChange={(v) => set('signingSecret', v)} placeholder={mode === 'create' ? 'Generated' : 'New signing secret'} ariaLabel="Signing secret" />
          </Field>
        </>
      )}

      {(form.type === 'otlp_http' || form.type === 'webhook') && (
        <HeadersEditor form={form} setForm={setForm} />
      )}

      {FIELD_TYPES[form.type] && <SpecFields form={form} setForm={setForm} mode={mode} />}
    </>
  )
}

/** Syslog and the cloud destinations: inputs from FIELD_TYPES. */
function SpecFields({ form, setForm, mode }: { form: DestinationForm; setForm: React.Dispatch<React.SetStateAction<DestinationForm>>; mode: 'create' | 'edit' }) {
  const spec = FIELD_TYPES[form.type]!
  const setField = (key: string, value: string) => setForm((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }))
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {spec.config.filter((field) => fieldVisible(field, form.fields)).map((field) => (
        <Field key={field.key} label={field.label} hint={field.hint}>
          {field.options ? (
            <select className={selectClass} style={selectStyle} value={form.fields[field.key] ?? ''} onChange={(e) => setField(field.key, e.target.value)} aria-label={field.label}>
              <option value="">Default ({field.options[0]})</option>
              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <Input value={form.fields[field.key] ?? ''} onChange={(e) => setField(field.key, e.target.value)} placeholder={field.placeholder} inputMode={field.number ? 'numeric' : undefined} />
          )}
        </Field>
      ))}
      {spec.secrets.filter((field) => fieldVisible(field, form.fields)).map((field) => (
        <div key={field.key} className="sm:col-span-2">
          <Field label={field.label} hint={field.hint}>
            <SecretInput
              value={form.fieldSecrets[field.key] ?? newSecret()}
              onChange={(v) => setForm((prev) => ({ ...prev, fieldSecrets: { ...prev.fieldSecrets, [field.key]: v } }))}
              placeholder={mode === 'create' ? '' : 'New value'}
              ariaLabel={field.label}
            />
          </Field>
        </div>
      ))}
    </div>
  )
}

function KeyValueEditor({
  label,
  rows,
  onChange,
  keyPlaceholder,
}: {
  label: string
  rows: Array<{ key: string; value: string }>
  onChange: (rows: Array<{ key: string; value: string }>) => void
  keyPlaceholder: string
}) {
  return (
    <Field label={label}>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={row.key} placeholder={keyPlaceholder} onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
            <Input value={row.value} placeholder="value" onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
            <Button type="button" variant="ghost" size="icon" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { key: '', value: '' }])}>
          <Plus size={12} /> Add attribute
        </Button>
      </div>
    </Field>
  )
}

function HeadersEditor({ form, setForm }: { form: DestinationForm; setForm: React.Dispatch<React.SetStateAction<DestinationForm>> }) {
  const update = (i: number, patch: Partial<DestinationForm['headers'][number]>) =>
    setForm((prev) => ({ ...prev, headers: prev.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) }))
  return (
    <Field
      label="Headers (optional)"
      hint={form.type === 'otlp_http'
        ? 'Sent with every export, e.g. an API key for Grafana Cloud, Honeycomb or New Relic. Values are stored encrypted and never shown again.'
        : 'Extra headers sent with every batch. Values are stored encrypted and never shown again.'}
    >
      <div className="space-y-2">
        {form.headers.map((header, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="w-2/5 shrink-0">
              <Input value={header.name} placeholder="x-api-key" onChange={(e) => update(i, { name: e.target.value })} aria-label="Header name" />
            </div>
            <div className="flex-1 min-w-0">
              <SecretInput value={header.value} onChange={(value) => update(i, { value })} placeholder="value" ariaLabel={`${header.name || 'Header'} value`} />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove header"
              onClick={() => setForm((prev) => ({ ...prev, headers: prev.headers.filter((_, j) => j !== i) }))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setForm((prev) => ({ ...prev, headers: [...prev.headers, { name: '', value: newSecret() }] }))}
        >
          <Plus size={12} /> Add header
        </Button>
      </div>
    </Field>
  )
}
