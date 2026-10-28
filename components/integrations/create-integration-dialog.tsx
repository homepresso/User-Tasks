"use client"

import { useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { createIntegration } from "@/app/actions/integrations"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, X, Globe, Zap, Network, Check, ArrowRightLeft, Upload, Image } from "lucide-react"
import { cn } from "@/lib/utils"
import { uploadIntegrationIcon } from "@/app/actions/uploads"
import { InlineNotice } from "@/components/ui/inline-notice"
import { resolveStorageUrl } from "@/lib/storage/refs"

const INTEGRATION_TYPES = [
  { value: "rest_api", label: "REST API", icon: Globe, description: "Connect to any REST endpoint" },
  { value: "odata", label: "OData", icon: ArrowRightLeft, description: "OData v2/v4 service" },
  { value: "webhook", label: "Webhook", icon: Network, description: "Send outbound HTTP callbacks" },
]

const DB_TYPES = [
  { value: "postgres", label: "PostgreSQL", port: "5432", icon: "🐘" },
  { value: "mssql", label: "SQL Server", port: "1433", icon: "🔷" },
]

export function CreateIntegrationDialog() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState("rest_api")
  const [authType, setAuthType] = useState("none")
  const [dbType, setDbType] = useState("postgres")
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [iconUploading, setIconUploading] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleIconUpload(file: File) {
    if (!file.type.includes('svg') && !file.type.includes('png') && !file.type.includes('jpeg') && !file.type.includes('image')) return
    if (file.size > 512 * 1024) { setNotice({ tone: 'error', message: 'Icon must be under 512KB' }); return }
    setIconUploading(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const result = await uploadIntegrationIcon(body)
      if (!result.ok) throw new Error(result.error)
      setIconUrl(result.data.ref ?? result.data.url)
    } catch (e: any) {
      setNotice({ tone: 'error', message: `Upload failed: ${e.message}` })
    }
    setIconUploading(false)
  }

  async function handleSubmit(formData: FormData) {
    formData.set("type", type)
    if (tags.length > 0) formData.set("tags", JSON.stringify(tags))
    if (iconUrl) formData.set("icon_url", iconUrl)

    if (type === "database") {
      const host = formData.get("db_host") as string
      const port = formData.get("db_port") as string
      const database = formData.get("db_database") as string
      formData.set("base_url", `${dbType}://${host}:${port}/${database}`)
      formData.set("db_type", dbType)
    }

    setNotice(null)
    setSubmitting(true)
    try {
      // A successful create() ends in redirect(), which throws internally and
      // is handled by Next — only reset on real failures.
      await createIntegration(formData)
      setOpen(false)
      setType("rest_api")
      setAuthType("none")
      setTags([])
    } catch (e: any) {
      if (e && typeof e === 'object' && String(e.digest ?? '').startsWith('NEXT_REDIRECT')) throw e
      setNotice({ tone: 'error', message: e?.message ?? 'Could not create the integration. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  const selectedDbType = DB_TYPES.find((d) => d.value === dbType)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm">
          <Plus size={16} className="mr-1" /> New Integration
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(32rem,92vw)] rounded-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto"
          style={{ backgroundColor: "var(--theme-card-bg)" }}
        >
          {notice && (
            <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} className="mb-4" />
          )}

          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">
              New Integration
            </Dialog.Title>
            <Dialog.Close>
              <X size={18} />
            </Dialog.Close>
          </div>

          <form id="create-integration-form" action={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input
                name="name"
                required
                placeholder="e.g. Production Database"
              />
            </div>

            {/* Custom Icon */}
            <div>
              <label className="block text-sm font-medium mb-1">Icon (optional)</label>
              <div className="flex items-center gap-3">
                {iconUrl ? (
                  <div className="relative w-10 h-10 rounded-lg border flex items-center justify-center overflow-hidden"
                    style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                    <img src={resolveStorageUrl(iconUrl)} alt="Custom icon" className="w-7 h-7 object-contain" />
                    <button type="button" onClick={() => setIconUrl(null)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[color:var(--theme-on-danger)]"
                      style={{ backgroundColor: 'var(--theme-danger)', fontSize: 8 }}>
                      <X size={8} />
                    </button>
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-lg border flex items-center justify-center"
                    style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                    <Image size={16} style={{ color: 'var(--theme-muted-text)' }} />
                  </div>
                )}
                <div>
                  <label className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity"
                    style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                    <Upload size={12} />
                    {iconUploading ? 'Uploading...' : iconUrl ? 'Change' : 'Upload SVG or PNG'}
                    <input type="file" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleIconUpload(f); e.target.value = '' }}
                      disabled={iconUploading} />
                  </label>
                  <p className="text-[9px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                    SVG recommended. Max 512KB.
                  </p>
                </div>
              </div>
            </div>

            {/* Type selector */}
            <div>
              <label className="block text-sm font-medium mb-2">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {INTEGRATION_TYPES.map((t) => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border-2 p-3 text-left transition-all"
                      )}
                      style={{
                        borderColor:
                          type === t.value
                            ? "var(--theme-primary)"
                            : "var(--theme-surface-border)",
                        backgroundColor:
                          type === t.value
                            ? "var(--theme-primary-light)"
                            : "transparent",
                      }}
                    >
                      <Icon
                        size={16}
                        className="mt-0.5 shrink-0"
                        style={{
                          color:
                            type === t.value
                              ? "var(--theme-primary-text)"
                              : "var(--theme-muted-text)",
                        }}
                      />
                      <div>
                        <p className="text-sm font-medium">{t.label}</p>
                        <p
                          className="text-[10px]"
                          style={{ color: "var(--theme-muted-text)" }}
                        >
                          {t.description}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* API-specific fields */}
            {(type === "rest_api" || type === "webhook" || type === "odata") && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Base URL
                  </label>
                  <Input
                    name="base_url"
                    required
                    placeholder={
                      type === "odata"
                        ? "https://services.example.com/odata/v4"
                        : type === "webhook"
                        ? "https://hooks.example.com/events"
                        : "https://api.example.com"
                    }
                  />
                  <p className="mt-1 text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                    {type === "webhook"
                      ? "This sends outbound requests. Incoming workflow webhooks are configured in workflow triggers."
                      : type === "odata"
                      ? "Use the service root URL; references append entity paths and OData query options."
                      : "Use the shared API root; references append their own paths."}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Authentication
                  </label>
                  <select
                    name="auth_type"
                    value={authType}
                    onChange={(event) => setAuthType(event.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{
                      backgroundColor: "var(--theme-card-bg)",
                      borderColor: "var(--theme-surface-border)",
                    }}
                  >
                    <option value="none">None</option>
                    <option value="api_key">API Key</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth (user:pass)</option>
                    <option value="oauth2">OAuth 2.0 (configure after creation)</option>
                  </select>
                </div>
                {authType === "bearer" && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Bearer token</label>
                    <Input name="auth_value" type="password" required placeholder="Access token" autoComplete="off" />
                  </div>
                )}
                {authType === "api_key" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Header name</label>
                      <Input name="api_key_name" required defaultValue="X-API-Key" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">API key</label>
                      <Input name="auth_value" type="password" required autoComplete="off" />
                    </div>
                  </div>
                )}
                {authType === "basic" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Username</label>
                      <Input name="basic_username" required autoComplete="username" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Password</label>
                      <Input name="basic_password" type="password" autoComplete="new-password" />
                    </div>
                  </div>
                )}
                {authType === "oauth2" && (
                  <InlineNotice tone="warning" message="Create the integration first, then configure and authorize OAuth from its Connection Settings page." />
                )}
              </>
            )}

            {/* Database-specific fields */}
            {type === "database" && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Database Engine
                  </label>
                  <div className="flex gap-2">
                    {DB_TYPES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setDbType(d.value)}
                        className="flex-1 flex items-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all"
                        style={{
                          borderColor:
                            dbType === d.value
                              ? "var(--theme-primary)"
                              : "var(--theme-surface-border)",
                          backgroundColor:
                            dbType === d.value
                              ? "var(--theme-primary-light)"
                              : "transparent",
                        }}
                      >
                        <span className="text-lg">{d.icon}</span>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">
                      Host / Server
                    </label>
                    <Input
                      name="db_host"
                      required
                      placeholder={
                        dbType === "mssql"
                          ? "server.database.windows.net"
                          : "db.example.com"
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Port
                    </label>
                    <Input
                      name="db_port"
                      defaultValue={selectedDbType?.port}
                      placeholder={selectedDbType?.port}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">
                    Database Name
                  </label>
                  <Input
                    name="db_database"
                    required
                    placeholder={
                      dbType === "mssql" ? "master" : "my_database"
                    }
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Username
                    </label>
                    <Input
                      name="db_username"
                      required
                      placeholder={dbType === "mssql" ? "sa" : "postgres"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Password
                    </label>
                    <Input
                      name="db_password"
                      type="password"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium mb-1">Tags</label>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                    {tag}
                    <button type="button" onClick={() => setTags(t => t.filter(x => x !== tag))} className="hover:opacity-70">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <Input value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); setTags(t => [...new Set([...t, tagInput.trim()])]); setTagInput('') } }}
                placeholder="Add tag and press Enter" className="!text-xs" />
            </div>

            {/* Live test result */}
            {testResult && (
              <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${testResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {testResult.success ? <Check size={14} className="shrink-0 mt-0.5" /> : <X size={14} className="shrink-0 mt-0.5" />}
                <div>
                  <p className="text-xs font-medium">{testResult.success ? "Connected!" : "Connection Failed"}</p>
                  <p className="text-[10px] mt-0.5">{testResult.message}</p>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={testing || authType === "oauth2"}
                onClick={async () => {
                  setTesting(true)
                  setTestResult(null)
                  try {
                    const form = document.getElementById("create-integration-form") as HTMLFormElement
                    const formData = new FormData(form)
                    let testConfig: any = {}
                    if (type === "database") {
                      testConfig = {
                        db_type: dbType,
                        host: formData.get("db_host"),
                        port: formData.get("db_port"),
                        database: formData.get("db_database"),
                        username: formData.get("db_username"),
                        password: formData.get("db_password"),
                      }
                    } else {
                      const selectedAuthType = String(formData.get("auth_type") ?? "none")
                      let authConfig: Record<string, string> = {}
                      if (selectedAuthType === "bearer") authConfig = { token: String(formData.get("auth_value") ?? "") }
                      if (selectedAuthType === "api_key") authConfig = {
                        key_name: String(formData.get("api_key_name") ?? "X-API-Key"),
                        key_value: String(formData.get("auth_value") ?? ""),
                      }
                      if (selectedAuthType === "basic") authConfig = {
                        username: String(formData.get("basic_username") ?? ""),
                        password: String(formData.get("basic_password") ?? ""),
                      }
                      testConfig = {
                        base_url: formData.get("base_url"),
                        auth_type: selectedAuthType,
                        auth_config: authConfig,
                      }
                    }
                    const resp = await fetch("/api/integrations/test", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ type, config: testConfig }),
                    })
                    setTestResult(await resp.json())
                  } catch (e: any) {
                    setTestResult({ success: false, message: e.message })
                  }
                  setTesting(false)
                }}
              >
                <Zap size={14} className="mr-1" />
                {testing ? "Testing..." : "Test Connection"}
              </Button>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" disabled={submitting}>Cancel</Button>
              </Dialog.Close>
              <Button type="submit" disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
