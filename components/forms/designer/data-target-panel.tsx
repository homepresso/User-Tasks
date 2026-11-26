'use client'

/**
 * The form designer's "Connected to …" panel (Form settings) for a form
 * bound to an external record through a data target an extension provides
 * (lib/forms/data-target.ts): what the provider says about the binding, in
 * plain words — what it is connected to (and a link to it), how records load,
 * which form field writes which source field, options and warnings — and
 * the provider's actions (e.g. replacing / restoring a SharePoint list's own
 * forms).
 *
 * Mapping and options are edited here and saved with the form: a change asks
 * the provider for the binding's new config (`bind`, nothing saved yet), and
 * the designer state takes it, so the normal Save stores it. A field type
 * that cannot hold a source field is not offered (and the provider refuses
 * it); unmapping a field that is required in the source asks first.
 */

import { useConfirm } from '@/components/ui/use-confirm'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { serverRead } from '@/lib/server-read'
import { bindFormDataTarget, runFormDataTargetAction } from '@/app/actions/forms'
import { definitionFrom, designerId, type DesignerState, type DesignerField } from '@/lib/forms/designer-state'
import type { FormTargetDescription } from '@/lib/extensions/sdk'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'

type Described = { label: string; description: FormTargetDescription | null; actions: boolean; bind: boolean }

/** New fields from the provider → designer fields, each on its own row (last page of a paged form). */
export function withAddedFields(state: DesignerState, fields: Array<Record<string, unknown>>, layout: Record<string, unknown>): DesignerState {
  const added = fields.map((f) => ({ ...f, _id: designerId(), _keyLocked: true }) as unknown as DesignerField)
  const rows = added.map((f) => ({ columns: 1, cells: [{ field_key: f.key, span: 1 }] }))
  const next = { ...state.layout, ...layout } as DesignerState['layout'] & { pages?: Array<{ rows?: unknown[] }>; rows?: unknown[] }
  if (rows.length) {
    if (Array.isArray(next.pages) && next.pages.length) {
      const pages = [...next.pages]
      const last = { ...pages[pages.length - 1] }
      last.rows = [...(Array.isArray(last.rows) ? last.rows : []), ...rows]
      pages[pages.length - 1] = last
      next.pages = pages as never
    } else next.rows = [...(Array.isArray(next.rows) ? next.rows : []), ...rows] as never
  }
  return { ...state, fields: [...state.fields, ...added], layout: next }
}

/**
 * The provider's description of the form's binding (one cached read shared by the
 * "Connected to" panel, the button editors' "Reset to … default" and the canvas).
 * Disabled for unsaved or unbound forms.
 */
export function useTargetDescription(formId: string | null | undefined, state: DesignerState) {
  const def = definitionFrom(state)
  const target = ((def.layout ?? {}) as unknown as Record<string, unknown>).data_target ?? null
  const configKey = JSON.stringify(target) + def.fields.map((f) => `${f.key}:${f.type}`).join(',')
  return useQuery({
    queryKey: ['form-target-describe', formId, configKey],
    staleTime: 30_000,
    enabled: Boolean(formId && target),
    queryFn: async () => {
      const res = await serverRead('forms.targetDescribe', { id: formId!, fields: def.fields as never, layout: def.layout as never })
      if (res.error) throw new Error(res.error.message)
      return res.data as Described
    },
  })
}

