'use client'

/**
 * One extension settings page, rendered by core from the manifest's
 * settings schema (the connector / provider field model): sections of typed
 * fields with visibleWhen / requiredWhen, write-only secret and certificate
 * fields (shown as set / not set, replaced or cleared, never displayed),
 * client-side checks with the same rules the server applies on save
 * (lib/extensions/settings), and the page's action buttons (e.g. "Test
 * connection", run with the unsaved values minus secrets).
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { SettingsSaveBar, SettingsSection, SettingsSections } from '@/components/settings/settings-section'
import { useJobs } from '@/components/jobs/jobs-provider'
import type { SettingField, SettingsSchema } from '@/lib/extensions/manifest'
import { isFieldRequired, isFieldVisible, isSecretField, validateSettings } from '@/lib/extensions/settings'
import { getExtensionManifest } from '@/lib/extensions/registry'
import { getExtensionSettingsAction, saveExtensionSettingsAction } from '@/app/actions/extensions'
import { EXTENSIONS_CHANGED_EVENT } from './extensions-provider'
import { useExtensionAction } from './use-extension-action'

type Values = Record<string, unknown>

function FieldControl({ field, value, onChange, secretSet, onClearSecret, ...aria }: {
  field: SettingField
  value: unknown
  onChange: (value: unknown) => void
  secretSet: boolean
  onClearSecret: () => void
  /** id / aria-describedby / aria-invalid from <Field>. */
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  if (field.type === 'boolean') {
    return <Switch {...aria} checked={value === true} onCheckedChange={onChange} label={value === true ? 'On' : 'Off'} aria-label={field.label} />
  }
  if (field.type === 'select') {
    return (
      <Select {...aria} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>
        {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    )
  }
  if (field.type === 'multiselect') {
    const selected = new Set(Array.isArray(value) ? value.map(String) : [])
    return (
      <div className="flex flex-wrap gap-3" role="group" aria-label={field.label}>
        {(field.options ?? []).map((o) => (
          <label key={o.value} className="inline-flex items-center gap-1.5 text-ui text-fg">
            <input type="checkbox" checked={selected.has(o.value)} onChange={(e) => {
              const next = new Set(selected)
              if (e.target.checked) next.add(o.value)
              else next.delete(o.value)
              onChange([...next])
            }} />
            {o.label}
          </label>
        ))}
      </div>
    )
  }
  if (isSecretField(field)) {
    const text = typeof value === 'string' ? value : ''
    return (
      <div className="space-y-1.5">
        {field.type === 'certificate'
          ? <Textarea {...aria} value={text} rows={4} className="font-mono text-xs" placeholder={secretSet ? 'Stored — paste a new one to replace it' : '-----BEGIN CERTIFICATE-----'} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} />
          : <Input {...aria} type="password" value={text} placeholder={secretSet ? '•••••••• (stored — type to replace)' : field.placeholder} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" />}
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <KeyRound className="size-3.5" aria-hidden />
          {value === null ? <span>Will be cleared on save</span> : secretSet ? <Badge tone="success" pill>Set</Badge> : <span>Not set</span>}
          {secretSet && value !== null && <Button type="button" variant="link" size="sm" className="h-auto" onClick={onClearSecret}>Clear</Button>}
          <span>Encrypted; never shown again.</span>
        </div>
      </div>
    )
  }
  if (field.type === 'textarea' || field.type === 'json') {
    const text = field.type === 'json' && value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? '')
    return <Textarea {...aria} value={text} rows={field.type === 'json' ? 6 : 3} className={field.type === 'json' ? 'font-mono text-xs' : undefined} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
  }
  return (
    <Input
      {...aria}
      type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text'}
      value={value === null || value === undefined ? '' : String(value)}
      min={field.min}
      max={field.max}
      maxLength={field.maxLength}
      placeholder={field.placeholder}
      onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
    />
  )
}

