"use client"

import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Boxes, Plus, Copy, Check, Ban, Trash2, RefreshCw, KeyRound, ShieldAlert,
} from "lucide-react"
import {
  createOAuthClient,
  rotateOAuthClientSecret,
  revokeOAuthClient,
  revokeOAuthClientTokens,
  type OAuthClientSummary,
} from "@/app/actions/oauth-clients"
import { OAUTH_SCOPES, SCOPE_DESCRIPTIONS, withoutFirstPartyScopes } from "@/lib/oauth/scopes"
import { formatRelativeDate } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import { InlineNotice } from "@/components/ui/inline-notice"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface OAuthClientsManagerProps {
  clients: OAuthClientSummary[]
  onChanged: () => void
}

type ClientType = "confidential" | "public"

const GRANT_TYPES: { value: string; label: string; description: string }[] = [
  { value: "authorization_code", label: "Authorization code", description: "Interactive user login with redirect (web/native apps)" },
  { value: "client_credentials", label: "Client credentials", description: "Machine-to-machine access with no user (confidential only)" },
  { value: "refresh_token", label: "Refresh token", description: "Obtain new access tokens without re-authorizing" },
]

/** A short mono value with a click-to-copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div>
      <p className="text-[10px] font-semibold mb-1" style={{ color: "var(--theme-muted-text)" }}>{label}</p>
      <div className="flex gap-2">
        <code className="flex-1 rounded px-2 py-1.5 text-[11px] font-mono break-all"
          style={{ backgroundColor: "var(--theme-surface)", border: "1px solid var(--theme-surface-border)" }}>
          {value}
        </code>
        <Button size="sm" variant="outline" onClick={copy} title="Copy">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </Button>
      </div>
    </div>
  )
}

export function OAuthClientsManager({ clients, onChanged }: OAuthClientsManagerProps) {
  const tokenEndpoint = typeof window !== "undefined" ? `${window.location.origin}/api/oauth/token` : "/api/oauth/token"

  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null)

  // Show-once secret surfaced after create or rotate.
  const [secretReveal, setSecretReveal] = useState<{ clientId: string; clientSecret: string } | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)

  // Create-form state
  const [name, setName] = useState("")
  const [clientType, setClientType] = useState<ClientType>("confidential")
  const [grantTypes, setGrantTypes] = useState<string[]>(["authorization_code"])
  const [redirectUris, setRedirectUris] = useState("")
  const [scopes, setScopes] = useState<string[]>([])

  const [revokeTokensTarget, setRevokeTokensTarget] = useState<OAuthClientSummary | null>(null)
  const [revokeAppTarget, setRevokeAppTarget] = useState<OAuthClientSummary | null>(null)

  const usesAuthCode = grantTypes.includes("authorization_code")
  const usesClientCredentials = grantTypes.includes("client_credentials")

  // `admin` scope is only offered for machine-to-machine (client_credentials) clients.
  const visibleScopes = useMemo(
    () => withoutFirstPartyScopes(OAUTH_SCOPES).filter((scope) => scope !== "admin" || usesClientCredentials),
    [usesClientCredentials],
  )

  function resetForm() {
    setName("")
    setClientType("confidential")
    setGrantTypes(["authorization_code"])
    setRedirectUris("")
    setScopes([])
  }

  function toggle(list: string[], value: string, setList: (values: string[]) => void) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  }

  function chooseClientType(type: ClientType) {
    setClientType(type)
    // Public clients can't use client_credentials or the admin scope.
    if (type === "public") {
      setGrantTypes((current) => current.filter((grant) => grant !== "client_credentials"))
      setScopes((current) => current.filter((scope) => scope !== "admin"))
    }
  }

  const createMutation = useMutation({
    mutationFn: () => createOAuthClient({
      name,
      clientType,
      grantTypes,
      redirectUris: redirectUris.split(/\r?\n/),
      allowedScopes: scopes,
    }),
    onSuccess: (result) => {
      setCreating(false)
      resetForm()
      if (result.clientSecret) {
        setSecretReveal({ clientId: result.clientId, clientSecret: result.clientSecret })
        setNotice({ tone: "success", message: "OAuth app registered. Copy the client secret now — it won't be shown again." })
      } else {
        setNotice({ tone: "success", message: `OAuth app registered (public client ${result.clientId}). Public clients have no secret.` })
      }
      onChanged()
    },
    onError: (error) => setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to register app" }),
  })

  const rotateMutation = useMutation({
    mutationFn: (clientId: string) => rotateOAuthClientSecret(clientId),
    onSuccess: (result, clientId) => {
      setSecretReveal({ clientId, clientSecret: result.clientSecret })
      setNotice({ tone: "success", message: "Secret rotated. Copy the new client secret now — it won't be shown again." })
      onChanged()
    },
    onError: (error) => setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to rotate secret" }),
  })

  const revokeTokensMutation = useMutation({
    mutationFn: (clientId: string) => revokeOAuthClientTokens(clientId),
    onSuccess: (result) => {
      setRevokeTokensTarget(null)
      setNotice({ tone: "success", message: `Revoked ${result.revoked} active token${result.revoked === 1 ? "" : "s"}.` })
      onChanged()
    },
    onError: (error) => {
      setRevokeTokensTarget(null)
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to revoke tokens" })
    },
  })

  const revokeAppMutation = useMutation({
    mutationFn: (clientId: string) => revokeOAuthClient(clientId),
    onSuccess: () => {
      setRevokeAppTarget(null)
      setNotice({ tone: "success", message: "OAuth app revoked. It and all its tokens will stop working immediately." })
      onChanged()
    },
    onError: (error) => {
      setRevokeAppTarget(null)
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Failed to revoke app" })
    },
  })

  function copySecret() {
    if (secretReveal) {
      navigator.clipboard.writeText(secretReveal.clientSecret)
      setSecretCopied(true)
      setTimeout(() => setSecretCopied(false), 2000)
    }
  }

  const activeClients = clients.filter((client) => !client.revoked_at)

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      {/* Show-once secret */}
      {secretReveal && (
        <div className="rounded-lg p-4 space-y-2" style={{ backgroundColor: "var(--theme-primary-light)", border: "2px solid var(--theme-primary)" }}>
          <p className="text-sm font-semibold flex items-center gap-1.5" style={{ color: "var(--theme-primary-text)" }}>
            <KeyRound size={14} /> Client secret — copy it now!
          </p>
          <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
            This secret will not be shown again. Store it securely alongside client ID <code className="font-mono">{secretReveal.clientId}</code>.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 rounded px-3 py-2 text-xs font-mono break-all"
              style={{ backgroundColor: "var(--theme-card-bg)", border: "1px solid var(--theme-surface-border)" }}>
              {secretReveal.clientSecret}
            </code>
            <Button size="sm" variant="outline" onClick={copySecret}>
              {secretCopied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setSecretReveal(null)} className="!text-xs">Dismiss</Button>
        </div>
      )}

      {/* Token endpoint helper */}
      <Card className="!p-4 space-y-3">
        <p className="text-xs font-semibold">How clients get tokens</p>
        <CopyField label="Token endpoint" value={tokenEndpoint} />
        <p className="text-[11px]" style={{ color: "var(--theme-muted-text)" }}>
          Machine-to-machine clients exchange their client ID and secret at this endpoint for an access token
          using the <code>client_credentials</code> grant. Access tokens carry the scopes granted below.
        </p>
      </Card>

      {/* Register button */}
      <div className="flex justify-between items-center">
        <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
          {activeClients.length} active app{activeClients.length === 1 ? "" : "s"}
        </p>
        <Button size="sm" onClick={() => setCreating((open) => !open)}>
          <Plus size={14} className="mr-1" /> Register app
        </Button>
      </div>

      {/* Register form */}
      {creating && (
        <Card>
          <h3 className="text-sm font-semibold mb-4">Register OAuth app</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">App name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Analytics Sync, Partner Portal" />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2">Client type</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: "confidential", label: "Confidential", description: "Can keep a secret — servers, backends" },
                  { value: "public", label: "Public", description: "Cannot keep a secret — SPAs, native/mobile" },
                ] as const).map((option) => {
                  const selected = clientType === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => chooseClientType(option.value)}
                      className="rounded-lg border p-3 text-left transition-all"
                      style={{
                        borderColor: selected ? "var(--theme-primary)" : "var(--theme-surface-border)",
                        backgroundColor: selected ? "var(--theme-primary-light)" : "transparent",
                      }}
                    >
                      <p className="text-xs font-semibold">{option.label}</p>
                      <p className="text-[10px] mt-1" style={{ color: "var(--theme-muted-text)" }}>{option.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-2">Grant types</label>
              <div className="space-y-1">
                {GRANT_TYPES.map((grant) => {
                  const disabled = grant.value === "client_credentials" && clientType !== "confidential"
                  return (
                    <label
                      key={grant.value}
                      className="flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer"
                      style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        disabled={disabled}
                        checked={grantTypes.includes(grant.value)}
                        onChange={() => toggle(grantTypes, grant.value, setGrantTypes)}
                      />
                      <span className="text-xs">
                        {grant.label}
                        <span className="block text-[10px]" style={{ color: "var(--theme-muted-text)" }}>{grant.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>

            {usesAuthCode && (
              <div>
                <label className="block text-xs font-medium mb-1">Redirect URIs</label>
                <textarea
                  value={redirectUris}
                  onChange={(e) => setRedirectUris(e.target.value)}
                  rows={3}
                  placeholder={"https://app.example.com/callback\nhttps://app.example.com/oauth/return"}
                  className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                  style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-topbar)", color: "var(--theme-topbar-text)" }}
                />
                <p className="text-[10px] mt-1" style={{ color: "var(--theme-muted-text)" }}>
                  One per line. Must be https (or http://localhost for development).
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-2">Scopes</label>
              <div className="max-h-56 overflow-auto rounded-lg border p-2 space-y-1"
                style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                {visibleScopes.map((scope) => (
                  <label key={scope} className="flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer hover:opacity-90">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={scopes.includes(scope)}
                      onChange={() => toggle(scopes, scope, setScopes)}
                    />
                    <span className="text-xs">
                      <span className="font-mono">{scope}</span>
                      <span className="block text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                        {SCOPE_DESCRIPTIONS[scope] ?? scope}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {usesClientCredentials && scopes.includes("admin") && (
                <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: "var(--theme-warning)" }}>
                  <ShieldAlert size={11} /> The admin scope grants full administrative access to the workspace API.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                <KeyRound size={14} className="mr-1" /> {createMutation.isPending ? "Registering..." : "Register app"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setCreating(false); resetForm() }}>Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      {/* App list */}
      {clients.length === 0 ? (
        <Card>
          <div className="text-center py-6">
            <Boxes size={32} className="mx-auto mb-2" style={{ color: "var(--theme-muted-text)" }} />
            <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>
              No OAuth apps yet. Register one to let external services obtain scoped access tokens.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {clients.map((client) => {
            const revoked = Boolean(client.revoked_at)
            return (
              <Card key={client.id} className="!p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Boxes size={14} style={{ color: revoked ? "var(--theme-danger)" : "var(--theme-primary-text)" }} />
                      <span className="text-sm font-medium">{client.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full capitalize"
                        style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                        {client.client_type}
                      </span>
                      {client.is_dynamic && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                          Dynamic
                        </span>
                      )}
                      {revoked ? (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Revoked</span>
                      ) : (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">Active</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-xs flex-wrap" style={{ color: "var(--theme-muted-text)" }}>
                      <span>{client.active_tokens} active token{client.active_tokens === 1 ? "" : "s"}</span>
                      <span>Created {formatRelativeDate(client.created_at)}</span>
                      {client.last_used_at && <span>Last used {formatRelativeDate(client.last_used_at)}</span>}
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {client.grant_types.map((grant) => (
                        <span key={grant} className="text-[10px] px-2 py-0.5 rounded-full font-mono"
                          style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
                          {grant}
                        </span>
                      ))}
                      {client.allowed_scopes.map((scope) => (
                        <span key={scope} className="text-[10px] px-2 py-0.5 rounded-full font-mono"
                          style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                          {scope}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3">
                      <CopyField label="Client ID" value={client.client_id} />
                    </div>
                  </div>

                  {!revoked && (
                    <div className="flex flex-col gap-1 shrink-0">
                      {client.client_type === "confidential" && (
                        <button
                          onClick={() => rotateMutation.mutate(client.client_id)}
                          disabled={rotateMutation.isPending}
                          className="p-1.5 rounded hover:text-blue-500 transition-colors"
                          style={{ color: "var(--theme-muted-text)" }}
                          title="Rotate client secret"
                        >
                          <RefreshCw size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => setRevokeTokensTarget(client)}
                        className="p-1.5 rounded hover:text-amber-500 transition-colors"
                        style={{ color: "var(--theme-muted-text)" }}
                        title="Revoke all active tokens"
                      >
                        <Ban size={14} />
                      </button>
                      <button
                        onClick={() => setRevokeAppTarget(client)}
                        className="p-1.5 rounded hover:text-red-500 transition-colors"
                        style={{ color: "var(--theme-muted-text)" }}
                        title="Revoke app"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(revokeTokensTarget)}
        onOpenChange={(open) => { if (!open) setRevokeTokensTarget(null) }}
        title="Revoke all tokens"
        description={revokeTokensTarget
          ? `Revoke all ${revokeTokensTarget.active_tokens} active token(s) for "${revokeTokensTarget.name}"? Clients will need to obtain new tokens. The app itself stays registered.`
          : ""}
        confirmLabel="Revoke tokens"
        busy={revokeTokensMutation.isPending}
        onConfirm={() => { if (revokeTokensTarget) revokeTokensMutation.mutate(revokeTokensTarget.client_id) }}
      />

      <ConfirmDialog
        open={Boolean(revokeAppTarget)}
        onOpenChange={(open) => { if (!open) setRevokeAppTarget(null) }}
        title="Revoke OAuth app"
        description={revokeAppTarget
          ? `Revoke "${revokeAppTarget.name}"? This permanently disables the app and immediately revokes all of its tokens. This cannot be undone.`
          : ""}
        confirmLabel="Revoke app"
        destructive
        busy={revokeAppMutation.isPending}
        onConfirm={() => { if (revokeAppTarget) revokeAppMutation.mutate(revokeAppTarget.client_id) }}
      />
    </div>
  )
}