export function DataTargetPanel({ formId, state, onChange, compact = false }: { formId: string; state: DesignerState; onChange: (next: DesignerState, tag?: string) => void; /** Inside the Save to … action: the mapping, columns to add and warnings only (the same binding). */ compact?: boolean }) {
  const [confirm, confirmDialog] = useConfirm()
  const queryClient = useQueryClient()
  const def = definitionFrom(state)
  const { data, error, isPending } = useTargetDescription(formId, state)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [confirmUnmap, setConfirmUnmap] = useState<{ field: string; source: string; label: string } | null>(null)
  const d = data?.description ?? null

  async function bind(input: { mappings?: Array<{ field: string; source: string | null }>; add?: string[]; options?: Record<string, string | boolean> }) {
    setBusy(true); setMessage(null)
    try {
      const res = await bindFormDataTarget(formId, { fields: def.fields, layout: (def.layout ?? {}) as unknown as Record<string, unknown>, ...input })
      if (!res.ok) { setMessage({ tone: 'error', text: res.error }); return }
      onChange(withAddedFields(state, res.data.fields as unknown as Array<Record<string, unknown>>, res.data.layout), 'data-target')
      setMessage({ tone: 'ok', text: 'Changed. Save the form to keep it.' })
    } finally {
      setBusy(false)
    }
  }

  async function act(id: string, question?: string | null, label = 'Continue', danger = false) {
    if (question && !(await confirm({ title: `${label}?`, description: question, confirmLabel: label, destructive: danger }))) return
    setBusy(true); setMessage(null)
    try {
      const res = await runFormDataTargetAction(formId, id)
      if (!res.ok) { setMessage({ tone: 'error', text: res.error }); return }
      setMessage({ tone: 'ok', text: res.data.message ?? 'Done.' })
      void queryClient.invalidateQueries({ queryKey: ['form-target-describe', formId] })
    } finally {
      setBusy(false)
    }
  }

  if (isPending) return <p className="text-2xs text-fg-muted" data-target-panel="loading">Reading the connection…</p>
  if (error) return <p className="text-2xs text-(--status-blocked)" role="alert">{error instanceof Error ? error.message : 'The connection could not be read.'}</p>
  if (!d) return <p className="text-2xs text-fg-muted">Connected to {data?.label ?? 'an external system'}.</p>

  const sourceByKey = new Map(d.sourceFields.map((f) => [f.key, f]))
  const mapped = new Map(d.mappings.map((m) => [m.field, m]))
  const valueFields = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type))
  const usedSources = new Set(d.mappings.map((m) => m.source).filter(Boolean))
  // Read-only columns (system ones too: ID, Created By, Version …) can be added to show them — or as an editable copy that is never written back.
  const addable = d.sourceFields.filter((s) => !usedSources.has(s.key) && s.fieldTypes.length)

  const setMapping = (field: string, source: string | null) => {
    const current = mapped.get(field)?.source ?? null
    const was = current ? sourceByKey.get(current) : null
    if (!source && was?.required && !confirmUnmap) { setConfirmUnmap({ field, source: was.key, label: was.label }); return }
    setConfirmUnmap(null)
    void bind({ mappings: [{ field, source }] })
  }

  return (
    <div className="space-y-3 text-2xs" data-target-panel>
      {confirmDialog}
      {!compact && <div>
        <p className="font-medium text-fg">{d.title}</p>
        {d.link && <a className="inline-flex items-center gap-1 text-primary-text underline" href={d.link.url} target="_blank" rel="noreferrer">{d.link.label} <ExternalLink size={10} aria-hidden /></a>}
      </div>}
      {!compact && d.facts && d.facts.length > 0 && (
        <dl className="space-y-1.5" data-target-facts>
          {d.facts.map((f) => (
            <div key={f.label}>
              <dt className="text-fg-muted">{f.label}</dt>
              <dd className="text-fg">{f.value}{f.help && <span className="block text-fg-muted">{f.help}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.notes && d.notes.length > 0 && (
        <ul className="space-y-1" data-target-notes>
          {d.notes.filter((n) => !compact || n.severity !== 'info').map((n, i) => (
            <li key={i} className={`flex gap-1.5 rounded border px-2 py-1 ${n.severity === 'error' ? 'border-(--status-blocked) text-fg' : n.severity === 'warning' ? 'border-warning text-fg' : 'border-border text-fg-muted'}`}>
              {n.severity === 'info' ? <Info size={11} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />}<span>{n.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-1 font-medium text-fg">Fields and where they are saved</p>
        <table className="w-full border-collapse" data-target-mapping>
          <tbody>
            {valueFields.map((f) => {
              const m = mapped.get(f.key)
              const options = d.sourceFields.filter((s) => s.fieldTypes.includes(f.type))
              const blocked = d.sourceFields.filter((s) => s.fieldTypes.length && !s.fieldTypes.includes(f.type))
              return (
                <tr key={f._id} className="border-t border-border align-top" data-mapping-field={f.key}>
                  <td className="py-1 pr-2 text-fg">{f.label || f.key}</td>
                  <td className="py-1">
                    {m?.locked ? (
                      <span className="text-fg-muted">{m.note ?? sourceByKey.get(m.source ?? '')?.label ?? 'Managed by the connection'}</span>
                    ) : (
                      <select aria-label={`Where "${f.label || f.key}" is saved`} className="w-full rounded border border-border bg-bg px-1 py-0.5" disabled={busy || !data?.bind}
                        value={m?.source ?? ''} onChange={(e) => setMapping(f.key, e.target.value || null)}>
                        <option value="">Not saved there (only in UserTasks)</option>
                        {options.map((s) => <option key={s.key} value={s.key}>{s.label} ({s.typeLabel}){s.required ? ' — required' : ''}{s.readOnly ? ' — read-only: shown, not saved' : ''}</option>)}
                        {blocked.length > 0 && (
                          <optgroup label="Can't hold this field's type">
                            {blocked.map((s) => <option key={s.key} value={s.key} disabled>{s.label} ({s.typeLabel})</option>)}
                          </optgroup>
                        )}
                      </select>
                    )}
                    {m?.note && !m.locked && <span className="block text-fg-muted">{m.note}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {confirmUnmap && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-warning px-2 py-1.5" role="alertdialog" aria-label="Stop saving a required field?" data-confirm-unmap>
            <span className="flex-1">“{confirmUnmap.label}” is required there: new records will fail unless it gets a value another way. Stop saving this field there?</span>
            <Button size="sm" variant="outline" onClick={() => setConfirmUnmap(null)}>Keep it</Button>
            <Button size="sm" variant="destructive" onClick={() => { const c = confirmUnmap; setConfirmUnmap(null); void bind({ mappings: [{ field: c.field, source: null }] }) }}>Stop saving it</Button>
          </div>
        )}
      </div>

      {addable.length > 0 && data?.bind && (
        <div data-target-add>
          <p className="mb-1 font-medium text-fg">Not on the form yet</p>
          <ul className="flex flex-wrap gap-1">
            {addable.map((s) => (
              <li key={s.key}>
                <button type="button" disabled={busy} className="rounded border border-border px-1.5 py-0.5 text-primary-text disabled:opacity-50" onClick={() => void bind({ add: [s.key] })} data-add-source={s.key}
                  title={s.help ?? undefined}>
                  + {s.label}{s.required ? ' (required)' : ''}{s.readOnly ? ' (read-only)' : ''}{s.isNew ? ' — new' : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && d.options && d.options.length > 0 && (
        <div className="space-y-1.5" data-target-options>
          {d.options.map((o) => (
            <label key={o.key} className="block">
              {o.type === 'boolean' ? (
                <span className="flex items-start gap-1.5">
                  <input type="checkbox" className="mt-0.5 accent-primary" checked={o.value === true} disabled={busy || !data?.bind} onChange={(e) => void bind({ options: { [o.key]: e.target.checked } })} />
                  <span>{o.label}{o.help && <span className="block text-fg-muted">{o.help}</span>}</span>
                </span>
              ) : (
                <>
                  <span className="block text-fg-muted">{o.label}</span>
                  <select className="w-full rounded border border-border bg-bg px-1 py-0.5" value={String(o.value)} disabled={busy || !data?.bind} onChange={(e) => void bind({ options: { [o.key]: e.target.value } })}>
                    {(o.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  {o.help && <span className="block text-fg-muted">{o.help}</span>}
                </>
              )}
            </label>
          ))}
        </div>
      )}

      {!compact && d.actions && d.actions.length > 0 && data?.actions && (
        <div className="flex flex-wrap gap-1.5" data-target-actions>
          {d.actions.map((a) => (
            <Button key={a.id} size="sm" variant={a.tone === 'danger' ? 'destructive' : 'outline'} disabled={busy} title={a.help ?? undefined} onClick={() => void act(a.id, a.confirm, a.label, a.tone === 'danger')} data-target-action={a.id}>{a.label}</Button>
          ))}
        </div>
      )}
      {message && <p className={message.tone === 'error' ? 'text-(--status-blocked)' : 'text-fg-muted'} role="status">{message.text}</p>}
    </div>
  )
}
