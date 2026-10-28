'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Pause, Pencil, Play, Plus, RotateCcw, ScrollText, Send, Terminal, Trash2 } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { formatRelativeDate } from '@/lib/utils'
import {
  deleteLogDestinationAction,
  listLogDestinationsWithStatus,
  resetLogDestinationCursorAction,
  setLogDestinationEnabledAction,
  testLogDestinationAction,
  type LogDestinationRow,
  type LogDestinationStatus,
  type LogDestinationTestResult,
} from '@/app/actions/log-destinations'
import { TYPE_LABELS, type DestinationType } from './form-state'
import { DestinationStatusBadge, formatLagSeconds, TYPE_ICONS } from './destination-status'
import { DestinationDialog } from './destination-dialog'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'

const QUERY_KEY = ['log-destinations']

type Entry = { destination: LogDestinationRow; status: LogDestinationStatus | null }
type Notice = { tone: 'success' | 'warning' | 'error'; message: string }

export function LogExportSettings() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const canView = can('observability.view')
  const canEdit = canView && can('settings.edit')
  const canViewSettings = can('settings.view')

  const [dialog, setDialog] = useState<{ open: boolean; destination: LogDestinationRow | null }>({ open: false, destination: null })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [signingSecret, setSigningSecret] = useState<{ name: string; secret: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const result = await listLogDestinationsWithStatus()
      if (!result.ok) throw new Error(result.error)
      return result.data as Entry[]
    },
    enabled: canView,
    // Status and lag move on their own (the shipper runs every minute).
    refetchInterval: 15_000,
  })

  if (!canView) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }
  if (isLoading && !data) return <PageSkeleton variant="settings" />

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY })
  const entries = data ?? []

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ScrollText size={22} />
            Log Export
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Stream workflow, integration, agent, task, audit and security events to Splunk, Datadog,
            any OpenTelemetry collector or your own webhook.{' '}
            <Link href="/docs/observability" className="underline underline-offset-2">Docs</Link>
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <ImportConfigButton onImported={() => void refresh()} />
            <Button size="sm" onClick={() => setDialog({ open: true, destination: null })}>
              <Plus size={14} /> Add destination
            </Button>
          </div>
        )}
      </div>

      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}
      {signingSecret && (
        <SigningSecretCard name={signingSecret.name} secret={signingSecret.secret} onDismiss={() => setSigningSecret(null)} />
      )}

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm font-medium">No log destinations yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            {canEdit
              ? 'Add one to start shipping events. New destinations start from now; choose “start of retention” to also send events from the last 72 hours.'
              : 'Ask a workspace admin to add one.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <DestinationCard
              key={String(entry.destination.id)}
              entry={entry}
              canEdit={canEdit}
              onEdit={() => setDialog({ open: true, destination: entry.destination })}
              onChanged={refresh}
              onNotice={setNotice}
            />
          ))}
        </div>
      )}

      <LiveEventsHint />

      <DestinationDialog
        open={dialog.open}
        destination={dialog.destination}
        canViewSettings={canViewSettings}
        onOpenChange={(open) => setDialog((prev) => ({ ...prev, open }))}
        onSaved={({ name, signingSecret: secret }) => {
          setDialog({ open: false, destination: null })
          setNotice({ tone: 'success', message: `Saved “${name}”.` })
          if (secret) setSigningSecret({ name, secret })
          void refresh()
        }}
      />
    </div>
  )
}

