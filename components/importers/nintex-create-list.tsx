'use client'

/**
 * "Create a SharePoint list for this workflow" (any extension offering
 * NintexImportHook.createTargetInfo / createTarget; core knows no SharePoint):
 * the name, where (e.g. a connected site; the current one in the embedded
 * designer), list or library, and the columns the Nintex workflow uses
 * (report.details.workflows[n].columnsNeeded — display name, internal name,
 * type, required, choices; editable, removable, more can be added), and
 * "Connect this list and bind the workflow to it" (on by default): the
 * import target becomes the new list.
 *
 * A name that exists already: use that list (its missing columns then go
 * through the column check) or pick another name. A retry of the same
 * attempt (same request id) finishes it instead of clashing with itself.
 */

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { KIND_LABELS } from './nintex-column-check'

export interface CreateTargetInfo {
  extension: string
  extensionName: string
  label: string
  description?: string | null
  containers: Array<{ value: string; label: string }>
  defaultContainer?: string | null
  containerLabel?: string
  kinds: Array<{ value: string; label: string }>
  creatable: string[]
  canCreate: boolean
  reason?: string | null
}

export interface NeededColumn { key: string; label: string; kind: string; required?: boolean; choices?: string[]; description?: string | null; source?: string; note?: string }

export interface CreatedTarget { id: string; config: Record<string, unknown>; title: string; existing: boolean; created: Array<{ key: string; label: string }>; failed: Array<{ label: string; reason: string }>; url: string | null; notes: string[] }

interface Row extends NeededColumn { id: string; include: boolean; choicesText: string }

const SELECT = 'h-8 w-full rounded-md border border-border bg-surface px-2 text-xs'