export function ExtensionSettingsPage({ extensionId, pageId }: { extensionId: string; pageId: string }) {
  const jobs = useJobs()
  const queryClient = useQueryClient()
  const action = useExtensionAction()
  const manifest = getExtensionManifest(extensionId)
  const queryKey = ['extension-settings', extensionId, pageId]
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await getExtensionSettingsAction(extensionId, pageId)
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
  })
  const [values, setValues] = useState<Values>({})
  const [secrets, setSecrets] = useState<Record<string, string | null>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!data) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form to the stored values
    setValues(data.values)
    setSecrets({})
  }, [data])

  const schema = data?.page.schema as SettingsSchema | undefined
  const secretsSet = useMemo(() => new Set(data?.secrets_set ?? []), [data])
  const view = useMemo(() => ({ ...values, ...Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v ?? ''])) }), [values, secrets])
  const checked = useMemo(() => (schema ? validateSettings(schema, view, new Set([...secretsSet].filter((k) => secrets[k] !== null))) : null), [schema, view, secretsSet, secrets])
  const dirty = Boolean(data) && (JSON.stringify(values) !== JSON.stringify(data!.values) || Object.keys(secrets).length > 0)

  async function save() {
    setSubmitted(true)
    if (!schema || (checked && Object.keys(checked.errors).length)) return
    setSaving(true)
    setSaveError(null)
    const payload: Values = { ...values }
    for (const [key, value] of Object.entries(secrets)) {
      if (value === null) payload[key] = null
      else if (value) payload[key] = value
    }
    const result = await saveExtensionSettingsAction(extensionId, pageId, payload)
    setSaving(false)
    if (!result.ok) { setSaveError(result.error); return }
    queryClient.setQueryData(queryKey, result.data)
    setSubmitted(false)
    jobs.notify({ tone: 'success', title: 'Settings saved' })
    window.dispatchEvent(new Event(EXTENSIONS_CHANGED_EVENT))
  }

  if (isLoading) return <PageSkeleton variant="settings" />
  if (error || !data || !schema) return <InlineNotice tone="danger">{(error as Error | null)?.message ?? 'Settings unavailable'}</InlineNotice>

  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save() }} data-testid="extension-settings">
      <PageHeader
        title={data.page.label}
        description={data.page.description ?? `${manifest?.name ?? extensionId} · ${data.page.scope === 'user' ? 'Personal' : data.page.scope === 'instance' ? 'Instance' : 'Workspace'} settings`}
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Extensions', href: '/settings/extensions' }, { label: data.page.label }]}
        actions={schema.actions?.length ? (
          <div className="flex gap-2">
            {schema.actions.map((a) => (
              <Button key={a.id} type="button" variant="secondary" size="sm" loading={action.busy}
                onClick={() => action.run({ extensionId, action: a.action, label: a.label, settings: { page: pageId, values } })}>
                {a.label}
              </Button>
            ))}
          </div>
        ) : undefined}
      />
      <SettingsSections>
        {schema.sections.map((section) => (
          <SettingsSection key={section.id} id={`ext-${section.id}`} title={section.title} description={section.description}>
            <div className="space-y-4">
              {section.fields.filter((f) => isFieldVisible(f, view)).map((field) => {
                const secret = isSecretField(field)
                const value = secret ? (field.key in secrets ? secrets[field.key] : '') : values[field.key]
                const required = isFieldRequired(field, view)
                const err = submitted ? checked?.errors[field.key] : undefined
                return (
                  <Field key={field.key} label={field.label} description={field.help} error={err} optional={!required}>
                    <FieldControl
                      field={field}
                      value={value}
                      secretSet={secretsSet.has(field.key)}
                      onClearSecret={() => setSecrets((s) => ({ ...s, [field.key]: null }))}
                      onChange={(next) => secret
                        ? setSecrets((s) => ({ ...s, [field.key]: String(next ?? '') }))
                        : setValues((v) => ({ ...v, [field.key]: next }))}
                    />
                  </Field>
                )
              })}
            </div>
          </SettingsSection>
        ))}
      </SettingsSections>
      <p className="text-xs text-fg-subtle">Version {data.config_version}</p>
      <SettingsSaveBar dirty={dirty} saving={saving} error={saveError} onDiscard={() => { setValues(data.values); setSecrets({}); setSubmitted(false) }} saveTestId="extension-settings-save" />
      {action.confirmDialog}
    </form>
  )
}
