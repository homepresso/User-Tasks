"use client"

import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { WINDOWS_AUTH_MODE_LABELS, WINDOWS_AUTH_MODES, type WindowsAuthMode } from "@/lib/integrations/windows-auth/config"

export interface WindowsAuthFormValue {
  mode: WindowsAuthMode
  username: string
  /** '' = keep the stored password (edit) / none entered yet (create). */
  password: string
  spn: string
  ca_bundle: string
  proxy_url: string
}

export const EMPTY_WINDOWS_AUTH: WindowsAuthFormValue = { mode: "negotiate", username: "", password: "", spn: "", ca_bundle: "", proxy_url: "" }

/** Form value from a stored auth_config (the password is never shown). */
export function windowsAuthFromConfig(authConfig: Record<string, unknown> | null | undefined): WindowsAuthFormValue {
  const cfg = authConfig ?? {}
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const mode = WINDOWS_AUTH_MODES.includes(str(cfg.mode) as WindowsAuthMode) ? (str(cfg.mode) as WindowsAuthMode) : "negotiate"
  return { mode, username: str(cfg.username), password: "", spn: str(cfg.spn), ca_bundle: str(cfg.ca_bundle), proxy_url: str(cfg.proxy_url) }
}

/**
 * auth_config to save or test. An empty password with a stored one sends
 * '__SECRET__', which keeps the stored (encrypted) value server-side.
 */
export function windowsAuthToConfig(value: WindowsAuthFormValue, hasStoredPassword: boolean): Record<string, string> {
  return {
    mode: value.mode,
    username: value.username.trim(),
    password: value.password || (hasStoredPassword ? "__SECRET__" : ""),
    ...(value.spn.trim() ? { spn: value.spn.trim() } : {}),
    ...(value.ca_bundle.trim() ? { ca_bundle: value.ca_bundle.trim() } : {}),
    ...(value.proxy_url.trim() ? { proxy_url: value.proxy_url.trim() } : {}),
  }
}

/**
 * Windows integrated authentication fields (NTLM / Kerberos). Inputs carry
 * `windows_*` names so an uncontrolled form submit picks them up too. The
 * password is write-only: it is never pre-filled.
 */
export function WindowsAuthFields({ value, onChange, hasStoredPassword = false }: {
  value: WindowsAuthFormValue
  onChange: (next: WindowsAuthFormValue) => void
  hasStoredPassword?: boolean
}) {
  const set = <K extends keyof WindowsAuthFormValue>(key: K, v: WindowsAuthFormValue[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <Field label="Protocol" description="Negotiate tries Kerberos first and falls back to NTLMv2. Kerberos needs the optional kerberos package and a keytab on the server.">
        <Select name="windows_mode" value={value.mode} onChange={(e) => set("mode", e.target.value as WindowsAuthMode)}>
          {WINDOWS_AUTH_MODES.map((m) => <option key={m} value={m}>{WINDOWS_AUTH_MODE_LABELS[m]}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="User" description="DOMAIN\user or user@domain">
          <Input name="windows_username" value={value.username} onChange={(e) => set("username", e.target.value)} placeholder="CONTOSO\svc-usertasks" autoComplete="off" required />
        </Field>
        <Field label="Password" description={hasStoredPassword ? "Stored. Leave blank to keep it." : value.mode === "kerberos" ? "Not used for Kerberos (keytab)." : undefined}>
          <Input name="windows_password" type="password" value={value.password} onChange={(e) => set("password", e.target.value)} placeholder={hasStoredPassword ? "••••••••" : ""} autoComplete="new-password" />
        </Field>
      </div>
      <Field label="Service principal name" optional description="Kerberos only. Default: HTTP/ plus the base URL host.">
        <Input name="windows_spn" value={value.spn} onChange={(e) => set("spn", e.target.value)} placeholder="HTTP/sharepoint.contoso.com" autoComplete="off" />
      </Field>
      <Field label="CA certificates (PEM)" optional description="Trusted in addition to the public roots, for servers with an internal CA. Certificate checks are never turned off.">
        <Textarea name="windows_ca_bundle" value={value.ca_bundle} onChange={(e) => set("ca_bundle", e.target.value)} rows={3} placeholder="-----BEGIN CERTIFICATE-----" className="font-mono text-xs" spellCheck={false} />
      </Field>
      <Field label="HTTP proxy" optional description="http://host:port. Requests go through a CONNECT tunnel so the authenticated connection stays end to end.">
        <Input name="windows_proxy_url" value={value.proxy_url} onChange={(e) => set("proxy_url", e.target.value)} placeholder="http://proxy.contoso.com:8080" autoComplete="off" />
      </Field>
    </div>
  )
}
