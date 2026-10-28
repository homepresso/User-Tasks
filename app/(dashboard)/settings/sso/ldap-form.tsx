"use client"

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, PlugZap, Server, TriangleAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { connectDirectory, testDirectoryConnection, updateDirectoryConnection } from '@/app/actions/directory-sync'
import { LDAP_FLAVORS, LDAP_MAPPING_KEYS, LDAP_PRESETS, type LdapFlavor, type LdapMappingKey } from '@/lib/directory-sync/ldap-presets'
import type { LdapTestResult } from '@/lib/directory-sync/ldap'
import { errText, Field, OptionCheckbox, Select, TextArea, unwrap } from './shared'

const MAPPING_LABELS: Record<LdapMappingKey, string> = {
  id: 'Unique id',
  username: 'Username',
  email: 'Email',
  display_name: 'Display name',
  first_name: 'First name',
  last_name: 'Last name',
  group_name: 'Group name',
  group_description: 'Group description',
  member: 'Group member attribute',
  manager: 'Manager (DN)',
}

const SECRET = '__SECRET__'

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Connect (no initial settings) or edit an LDAP / Active Directory connection, with a test before saving. */
export function LdapForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: Record<string, unknown> | null
  onDone: () => void
  onCancel?: () => void
}) {
  const editing = Boolean(initial)
  const start = initial ?? {}
  const [flavor, setFlavor] = useState<LdapFlavor>((LDAP_FLAVORS as readonly string[]).includes(str(start.flavor)) ? start.flavor as LdapFlavor : 'active_directory')
  const [url, setUrl] = useState(str(start.url))
  const [startTls, setStartTls] = useState(Boolean(start.start_tls))
  const [caCert, setCaCert] = useState(str(start.ca_cert))
  const [verifyTls, setVerifyTls] = useState(start.tls_reject_unauthorized !== false)
  const [serverName, setServerName] = useState(str(start.tls_server_name))
  const [bindDn, setBindDn] = useState(str(start.bind_dn))
  const [password, setPassword] = useState('')
  const [baseDn, setBaseDn] = useState(str(start.base_dn))
  const [userBase, setUserBase] = useState(str(start.user_base_dn))
  const [groupBase, setGroupBase] = useState(str(start.group_base_dn))
  const [userFilter, setUserFilter] = useState(str(start.user_filter))
  const [groupFilter, setGroupFilter] = useState(str(start.group_filter))
  const [mapping, setMapping] = useState<Partial<Record<LdapMappingKey, string>>>((start.attributes ?? {}) as Partial<Record<LdapMappingKey, string>>)
  const [nested, setNested] = useState(start.nested_groups !== false)
  const [deprovision, setDeprovision] = useState(start.deprovision_missing !== false)
  const [bindLogin, setBindLogin] = useState(Boolean(start.bind_login))
  const [interval, setSyncInterval] = useState(start.sync_interval_minutes ? String(start.sync_interval_minutes) : '')
  const [syncGroups, setSyncGroups] = useState(true)
  const [autoProvision, setAutoProvision] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(editing)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<LdapTestResult | null>(null)

  const preset = LDAP_PRESETS[flavor]
  const isLdaps = /^ldaps:/i.test(url.trim())

  const settings = (): Record<string, unknown> => {
    const attributes = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v!.trim()]))
    return {
      url: url.trim(),
      flavor,
      start_tls: !isLdaps && startTls,
      ...(caCert.trim() ? { ca_cert: caCert.trim() } : {}),
      tls_reject_unauthorized: verifyTls,
      ...(serverName.trim() ? { tls_server_name: serverName.trim() } : {}),
      bind_dn: bindDn.trim(),
      base_dn: baseDn.trim(),
      ...(userBase.trim() ? { user_base_dn: userBase.trim() } : {}),
      ...(groupBase.trim() ? { group_base_dn: groupBase.trim() } : {}),
      ...(userFilter.trim() ? { user_filter: userFilter.trim() } : {}),
      ...(groupFilter.trim() ? { group_filter: groupFilter.trim() } : {}),
      attributes,
      nested_groups: nested,
      deprovision_missing: deprovision,
      bind_login: bindLogin,
      ...(interval.trim() ? { sync_interval_minutes: Number(interval) } : {}),
    }
  }
  // Editing: an empty password keeps the stored one.
  const credentials = () => ({ bind_password: password || (editing ? SECRET : '') })

  const testMutation = useMutation({
    mutationFn: () => unwrap(testDirectoryConnection('ldap', editing
      ? { settings: settings(), credentials: password ? { bind_password: password } : undefined }
      : { settings: settings(), credentials: credentials() })),
    onMutate: () => { setError(null); setTest(null) },
    onSuccess: (result) => {
      if (result.ok) setTest(result.details)
      else setError(result.error)
    },
    onError: (e) => setError(errText(e)),
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        await unwrap(updateDirectoryConnection('ldap', { settings: settings(), credentials: password ? { bind_password: password } : undefined }))
        return null
      }
      return (await unwrap(connectDirectory({ provider: 'ldap', settings: settings(), credentials: credentials(), syncGroups, autoProvision }))).test
    },
    onMutate: () => setError(null),
    onSuccess: onDone,
    onError: (e) => setError(errText(e)),
  })

  const ready = url.trim() && bindDn.trim() && baseDn.trim() && (editing || password)

  return (
    <Card>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
        <Server size={14} style={{ color: 'var(--theme-primary-text)' }} />
        {editing ? 'LDAP / Active Directory settings' : 'Connect LDAP / Active Directory'}
      </h3>
      <p className="text-xs mb-4" style={{ color: 'var(--theme-muted-text)' }}>
        Users and groups are read with a service account over LDAPS or StartTLS. Use a read-only account; the password is encrypted and never shown again.
      </p>

      {error && <InlineNotice tone="error" message={error} onDismiss={() => setError(null)} className="mb-4" />}

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Directory type">
            <Select value={flavor} onChange={(v) => setFlavor(v as LdapFlavor)} options={LDAP_FLAVORS.map((f) => ({ value: f, label: LDAP_PRESETS[f].label }))} />
          </Field>
          <Field label="Server URL" hint="ldaps://host:636, or ldap://host:389 with StartTLS">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ldaps://dc1.corp.example.com:636" autoComplete="off" />
          </Field>
          <Field label="Bind DN" hint={flavor === 'active_directory' ? 'or svc-usertasks@corp.example.com' : undefined}>
            <Input value={bindDn} onChange={(e) => setBindDn(e.target.value)} placeholder={flavor === 'active_directory' ? 'CN=svc-usertasks,OU=Service Accounts,DC=corp,DC=example,DC=com' : 'cn=usertasks,ou=services,dc=example,dc=com'} autoComplete="off" />
          </Field>
          <Field label="Bind password" hint={editing ? 'Leave empty to keep the stored password' : 'Or secret://tenants/<workspace id>/<name>'}>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={editing ? '••••••••' : 'Service account password'} autoComplete="new-password" />
          </Field>
          <Field label="Base DN">
            <Input value={baseDn} onChange={(e) => setBaseDn(e.target.value)} placeholder="DC=corp,DC=example,DC=com" autoComplete="off" />
          </Field>
          <Field label="Sync every (minutes)" hint="Default 60, minimum 10. LDAP syncs only changes between daily full syncs.">
            <Input value={interval} onChange={(e) => setSyncInterval(e.target.value.replace(/[^\d]/g, ''))} placeholder="60" inputMode="numeric" />
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {!isLdaps && <OptionCheckbox label="Use StartTLS" checked={startTls} disabled={false} onChange={setStartTls} />}
          <OptionCheckbox label="Verify the server certificate" checked={verifyTls} disabled={false} onChange={setVerifyTls} />
          <OptionCheckbox label="Nested groups count as members" checked={nested} disabled={false} onChange={setNested} />
          <OptionCheckbox label="Deactivate users that leave the directory" checked={deprovision} disabled={false} onChange={setDeprovision} />
        </div>
        <OptionCheckbox
          label="Let users sign in with their directory password"
          hint="Built-in auth only. People in the user filter sign in with their LDAP password on the login page; others keep their local password."
          checked={bindLogin}
          disabled={false}
          onChange={setBindLogin}
        />
        {!editing && (
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <OptionCheckbox label="Sync groups as teams" checked={syncGroups} disabled={false} onChange={setSyncGroups} />
            <OptionCheckbox label="Automatically create accounts for directory users" checked={autoProvision} disabled={false} onChange={setAutoProvision} />
          </div>
        )}

        <button type="button" className="text-xs underline" style={{ color: 'var(--theme-primary-text)' }} onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? 'Hide' : 'Show'} TLS, search and attribute mapping options
        </button>

        {showAdvanced && (
          <div className="space-y-4 rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
            <Field label="CA certificate (PEM)" hint="The certificate(s) the server certificate must chain to. Empty: the system's trusted roots.">
              <TextArea rows={4} value={caCert} onChange={(e) => setCaCert(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Certificate host name" hint="When it differs from the URL host">
                <Input value={serverName} onChange={(e) => setServerName(e.target.value)} placeholder="dc1.corp.example.com" />
              </Field>
              <Field label="Users base DN"><Input value={userBase} onChange={(e) => setUserBase(e.target.value)} placeholder={baseDn || 'Base DN'} /></Field>
              <Field label="Groups base DN"><Input value={groupBase} onChange={(e) => setGroupBase(e.target.value)} placeholder={baseDn || 'Base DN'} /></Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="User filter"><Input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder={preset.userFilter} className="font-mono text-xs" /></Field>
              <Field label="Group filter"><Input value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} placeholder={preset.groupFilter} className="font-mono text-xs" /></Field>
            </div>
            <div>
              <p className="text-xs font-medium mb-2">Attribute mapping</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {LDAP_MAPPING_KEYS.map((key) => (
                  <Field key={key} label={MAPPING_LABELS[key]}>
                    <Input
                      value={mapping[key] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}
                      placeholder={preset.map[key]}
                      className="font-mono text-xs"
                    />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}

        {test && <LdapTestSummary result={test} />}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" onClick={() => testMutation.mutate()} disabled={!ready || testMutation.isPending}>
            <PlugZap size={13} />
            {testMutation.isPending ? 'Testing…' : 'Test connection'}
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!ready || saveMutation.isPending}>
            {saveMutation.isPending ? (editing ? 'Saving…' : 'Connecting…') : editing ? 'Save' : 'Connect'}
          </Button>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </div>
    </Card>
  )
}

export function LdapTestSummary({ result }: { result: LdapTestResult }) {
  return (
    <div className="rounded-lg p-3 text-xs space-y-2" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}>
      <p className="flex items-center gap-1.5 font-medium text-sm">
        <CheckCircle2 size={14} className="text-green-600" />
        Connected to {result.server}{result.vendor ? ` (${result.vendor})` : ''} — {result.users} users, {result.groups} groups{result.encrypted ? ', encrypted' : ''}
      </p>
      {result.warnings.map((warning) => (
        <p key={warning} className="flex items-start gap-1.5 text-amber-700"><TriangleAlert size={12} className="mt-0.5 shrink-0" />{warning}</p>
      ))}
      {result.sample.length > 0 && (
        <table className="w-full text-left">
          <thead><tr style={{ color: 'var(--theme-muted-text)' }}><th className="font-medium py-1">Name</th><th className="font-medium">Email</th><th className="font-medium">Id</th><th className="font-medium">Active</th></tr></thead>
          <tbody>
            {result.sample.map((user) => (
              <tr key={user.dn} title={user.dn}>
                <td className="py-0.5 pr-2 truncate max-w-[10rem]">{user.displayName}</td>
                <td className="pr-2 truncate max-w-[12rem]">{user.email ?? '—'}</td>
                <td className="pr-2 font-mono truncate max-w-[10rem]">{user.externalId}</td>
                <td>{user.active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
