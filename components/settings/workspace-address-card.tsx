'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy } from 'lucide-react'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { IconButton } from '@/components/ui/icon-button'
import { SettingsSaveBar } from './settings-section'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from '@/lib/server-read'
import { setWorkspaceSubdomain } from '@/app/actions/workspace-settings'
import { canViewInfrastructureAction } from '@/app/actions/infrastructure'
import { subdomainProblem, SUBDOMAIN_MAX } from '@/lib/workspace-address'
import type { WorkspaceAddress } from '@/lib/services/workspace-address'

/**
 * Settings → General → Workspace address (settings.edit to change): the
 * workspace's own address, acme.usertasks.com, and with it the friendly
 * form links (acme.usertasks.com/form/<system name>). Validated as you
 * type, availability checked on the server. Changing it warns that links to
 * the old address only keep working through a redirect for a year.
 */
export function WorkspaceAddressCard({ readOnly }: { readOnly: boolean }) {
  const [address, setAddress] = useState<WorkspaceAddress | null>(null)
  const [value, setValue] = useState('')
  const [check, setCheck] = useState<{ value: string; reason: string | null } | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [copied, setCopied] = useState(false)
  // Instance admins get the DNS setup page (Settings → Workspace DNS); the page checks again.
  const [instanceAdmin, setInstanceAdmin] = useState(false)
  const guard = useSubmitGuard()

  function load(next: WorkspaceAddress) {
    setAddress(next)
    setValue(next.subdomain ?? '')
    setCheck(null)
  }

  useEffect(() => {
    let active = true
    serverRead('settings.workspaceAddress').then(({ data }) => { if (active && data) load(data) })
    canViewInfrastructureAction().then((ok) => { if (active) setInstanceAdmin(ok) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  const trimmed = value.trim().toLowerCase()
  const dirty = address !== null && trimmed !== (address.subdomain ?? '')
  const localProblem = trimmed ? subdomainProblem(trimmed) : null

  // Availability, debounced, only for a well-formed changed value.
  useEffect(() => {
    if (!dirty || !trimmed || localProblem) return
    let active = true
    const timer = setTimeout(() => {
      serverRead('settings.workspaceAddressCheck', { subdomain: trimmed }).then(({ data }) => {
        if (active && data) setCheck({ value: trimmed, reason: data.reason })
      })
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [trimmed, dirty, localProblem])

  if (!address) return <p className="text-sm text-fg-muted">Loading…</p>

  if (!address.enabled) {
    return (
      <p className="text-sm text-fg-muted" data-testid="workspace-address-disabled">
        Workspace addresses are off on this instance.{' '}
        {instanceAdmin
          ? <>Turn them on with <code className="font-mono text-xs">APP_BASE_DOMAIN</code> and a wildcard DNS record: see <Link href="/settings/workspace-dns" className="text-primary-text hover:underline" data-testid="workspace-dns-link">Workspace DNS setup</Link>.</>
          : <>An instance administrator can turn them on with <code className="font-mono text-xs">APP_BASE_DOMAIN</code> and a wildcard DNS record (see the self-hosting guide).</>}
      </p>
    )
  }

  const serverProblem = check && check.value === trimmed ? check.reason : null
  const error = trimmed ? (localProblem ?? serverProblem) : null
  const available = dirty && trimmed && !localProblem && check?.value === trimmed && check.reason === null
  const previewHost = `${trimmed || 'your-workspace'}.${address.base_domain}`

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!dirty || (trimmed && error)) return
    void guard.run(async () => {
      setNotice(null)
      const result = await setWorkspaceSubdomain(trimmed || null)
      if ('error' in result) { setNotice({ tone: 'error', message: result.error }); return }
      load(result.address)
      setNotice({ tone: 'success', message: 'Saved.' })
    })
  }

  async function copy() {
    if (!address?.url) return
    try { await navigator.clipboard.writeText(address.url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }

  return (
    <form onSubmit={save} className="space-y-4" aria-label="Workspace address" data-testid="workspace-address-card">
      {address.url && (
        <div className="flex items-center gap-2 text-sm" data-testid="workspace-address-current">
          <span className="text-fg-muted">Current address</span>
          <a href={address.url} className="font-medium text-primary-text hover:underline" target="_blank" rel="noreferrer">{address.url.replace(/^https?:\/\//, '')}</a>
          <IconButton label={copied ? 'Copied' : 'Copy address'} size="sm" variant="ghost" onClick={() => void copy()} icon={copied ? <Check /> : <Copy />} />
        </div>
      )}
      <Field
        label="Subdomain"
        error={error ?? undefined}
        description={available ? <span className="text-success">Available</span> : `Lowercase letters, numbers and hyphens, 3–${SUBDOMAIN_MAX} characters.`}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value.toLowerCase())}
          disabled={readOnly}
          maxLength={SUBDOMAIN_MAX + 10}
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
          wrapperClassName="max-w-md"
          trailing={<span className="font-mono text-xs text-fg-muted">.{address.base_domain}</span>}
          data-testid="workspace-subdomain"
        />
      </Field>
      {instanceAdmin && (
        <p className="text-xs text-fg-muted">
          Instance admin: DNS records and live checks for <span className="font-mono">*.{address.base_domain}</span> are in{' '}
          <Link href="/settings/workspace-dns" className="text-primary-text hover:underline" data-testid="workspace-dns-link">Workspace DNS setup</Link>.
        </p>
      )}
      <p className="text-xs text-fg-muted">
        Forms open at <span className="font-mono text-fg">{previewHost}/form/&lt;system name&gt;</span>.
      </p>
      {dirty && address.subdomain && (
        <InlineNotice tone="warning" title="Old links will stop working" className="max-w-2xl">
          Links to <span className="font-mono">{address.subdomain}.{address.base_domain}</span> redirect to the new address for a year, then stop working. Update bookmarks, QR codes and shared form links. Removing the address breaks them at once.
        </InlineNotice>
      )}
      {notice?.tone === 'success' && <p role="status" className="text-xs text-success">{notice.message}</p>}
      {!readOnly && (
        <SettingsSaveBar
          dirty={dirty}
          saving={guard.pending}
          error={notice?.tone === 'error' ? notice.message : null}
          onDiscard={() => { load(address); setNotice(null) }}
          saveLabel={trimmed ? 'Save address' : 'Remove address'}
          saveTestId="workspace-address-save"
        />
      )}
    </form>
  )
}
