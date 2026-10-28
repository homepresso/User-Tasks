"use client"

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, KeyRound, Network, RotateCw, Trash2, Unplug } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { formatRelativeDate } from '@/lib/utils'
import {
  connectDirectory,
  createScimToken,
  disconnectDirectory,
  revokeScimToken,
  rotateScimToken,
  updateDirectoryOptions,
  type DirectoryConnectionSummary,
  type ScimTokenRow,
} from '@/app/actions/directory-sync'
import { errText, Field, OptionCheckbox, SummaryItem, TextArea, unwrap } from './shared'

// ── Google Workspace ─────────────────────────────────────────────────────────

export function GoogleConnectCard({ onConnected }: { onConnected: () => void }) {
  const [adminEmail, setAdminEmail] = useState('')
  const [keyJson, setKeyJson] = useState('')
  const [domain, setDomain] = useState('')
  const [syncGroups, setSyncGroups] = useState(true)
  const [autoProvision, setAutoProvision] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const connectMutation = useMutation({
    mutationFn: () => unwrap(connectDirectory({
      provider: 'google',
      settings: { admin_email: adminEmail.trim(), ...(domain.trim() ? { domain: domain.trim() } : {}) },
      credentials: { service_account_json: keyJson.trim() },
      syncGroups,
      autoProvision,
    })),
    onMutate: () => setError(null),
    onSuccess: onConnected,
    onError: (e) => setError(errText(e)),
  })

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Network size={14} style={{ color: 'var(--theme-primary-text)' }} />
        Connect Google Workspace
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Create a service account, grant it domain-wide delegation in the Admin console for{' '}
        <code>admin.directory.user.readonly</code>, <code>admin.directory.group.readonly</code> and{' '}
        <code>admin.directory.group.member.readonly</code>, and paste its JSON key with the email of a Workspace admin to act as.
      </p>
      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-4" />}
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Admin email"><Input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@example.com" autoComplete="off" /></Field>
          <Field label="Domain (optional)" hint="Only this domain's users and groups"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" autoComplete="off" /></Field>
        </div>
        <Field label="Service account key (JSON)" hint="Encrypted at rest and never shown again.">
          <TextArea rows={5} value={keyJson} onChange={(e) => setKeyJson(e.target.value)} placeholder='{"type": "service_account", "client_email": "…", "private_key": "…"}' />
        </Field>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <OptionCheckbox label="Sync groups as teams" checked={syncGroups} disabled={false} onChange={setSyncGroups} />
          <OptionCheckbox label="Automatically create accounts for directory users" checked={autoProvision} disabled={false} onChange={setAutoProvision} />
        </div>
        <Button onClick={() => connectMutation.mutate()} disabled={!adminEmail.trim() || !keyJson.trim() || connectMutation.isPending}>
          {connectMutation.isPending ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </Card>
  )
}

// ── SCIM ─────────────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
      <Copy size={12} />
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