const newId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`)

/** A valid internal name from a display name (letters, digits, _; ≤ 32). */
export function internalNameFrom(label: string): string {
  const plain = label.replace(/[^A-Za-z0-9]/g, '')
  return (/^[A-Za-z]/.test(plain) ? plain : `Col${plain}`).slice(0, 32) || 'Column'
}

export function NintexCreateList({ info, defaults, columns, onCancel, onCreated }: {
  info: CreateTargetInfo
  defaults: { name: string; kind: string }
  columns: NeededColumn[]
  onCancel: () => void
  /** The list exists now (`bind`: make it the import target). */
  onCreated: (target: CreatedTarget, bind: boolean) => void
}) {
  const [name, setName] = useState(defaults.name)
  const [container, setContainer] = useState(info.defaultContainer ?? info.containers[0]?.value ?? '')
  const [kind, setKind] = useState(info.kinds.some((k) => k.value === defaults.kind) ? defaults.kind : info.kinds[0]?.value ?? '')
  const [rows, setRows] = useState<Row[]>(() => columns.map((c) => ({ ...c, id: newId(), include: true, required: Boolean(c.required), choicesText: (c.choices ?? []).join(', ') })))
  const [bind, setBind] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clash, setClash] = useState<string | null>(null)
  // One id per attempt: a retry finishes the same list instead of clashing with it.
  const [requestId, setRequestId] = useState(newId)
  const kinds = useMemo(() => info.creatable.length ? info.creatable : ['text'], [info.creatable])

  const patch = (id: string, p: Partial<Row>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r)))

  const submit = async (ifExists: 'fail' | 'use') => {
    setBusy(true); setError(null)
    try {
      const included = rows.filter((r) => r.include && r.label.trim())
      const res = await fetch('/api/internal/importers/nintex/create-target', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extension: info.extension, name: name.trim(), container, kind, if_exists: ifExists, request_id: requestId,
          columns: included.map((r) => ({
            key: r.key.trim() || internalNameFrom(r.label), label: r.label.trim(), kind: r.kind, required: r.required === true,
            ...((r.kind === 'choice' || r.kind === 'multichoice') ? { choices: r.choicesText.split(',').map((x) => x.trim()).filter(Boolean) } : {}),
            ...(r.description ? { description: r.description } : {}),
          })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.code === 'exists') { setClash(json.error ?? `"${name}" exists already.`); return }
      if (!res.ok) { setError(json.error ?? `Creating it failed (${res.status})`); return }
      onCreated(json as CreatedTarget, bind)
    } catch {
      setError('Creating it failed — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  const bad = rows.filter((r) => r.include && (r.kind === 'choice' || r.kind === 'multichoice') && !r.choicesText.trim())
  return (
    <div className="space-y-3" data-testid="nintex-create-list">
      <div>
        <p className="text-sm font-semibold">{info.label}</p>
        {info.description && <p className="text-xs text-fg-muted">{info.description}</p>}
      </div>
      {!info.canCreate && <InlineNotice tone="warning" message={info.reason ?? 'You cannot create lists here.'} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input value={name} onChange={(e) => { setName(e.target.value); setClash(null); setRequestId(newId()) }} data-testid="nintex-list-name" /></Field>
        <Field label={info.containerLabel ?? 'Site'}>
          <select className={SELECT} value={container} onChange={(e) => { setContainer(e.target.value); setClash(null) }} aria-label={info.containerLabel ?? 'Site'}>
            {info.containers.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="Kind">
          <select className={SELECT} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="List or library">
            {info.kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
      </div>
      <div className="rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-fg-muted"><th className="px-2 py-1">Display name</th><th className="px-2 py-1">Internal name</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Required</th><th className="px-2 py-1">Choices</th><th className="px-2 py-1"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-2 py-2 text-fg-muted">No columns beyond the list&apos;s own (Title, Created, Modified …).</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top" data-column-row={r.key}>
                <td className="px-2 py-1"><Input value={r.label} onChange={(e) => patch(r.id, { label: e.target.value })} aria-label="Display name" />{r.note && <span className="mt-0.5 block text-fg-muted">{r.note}</span>}{r.source === 'start_form' && <span className="mt-0.5 block text-fg-muted">From the start form</span>}</td>
                <td className="px-2 py-1"><Input value={r.key} onChange={(e) => patch(r.id, { key: e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 32) })} aria-label="Internal name" /></td>
                <td className="px-2 py-1">
                  <select className={SELECT} value={r.kind} onChange={(e) => patch(r.id, { kind: e.target.value })} aria-label="Type">
                    {[...new Set([r.kind, ...kinds])].map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1"><Checkbox checked={Boolean(r.required)} onChange={(e) => patch(r.id, { required: e.target.checked })} aria-label="Required" /></td>
                <td className="px-2 py-1">{(r.kind === 'choice' || r.kind === 'multichoice') ? <Input value={r.choicesText} onChange={(e) => patch(r.id, { choicesText: e.target.value })} placeholder="A, B, C" aria-label="Choices" /> : <span className="text-fg-muted">—</span>}</td>
                <td className="px-2 py-1"><Button size="sm" variant="ghost" onClick={() => setRows((list) => list.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.label}`}><Trash2 className="size-3.5" aria-hidden /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-border px-2 py-1.5">
          <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={() => setRows((list) => [...list, { id: newId(), key: '', label: '', kind: 'text', include: true, required: false, choicesText: '' }])}>Add a column</Button>
        </div>
      </div>
      <Checkbox checked={bind} onChange={(e) => setBind(e.target.checked)} label="Connect this list and bind the workflow to it" description="The import then goes onto the new list, starting on the events of the Nintex start options." data-testid="nintex-list-bind" />
      {bad.length > 0 && <InlineNotice tone="warning" message={`Give choices for ${bad.map((r) => r.label || 'the new column').join(', ')}, or pick another type.`} />}
      {clash && (
        <InlineNotice tone="warning" title="That name is taken" message={clash}>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void submit('use')} disabled={busy} data-testid="nintex-list-use-existing">Use the existing list</Button>
            <span className="self-center text-xs text-fg-muted">or change the name above</span>
          </div>
        </InlineNotice>
      )}
      {error && <InlineNotice tone="danger" message={error} />}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Back</Button>
        <Button onClick={() => void submit('fail')} disabled={busy || !info.canCreate || !name.trim() || !container || bad.length > 0 || Boolean(clash)} data-testid="nintex-list-create">{busy ? 'Creating…' : 'Create the list'}</Button>
      </div>
    </div>
  )
}
