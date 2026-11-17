'use client'

/**
 * The Nintex import's column check (report.details.workflows[n].columns,
 * lib/importers/nintex/columns.ts): matched, type mismatch (a warning) and
 * missing columns of the connected list, then "Add these columns to <list>?"
 * with a checkbox and a suggested type per missing column. Adding posts to
 * /api/internal/importers/nintex/columns (the extension checks the person may
 * change the list); the dialog analyses again afterwards.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { cn } from '@/lib/utils'

export interface ColumnRow {
  name: string
  display: string
  nintexType: string | null
  usages: string[]
  actions: string[]
  status: 'matched' | 'type_mismatch' | 'missing'
  by?: 'internal' | 'display'
  column?: { key: string; label: string; typeLabel: string }
  note?: string
  suggestion?: { key: string; label: string; kind: string; typeLabel: string; creatable: boolean; choices?: string[]; description?: string | null }
}

export interface ColumnCheckView {
  title: string
  rows: ColumnRow[]
  counts: { matched: number; type_mismatch: number; missing: number }
  canCreate: boolean
  createReason: string | null
  creatable: string[]
}

/** Plain labels of the column kinds (lib/importers/nintex/columns.ts COLUMN_KIND_LABEL). */
export const KIND_LABELS: Record<string, string> = {
  text: 'Single line of text', note: 'Multiple lines of text', number: 'Number', currency: 'Currency', integer: 'Integer',
  datetime: 'Date and time', boolean: 'Yes/No', choice: 'Choice', multichoice: 'Choice (multiple)', person: 'Person or group',
  people: 'Person or group (multiple)', lookup: 'Lookup', lookupmulti: 'Lookup (multiple)', url: 'Hyperlink',
}

const SELECT = 'h-8 rounded-md border border-border bg-surface px-2 text-xs'

const USE: Record<string, string> = { read: 'read', write: 'written', condition: 'in a condition', lookup: 'looked up' }

export function NintexColumnCheck({ check, target, targetConfig, onAdded }: {
  check: ColumnCheckView
  target: string
  targetConfig: Record<string, unknown>
  /** Columns were added: analyse again. */
  onAdded: (message: string) => void
}) {
  const missing = useMemo(() => check.rows.filter((r) => r.status === 'missing'), [check])
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(missing.map((r) => [r.name, Boolean(r.suggestion?.creatable)])))
  const [kinds, setKinds] = useState<Record<string, string>>(() => Object.fromEntries(missing.map((r) => [r.name, r.suggestion?.kind ?? 'text'])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = missing.filter((r) => picked[r.name])

  const add = async () => {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/internal/importers/nintex/columns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target, target_config: targetConfig,
          columns: chosen.map((r) => {
            const kind = kinds[r.name] ?? r.suggestion?.kind ?? 'text'
            return { key: r.suggestion?.key ?? r.name, label: r.suggestion?.label ?? r.display, kind, ...((kind === 'choice' || kind === 'multichoice') && r.suggestion?.choices?.length ? { choices: r.suggestion.choices } : {}), description: r.suggestion?.description ?? null }
          }),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? `Adding the columns failed (${res.status})`); return }
      const created = (json.created ?? []) as Array<{ label: string }>
      const failed = (json.failed ?? []) as Array<{ label: string; reason: string }>
      onAdded([created.length ? `Added ${created.length} column(s) to ${check.title}: ${created.map((c) => c.label).join(', ')}.` : '', failed.length ? `Not added: ${failed.map((f) => `${f.label} (${f.reason})`).join('; ')}.` : ''].filter(Boolean).join(' ') || 'No column was added.')
    } catch {
      setError('Adding the columns failed — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-testid="nintex-columns">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-semibold">Columns of {check.title}</p>
        <span className="text-xs text-fg-muted">{check.counts.matched} matched · {check.counts.type_mismatch} to check · {check.counts.missing} missing</span>
      </div>
      {check.rows.length === 0 && <p className="text-xs text-fg-muted">The workflow uses no columns of the item.</p>}
      <ul className="max-h-56 space-y-1 overflow-auto text-xs" aria-label="Column check">
        {check.rows.map((r) => (
          <li key={r.name} className="flex gap-1.5" data-column-status={r.status}>
            {r.status === 'matched' ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="Matched" /> : r.status === 'type_mismatch' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label="Type mismatch" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="Missing" />}
            <span>
              <span className="font-semibold">{r.display}</span>
              {r.display !== r.name && <span className="text-fg-muted"> ({r.name})</span>}
              {r.column ? <> → {r.column.label} <span className="text-fg-muted">({r.column.typeLabel})</span></> : <span className="text-danger"> — not on the list</span>}
              <span className="text-fg-muted"> · {r.usages.map((u) => USE[u] ?? u).join(', ')}{r.nintexType ? ` · Nintex: ${r.nintexType}` : ''}</span>
              {r.note && <span className="block text-fg-muted">{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3" data-testid="nintex-add-columns">
          <p className="text-sm font-semibold">Add these columns to {check.title}?</p>
          {!check.canCreate && <InlineNotice tone="warning" message={check.createReason ?? 'You cannot add columns to this list from here. Add them in SharePoint, or import and change the flagged steps.'} />}
          <ul className="space-y-1.5">
            {missing.map((r) => (
              <li key={r.name} className="flex flex-wrap items-center gap-2 text-xs">
                <Checkbox checked={Boolean(picked[r.name])} disabled={!check.canCreate} onChange={(e) => setPicked((p) => ({ ...p, [r.name]: e.target.checked }))} label={r.suggestion?.label ?? r.display} aria-label={`Add ${r.display}`} />
                <select className={SELECT} value={kinds[r.name] ?? 'text'} disabled={!check.canCreate || !picked[r.name]} onChange={(e) => setKinds((k) => ({ ...k, [r.name]: e.target.value }))} aria-label={`Type of ${r.display}`}>
                  {[...new Set([kinds[r.name] ?? 'text', ...check.creatable])].map((k) => <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>)}
                </select>
                {(kinds[r.name] === 'choice' || kinds[r.name] === 'multichoice') && r.suggestion?.choices?.length ? <span className="text-fg-muted">choices: {r.suggestion.choices.join(', ')}</span> : null}
                {(kinds[r.name] === 'choice' || kinds[r.name] === 'multichoice') && !r.suggestion?.choices?.length ? <span className="text-warning">no choices known: pick another type</span> : null}
              </li>
            ))}
          </ul>
          {error && <InlineNotice tone="danger" message={error} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void add()} disabled={!check.canCreate || !chosen.length || busy} data-testid="nintex-add-columns-confirm">{busy ? 'Adding…' : `Add ${chosen.length} column${chosen.length === 1 ? '' : 's'}`}</Button>
            <span className={cn('text-xs text-fg-muted')}>Or import without them: the steps that use a missing column are flagged in the designer.</span>
          </div>
        </div>
      )}
    </div>
  )
}