export function ScimCard({
  connection,
  tokens,
  scimUrl,
  canEdit,
  onChanged,
}: {
  connection: DirectoryConnectionSummary | null
  tokens: ScimTokenRow[]
  scimUrl: string
  canEdit: boolean
  onChanged: () => void
}) {
  const [name, setName] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<ScimTokenRow | null>(null)
  const enabled = Boolean(connection?.isEnabled)

  const createMutation = useMutation({
    mutationFn: () => unwrap(createScimToken({ name: name.trim() || 'Identity provider' })),
    onMutate: () => { setError(null); setShown(null) },
    onSuccess: (result) => { setShown(result.token); setName(''); onChanged() },
    onError: (e) => setError(errText(e)),
  })
  const rotateMutation = useMutation({
    mutationFn: (id: string) => unwrap(rotateScimToken(id, 60)),
    onMutate: () => { setError(null); setShown(null) },
    onSuccess: (result) => { setShown(result.token); onChanged() },
    onError: (e) => setError(errText(e)),
  })
  const revokeMutation = useMutation({
    mutationFn: (id: string) => unwrap(revokeScimToken(id)),
    onSuccess: () => { setConfirmRevoke(null); onChanged() },
    onError: (e) => { setConfirmRevoke(null); setError(errText(e)) },
  })
  const optionsMutation = useMutation({
    mutationFn: (options: { syncGroups?: boolean; autoProvision?: boolean }) => unwrap(updateDirectoryOptions('scim', options)),
    onSuccess: onChanged,
    onError: (e) => setError(errText(e)),
  })
  const disconnectMutation = useMutation({
    mutationFn: () => unwrap(disconnectDirectory('scim')),
    onSuccess: () => { setConfirmDisconnect(false); setShown(null); onChanged() },
    onError: (e) => { setConfirmDisconnect(false); setError(errText(e)) },
  })

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <KeyRound size={14} style={{ color: 'var(--theme-primary-text)' }} />
            SCIM provisioning
          </h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
            Let Microsoft Entra ID, Okta, OneLogin, JumpCloud or another identity provider push users and groups here (SCIM 2.0).
          </p>
        </div>
        {canEdit && enabled && (
          <Button variant="destructive" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={disconnectMutation.isPending}>
            <Unplug size={13} />
            Disable
          </Button>
        )}
      </div>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-3" />}

      <div className="space-y-3">
        <Field label="Tenant URL (SCIM base URL)">
          <div className="flex gap-2">
            <Input readOnly value={scimUrl} className="font-mono text-xs" />
            <CopyButton value={scimUrl} />
          </div>
        </Field>

        {shown && (
          <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-primary-light)', border: '1px solid var(--theme-primary)' }}>
            <p className="text-xs font-medium mb-1.5">Secret token — copy it now, it is not shown again:</p>
            <div className="flex gap-2">
              <Input readOnly value={shown} className="font-mono text-xs" />
              <CopyButton value={shown} />
            </div>
          </div>
        )}

        {enabled && (
          <div className="grid grid-cols-2 gap-3">
            <SummaryItem label="Provisioned users" value={String(connection?.linkedUsers ?? 0)} />
            <SummaryItem label="Provisioned groups" value={String(connection?.linkedGroups ?? 0)} />
          </div>
        )}

        {tokens.length > 0 && (
          <div className="space-y-1.5">
            {tokens.map((token) => (
              <div key={token.id} className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--theme-surface)' }}>
                <span className="font-medium">{token.name}</span>
                <code style={{ color: 'var(--theme-muted-text)' }}>{token.token_prefix}…</code>
                <span style={{ color: 'var(--theme-muted-text)' }}>
                  {token.last_used_at ? `used ${formatRelativeDate(token.last_used_at)}` : 'never used'}
                  {token.expires_at ? ` · expires ${formatRelativeDate(token.expires_at)}` : ''}
                </span>
                {canEdit && (
                  <span className="ml-auto flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => rotateMutation.mutate(token.id)} disabled={rotateMutation.isPending} title="New token; the old one keeps working for an hour">
                      <RotateCw size={12} />
                      Rotate
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRevoke(token)}>
                      <Trash2 size={12} />
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[12rem]">
              <Field label={enabled ? 'New token' : 'Create a token to enable SCIM'}>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Entra ID provisioning" />
              </Field>
            </div>
            <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating…' : 'Create token'}
            </Button>
          </div>
        )}

        {enabled && connection && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <OptionCheckbox label="Pushed groups become teams" checked={connection.syncGroups} disabled={!canEdit || optionsMutation.isPending} onChange={(checked) => optionsMutation.mutate({ syncGroups: checked })} />
            <OptionCheckbox label="Automatically create accounts for pushed users" checked={connection.autoProvision} disabled={!canEdit || optionsMutation.isPending} onChange={(checked) => optionsMutation.mutate({ autoProvision: checked })} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disable SCIM provisioning?"
        description="Every SCIM token stops working at once. Provisioned users and teams are kept; re-enable by creating a new token."
        confirmLabel="Disable"
        destructive
        busy={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />
      <ConfirmDialog
        open={Boolean(confirmRevoke)}
        onOpenChange={(open) => { if (!open) setConfirmRevoke(null) }}
        title={`Revoke "${confirmRevoke?.name ?? ''}"?`}
        description="The identity provider using this token can no longer provision until it gets a new one."
        confirmLabel="Revoke"
        destructive
        busy={revokeMutation.isPending}
        onConfirm={() => { if (confirmRevoke) revokeMutation.mutate(confirmRevoke.id) }}
      />
    </Card>
  )
}
