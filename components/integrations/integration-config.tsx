"use client"

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { updateIntegration, deleteIntegration } from "@/app/actions/integrations"
import { startConnectorOAuth } from "@/app/actions/oauth-connect"
import { getConnectorDefinition } from "@/lib/connectors/registry"
import { Zap, Trash2, Power, PowerOff, Check, X, Pencil, Save } from "lucide-react"
import { useRouter } from "next/navigation"
import { formatRelativeDate } from "@/lib/utils"
import { InlineNotice } from "@/components/ui/inline-notice"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface IntegrationConfigProps {
  integration: {
    id: string
    name: string
    type: string
    config: any
    is_active: boolean | null
    last_tested_at: string | null
    last_test_status: string | null
    last_test_message: string | null
  }
}

export function IntegrationConfig({ integration }: IntegrationConfigProps) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
    serverVersion?: string
  } | null>(null)
  const [editing, setEditing] = useState(false)
  const [baseUrl, setBaseUrl] = useState(
    (integration.config as any)?.base_url ?? ""
  )
  const [authType, setAuthType] = useState(
    (integration.config as any)?.auth_type ?? "none"
  )
  const [authValue, setAuthValue] = useState(
    getAuthValue(integration.config as any)
  )
  const [apiKeyName, setApiKeyName] = useState(
    (integration.config as any)?.auth_config?.key_name ?? "X-API-Key"
  )
  // OAuth 2.0 client fields (authorization-code + auto-refresh). For connector-
  // based integrations (integration.type === connector key) a named preset
  // prefills the endpoints/scopes so the tenant only supplies client_id/secret.
  const oauthCfg = (integration.config as any)?.auth_config ?? {}
  const oauthPreset = getConnectorDefinition(integration.type)?.oauth
  const [oauthClientId, setOauthClientId] = useState<string>(oauthCfg.client_id ?? "")
  const [oauthClientSecret, setOauthClientSecret] = useState<string>(oauthCfg.client_secret ?? "")
  const [oauthAuthorizeUrl, setOauthAuthorizeUrl] = useState<string>(oauthCfg.authorize_url ?? oauthPreset?.authorizeUrl ?? "")
  const [oauthTokenUrl, setOauthTokenUrl] = useState<string>(oauthCfg.token_url ?? oauthPreset?.tokenUrl ?? "")
  const [oauthScopes, setOauthScopes] = useState<string>(
    Array.isArray(oauthCfg.scopes)
      ? oauthCfg.scopes.join(" ")
      : (oauthCfg.scopes ?? oauthPreset?.defaultScopes?.join(" ") ?? "")
  )
  const [connecting, setConnecting] = useState(false)
  // Post-redirect flag from the callback (?oauth=connected|error).
  const [oauthFlag] = useState<string | null>(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("oauth") : null
  )
  const isOauthConnected = oauthFlag === "connected" || Boolean(oauthCfg.access_token) || Boolean(oauthCfg.expires_at)
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const router = useRouter()
  const config = integration.config as any

  function getAuthValue(cfg: any): string {
    if (cfg?.auth_type === "bearer") return cfg?.auth_config?.token ?? ""
    if (cfg?.auth_type === "api_key") return cfg?.auth_config?.key_value ?? ""
    if (cfg?.auth_type === "basic")
      return `${cfg?.auth_config?.username ?? ""}:${cfg?.auth_config?.password ?? ""}`
    return ""
  }

  // Live test — sends current form values directly, no save needed
  async function handleTest() {
    setTesting(true)
    setTestResult(null)

    try {
      let liveAuthConfig: Record<string, unknown> = {}
      if (authType === "bearer") liveAuthConfig = { token: authValue }
      if (authType === "api_key") liveAuthConfig = { key_name: apiKeyName || "X-API-Key", key_value: authValue }
      if (authType === "basic") {
        const sep = authValue.indexOf(":")
        liveAuthConfig = sep === -1
          ? { username: authValue, password: "" }
          : { username: authValue.slice(0, sep), password: authValue.slice(sep + 1) }
      }
      if (authType === "oauth2") liveAuthConfig = oauthCfg

      const resp = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: integration.type,
          integrationId: integration.id,
          config: {
            base_url: baseUrl,
            auth_type: authType,
            auth_config: liveAuthConfig,
          },
        }),
      })
      const result = await resp.json()
      setTestResult(result)
    } catch (e: any) {
      setTestResult({ success: false, message: e.message })
    }

    setTesting(false)
  }

  async function handleSave() {
    setSaving(true)
    const newConfig: any = {
      ...config,
      base_url: baseUrl,
      auth_type: authType,
      auth_config: {},
    }
    if (authType === "bearer") newConfig.auth_config = { token: authValue }
    if (authType === "api_key")
      newConfig.auth_config = { key_name: apiKeyName || "X-API-Key", key_value: authValue }
    if (authType === "basic") {
      // Split on the FIRST colon only — passwords (and enc:v1: envelopes for
      // values encrypted at rest) may themselves contain colons.
      const raw = authValue || ":"
      const sep = raw.indexOf(":")
      newConfig.auth_config = sep === -1
        ? { username: raw, password: "" }
        : { username: raw.slice(0, sep), password: raw.slice(sep + 1) }
    }
    if (authType === "oauth2") {
      // Preserve any previously-stored oauth_config keys (e.g. connector_id,
      // provider) alongside the editable fields. Tokens live on the connector.
      newConfig.auth_config = {
        ...oauthCfg,
        client_id: oauthClientId,
        client_secret: oauthClientSecret,
        authorize_url: oauthAuthorizeUrl,
        token_url: oauthTokenUrl,
        scopes: oauthScopes,
        extra_authorize_params: oauthCfg.extra_authorize_params ?? oauthPreset?.extraAuthorizeParams,
      }
    }

    try {
      await updateIntegration(integration.id, { config: newConfig })
      setEditing(false)
      router.refresh()
    } catch (e: any) {
      setNotice({ tone: 'error', message: e?.message ?? 'Could not save the integration. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  // Persist the current OAuth fields, then hand off to the provider's consent screen.
  async function handleConnect() {
    setConnecting(true)
    setNotice(null)
    try {
      const newConfig: any = {
        ...config,
        base_url: baseUrl,
        auth_type: "oauth2",
        auth_config: {
          ...oauthCfg,
          client_id: oauthClientId,
          client_secret: oauthClientSecret,
          authorize_url: oauthAuthorizeUrl,
          token_url: oauthTokenUrl,
          scopes: oauthScopes,
        },
      }
      await updateIntegration(integration.id, { config: newConfig })
      const url = await startConnectorOAuth(integration.id)
      window.location.href = url
    } catch (e: any) {
      setNotice({ tone: 'error', message: e?.message ?? 'Could not start the OAuth connection.' })
      setConnecting(false)
    }
  }

  async function handleToggle() {
    try {
      await updateIntegration(integration.id, {
        is_active: !integration.is_active,
      })
      setNotice({ tone: 'success', message: `Integration ${integration.is_active ? 'disabled' : 'enabled'}.` })
      router.refresh()
    } catch (e: any) {
      setNotice({ tone: 'error', message: e?.message ?? 'Could not update the integration. Please try again.' })
    }
  }

  async function handleDelete() {
    // Caller (ConfirmDialog's onConfirm) wraps this in try/catch and keeps the
    // dialog open with a notice on failure — don't swallow the error here.
    await deleteIntegration(integration.id)
  }

  return (
    <Card>
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} className="mb-4" />
      )}

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Connection Settings</h3>
        {!editing && integration.type !== "database" && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs flex items-center gap-1 hover:opacity-70"
            style={{ color: "var(--theme-primary-text)" }}
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Base URL</label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Authentication
            </label>
            <select
              value={authType}
              onChange={(e) => setAuthType(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--theme-card-bg)",
                borderColor: "var(--theme-surface-border)",
              }}
            >
              <option value="none">None</option>
              <option value="api_key">API Key</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
              <option value="oauth2">OAuth 2.0</option>
            </select>
          </div>
          {authType === "api_key" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Header Name</label>
                <Input
                  value={apiKeyName}
                  onChange={(e) => setApiKeyName(e.target.value)}
                  placeholder="X-API-Key"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">API Key</label>
                <Input
                  type="password"
                  value={authValue}
                  onChange={(e) => setAuthValue(e.target.value)}
                  placeholder="Enter API key"
                />
              </div>
            </div>
          )}
          {authType === "bearer" && (
            <div>
              <label className="block text-xs font-medium mb-1">Token</label>
              <Input
                type="password"
                value={authValue}
                onChange={(e) => setAuthValue(e.target.value)}
                placeholder="Enter bearer token"
              />
            </div>
          )}
          {authType === "basic" && (
            <div>
              <label className="block text-xs font-medium mb-1">Credentials (user:password)</label>
              <Input
                value={authValue}
                onChange={(e) => setAuthValue(e.target.value)}
                placeholder="user:password"
              />
            </div>
          )}
          {authType === "oauth2" && (
            <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: "var(--theme-surface-border)" }}>
              {isOauthConnected && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                  <Check size={14} /> Connected
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium mb-1">Client ID</label>
                  <Input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="Client ID" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Client Secret</label>
                  <Input type="password" value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} placeholder="Client secret" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Authorization URL</label>
                <Input value={oauthAuthorizeUrl} onChange={(e) => setOauthAuthorizeUrl(e.target.value)} placeholder="https://provider.com/oauth/authorize" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Token URL</label>
                <Input value={oauthTokenUrl} onChange={(e) => setOauthTokenUrl(e.target.value)} placeholder="https://provider.com/oauth/token" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Scopes (space or comma separated)</label>
                <Input value={oauthScopes} onChange={(e) => setOauthScopes(e.target.value)} placeholder="read write offline_access" />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleConnect}
                disabled={connecting || !oauthClientId || !oauthAuthorizeUrl || !oauthTokenUrl}
              >
                {connecting ? "Redirecting…" : isOauthConnected ? "Reconnect" : "Connect"}
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save size={14} className="mr-1" />{" "}
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={testing || !baseUrl}
            >
              <Zap size={14} className="mr-1" />{" "}
              {testing ? "Testing..." : "Test Now"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--theme-muted-text)" }}>Type</span>
            <span className="font-medium capitalize">
              {integration.type.replace("_", " ")}
            </span>
          </div>
          {integration.type !== "database" && (
            <>
              <div className="flex justify-between text-sm">
                <span style={{ color: "var(--theme-muted-text)" }}>
                  Base URL
                </span>
                <span className="font-mono text-xs">
                  {config?.base_url ?? "—"}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: "var(--theme-muted-text)" }}>Auth</span>
                <span className="capitalize">
                  {config?.auth_type === "api_key"
                    ? `API Key (${config?.auth_config?.key_name ?? "X-API-Key"})`
                    : config?.auth_type ?? "None"}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div
          className={`mt-3 flex items-start gap-2 p-3 rounded-lg text-sm ${
            testResult.success
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-600"
          }`}
        >
          {testResult.success ? (
            <Check size={16} className="shrink-0 mt-0.5" />
          ) : (
            <X size={16} className="shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-medium">
              {testResult.success ? "Connected!" : "Connection Failed"}
            </p>
            <p className="text-xs mt-0.5">{testResult.message}</p>
            {testResult.serverVersion && (
              <p className="text-[10px] mt-1 opacity-70 font-mono">
                {testResult.serverVersion}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div
        className="flex gap-2 mt-4 pt-4"
        style={{ borderTop: "1px solid var(--theme-surface-border)" }}
      >
        {!editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleTest}
            disabled={testing}
          >
            <Zap size={14} className="mr-1" />{" "}
            {testing ? "Testing..." : "Test Connection"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={handleToggle}>
          {integration.is_active ? (
            <>
              <PowerOff size={14} className="mr-1" /> Disable
            </>
          ) : (
            <>
              <Power size={14} className="mr-1" /> Enable
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDeleteOpen(true)}
          className="ml-auto hover:text-red-500"
        >
          <Trash2 size={14} className="mr-1" /> Delete
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Integration"
        description="This will remove the integration, all its references, and any generated endpoints."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await handleDelete()
            setDeleteOpen(false)
          } catch (e: any) {
            setNotice({ tone: 'error', message: e?.message ?? 'Failed to delete integration' })
          }
        }}
      />
    </Card>
  )
}