function DestinationCard({
  entry,
  canEdit,
  onEdit,
  onChanged,
  onNotice,
}: {
  entry: Entry
  canEdit: boolean
  onEdit: () => void
  onChanged: () => void
  onNotice: (notice: Notice) => void
}) {
  const { destination, status } = entry
  const id = String(destination.id)
  const type = destination.type as DestinationType
  const Icon = TYPE_ICONS[type] ?? ScrollText
  const [busy, setBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<LogDestinationTestResult | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'reset_now' | 'reset_retention' | null>(null)

  async function act<T>(label: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success?: (data: T) => string | null) {
    setBusy(label)
    try {
      const result = await fn()
      if (!result.ok) { onNotice({ tone: 'error', message: result.error }); return }
      const message = success?.(result.data)
      if (message) onNotice({ tone: 'success', message })
      onChanged()
    } catch (e) {
      onNotice({ tone: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const sendTest = () => act('test', async () => {
    setTestResult(null)
    const result = await testLogDestinationAction(id)
    if (result.ok) setTestResult(result.data)
    return result
  })

  const lastError = status?.last_error ?? destination.last_error
  const lastErrorAt = status?.last_error_at ?? destination.last_error_at
  const lastSuccessAt = status?.last_success_at ?? destination.last_success_at

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">{destination.name}</span>
            <DestinationStatusBadge status={String(status?.status ?? destination.status)} />
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
            {TYPE_LABELS[type] ?? type}
            {' · '}{describeTarget(destination)}
          </p>
        </div>
        <ExportAssetButton ids={[id]} name={destination.name} />
        {canEdit && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => act('toggle', () => setLogDestinationEnabledAction(id, !destination.enabled),
                () => (destination.enabled ? `Paused “${destination.name}”.` : `Resumed “${destination.name}”.`))}
            >
              {destination.enabled ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Resume</>}
            </Button>
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void sendTest()}>
              <Send size={12} /> {busy === 'test' ? 'Sending…' : 'Send test event'}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit" disabled={busy !== null} onClick={onEdit}>
              <Pencil size={14} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete" disabled={busy !== null} onClick={() => setConfirm('delete')}>
              <Trash2 size={14} />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Stat label="Lag" value={status ? `${status.lag_events.toLocaleString()} events` : '—'} />
        <Stat label="Oldest unsent" value={status ? formatLagSeconds(status.lag_seconds) : '—'} />
        <Stat label="Events sent" value={Number(status?.events_sent ?? destination.events_sent ?? 0).toLocaleString()} />
        <Stat label="Last success" value={lastSuccessAt ? formatRelativeDate(lastSuccessAt) : 'never'} />
      </div>

      {lastError && (
        <InlineNotice
          tone={destination.status === 'healthy' ? 'warning' : 'error'}
          message={`${lastErrorAt ? `${formatRelativeDate(lastErrorAt)}: ` : ''}${lastError}`}
        />
      )}

      {testResult && (
        <InlineNotice
          tone={testResult.ok ? 'success' : 'error'}
          message={testResult.ok
            ? `Test event delivered (HTTP ${testResult.status_code ?? 'ok'}, ${testResult.latency_ms ?? '?'} ms).`
            : `Test event failed${testResult.status_code ? ` (HTTP ${testResult.status_code})` : ''}: ${testResult.error ?? 'unknown error'}${testResult.retryable ? ' — retryable' : ''}`}
          onDismiss={() => setTestResult(null)}
        />
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          <RotateCcw size={12} />
          Reset cursor:
          <button className="underline underline-offset-2 disabled:opacity-40" disabled={busy !== null} onClick={() => setConfirm('reset_now')}>from now</button>
          <button className="underline underline-offset-2 disabled:opacity-40" disabled={busy !== null} onClick={() => setConfirm('reset_retention')}>from retention start</button>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete log destination?"
        description={`“${destination.name}” stops receiving events immediately. Its credentials are deleted and cannot be recovered.`}
        confirmLabel="Delete"
        destructive
        busy={busy === 'delete'}
        onConfirm={() => act('delete', () => deleteLogDestinationAction(id), () => `Deleted “${destination.name}”.`).then(() => setConfirm(null))}
      />
      <ConfirmDialog
        open={confirm === 'reset_now'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Skip the backlog?"
        description={`“${destination.name}” will skip every event not yet sent and continue with new events only. Skipped events are not sent.`}
        confirmLabel="Reset to now"
        busy={busy === 'reset'}
        onConfirm={() => act('reset', () => resetLogDestinationCursorAction(id, 'now'), () => 'Cursor reset to now.').then(() => setConfirm(null))}
      />
      <ConfirmDialog
        open={confirm === 'reset_retention'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Re-send retained events?"
        description={`“${destination.name}” will be sent every event still retained (up to the retention window), including events it already received. Expect duplicates; dedupe on the event id.`}
        confirmLabel="Re-send"
        busy={busy === 'reset'}
        onConfirm={() => act('reset', () => resetLogDestinationCursorAction(id, 'retention_start'), () => 'Cursor reset to the start of retention.').then(() => setConfirm(null))}
      />
    </Card>
  )
}

function describeTarget(destination: LogDestinationRow): string {
  const config = (destination.config ?? {}) as Record<string, unknown>
  if (destination.type === 'datadog') return `site ${String(config.site ?? 'datadoghq.com')}`
  const url = String(config.url ?? config.endpoint ?? '')
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--theme-muted-text)' }}>{label}</div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  )
}

function SigningSecretCard({ name, secret, onDismiss }: { name: string; secret: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Card className="p-4 space-y-2" style={{ borderColor: 'var(--theme-primary)' }}>
      <p className="text-sm font-medium">Signing secret for “{name}”</p>
      <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
        Copy it now — it is not shown again. Use it to verify the X-UserTasks-Signature header on each request.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {secret}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(secret).then(() => setCopied(true))
          }}
        >
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDismiss}>Done</Button>
      </div>
    </Card>
  )
}

/**
 * The SSE stream (/api/v1/events/stream) takes API keys / OAuth tokens only,
 * not the browser session, so live tailing lives in the CLI.
 */
function LiveEventsHint() {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium flex items-center gap-2"><Terminal size={14} /> Live events</p>
      <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
        Tail the event stream from a terminal, or pull it with the API:
      </p>
      <pre className="mt-2 rounded-lg p-3 text-xs overflow-x-auto" style={{ backgroundColor: 'var(--theme-surface)' }}>
{`usertasks logs tail --category workflow --severity warn
curl -N -H "Authorization: Bearer $USERTASKS_API_KEY" "$USERTASKS_URL/api/v1/events/stream"`}
      </pre>
    </Card>
  )
}
