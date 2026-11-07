"use client"

import type { ReactNode } from 'react'
import { Building2, Globe, KeyRound, Network, Server } from 'lucide-react'
import type { ActionResult, DirectoryProviderId } from '@/app/actions/directory-sync'

export const PROVIDER_META: Record<DirectoryProviderId, { label: string; icon: typeof Building2 }> = {
  entra: { label: 'Microsoft Entra ID', icon: Building2 },
  okta: { label: 'Okta', icon: Globe },
  ldap: { label: 'LDAP / Active Directory', icon: Server },
  google: { label: 'Google Workspace', icon: Network },
  scim: { label: 'SCIM provisioning', icon: KeyRound },
}

export function providerLabel(provider: string): string {
  return PROVIDER_META[provider as DirectoryProviderId]?.label ?? provider
}

export function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Server action result → value, or a thrown Error with the server's message (client side, so not redacted). */
export async function unwrap<T>(promise: Promise<ActionResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export function OptionCheckbox({
  label,
  checked,
  disabled,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer select-none" title={hint}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="mt-0.5 accent-[color:var(--theme-primary)]"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-fg-muted">{hint}</span>}
      </span>
    </label>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-xs font-medium mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-2xs mt-1 text-fg-muted">{hint}</p>}
    </div>
  )
}

const controlStyle = {
  borderColor: 'var(--theme-surface-border)',
  backgroundColor: 'var(--theme-topbar)',
  color: 'var(--theme-topbar-text)',
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-lg border px-3 py-2 text-xs font-mono placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 ${props.className ?? ''}`}
      style={{ ...controlStyle, ...props.style }}
    />
  )
}

export function Select({ value, onChange, options, disabled }: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="flex h-10 w-full rounded-lg border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
      style={controlStyle}
    >
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

export function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2 min-w-0 bg-subtle">
      <p className="text-2xs text-fg-muted">{label}</p>
      <p className="text-sm font-medium truncate" title={value}>{value}</p>
    </div>
  )
}

/**
 * The org-structure import options of a directory connection
 * (lib/directory-sync/profiles.ts). Connections made before these options
 * existed start with both off.
 */
export function OrgImportOptions({
  importOrgUnits,
  importProfiles,
  disabled,
  onChange,
}: {
  importOrgUnits: boolean
  importProfiles: boolean
  disabled: boolean
  onChange: (options: { importOrgUnits?: boolean; importProfiles?: boolean }) => void
}) {
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <OptionCheckbox
          label="Import org structure (departments / divisions)"
          hint="Org units from company, division and department (Google Workspace: organizational units), each person in theirs. Imported units are read-only on the Organization page until detached."
          checked={importOrgUnits}
          disabled={disabled}
          onChange={(checked) => onChange({ importOrgUnits: checked })}
        />
        <OptionCheckbox
          label="Import job titles & locations"
          hint="Job title, department, location, employee id and cost centre for each person. Attributes edited by hand (detached) are left alone."
          checked={importProfiles}
          disabled={disabled}
          onChange={(checked) => onChange({ importProfiles: checked })}
        />
      </div>
      <p className="text-xs text-fg-muted">
        Applied from the next sync (SCIM: the next change your identity provider pushes). Connections made before these options existed start with them off.
      </p>
    </div>
  )
}
