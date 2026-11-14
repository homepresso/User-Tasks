"use client"

import { useState } from "react"
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { createIntegration } from "@/app/actions/integrations"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Field } from "@/components/ui/field"
import { Plus, X, Globe, Zap, Network, ArrowRightLeft, Upload, Image } from "lucide-react"
import { cn } from "@/lib/utils"
import { uploadIntegrationIcon } from "@/app/actions/uploads"
import { InlineNotice } from "@/components/ui/inline-notice"
import { HttpCredentialsWarning } from "./http-credentials-warning"
import { resolveStorageUrl } from "@/lib/storage/refs"
import { useSubmitGuard } from "@/hooks/use-submit-guard"
import { SubmitButton } from "@/components/ui/submit-button"
import { EMPTY_WINDOWS_AUTH, WindowsAuthFields, windowsAuthToConfig, type WindowsAuthFormValue } from "./windows-auth-fields"

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
  const [baseUrlDraft, setBaseUrlDraft] = useState("")
  const [windowsAuth, setWindowsAuth] = useState<WindowsAuthFormValue>(EMPTY_WINDOWS_AUTH)
  const [dbType, setDbType] = useState("postgres")
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const [iconUploading, setIconUploading] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  // React 19 renders state set inside a form action only when it ends, so the
  // guard (synchronous) and SubmitButton (useFormStatus) stop a second submit.
  const { pending: submitting, run } = useSubmitGuard()

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
    await run(() => submitIntegration(formData))
  }

  async function submitIntegration(formData: FormData) {
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
    }
  }

  const selectedDbType = DB_TYPES.find((d) => d.value === dbType)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button leadingIcon={<Plus />}>New integration</Button>
      </DialogTrigger>
      <DialogContent size="md" title="New integration" description="Connect an external API, OData service or webhook. References are added after it is created.">
          <form id="create-integration-form" action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
          {notice && (
            <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
          )}
            <Field label="Name">
              <Input
                  name="name"
                  required
                  placeholder="e.g. Production Database"
                />
            </Field>

            {/* Custom Icon */}
            <div>
              <label className="mb-1.5 block text-ui font-medium text-fg">Icon (optional)</label>
              <div className="flex items-center gap-3">
                {iconUrl ? (
                  <div className="relative w-10 h-10 rounded-lg border flex items-center justify-center overflow-hidden border-border bg-bg">
                    <img src={resolveStorageUrl(iconUrl)} alt="Custom icon" className="w-7 h-7 object-contain" />
                    <button type="button" onClick={() => setIconUrl(null)}
                      aria-label="Remove icon"
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center bg-danger text-danger-fg">
                      <X size={8} />
                    </button>
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-lg border flex items-center justify-center border-border bg-bg">
                    <Image size={16} className="text-fg-muted" />
                  </div>
                )}
                <div>
                  <label className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}>
                    <Upload size={12} />
                    {iconUploading ? 'Uploading...' : iconUrl ? 'Change' : 'Upload SVG or PNG'}
                    <input type="file" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleIconUpload(f); e.target.value = '' }}
                      disabled={iconUploading} />
                  </label>
                  <p className="text-2xs mt-0.5 text-fg-muted">
                    SVG recommended. Max 512KB.
                  </p>
                </div>
              </div>
            </div>

            {/* Type selector */}
            <div>
              <label className="mb-1.5 block text-ui font-medium text-fg">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {INTEGRATION_TYPES.map((t) => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setType(t.value)}
                      aria-pressed={type === t.value}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors duration-[var(--ds-dur-fast)]",
                        type === t.value ? "border-primary bg-primary-wash outline outline-1 outline-primary" : "border-border hover:border-border-strong hover:bg-subtle",
                      )}
                    >
                      <Icon
                        size={16}
                        className={cn("mt-0.5 shrink-0", type === t.value ? "text-primary-text" : "text-fg-muted")}
                      />
                      <div>
                        <p className="text-ui font-medium">{t.label}</p>
                        <p
                          className="text-2xs text-fg-muted"
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
                <Field label="Base URL" description={<>{type === "webhook"
                      ? "This sends outbound requests. Incoming workflow webhooks are configured in workflow triggers."
                      : type === "odata"
                      ? "Use the service root URL; references append entity paths and OData query options."
                      : "Use the shared API root; references append their own paths."}</>}>
                  <Input
                      name="base_url"
                      required
                      onChange={(event) => setBaseUrlDraft(event.target.value)}
                      placeholder={
                        type === "odata"
                          ? "https://services.example.com/odata/v4"
                          : type === "webhook"
                          ? "https://hooks.example.com/events"
                          : "https://api.example.com"
                      }
                    />
                </Field>
                <Field label="Authentication">
                  <Select
                      name="auth_type"
                      value={authType}
                      onChange={(event) => setAuthType(event.target.value)}
                    >
                      <option value="none">None</option>
                      <option value="api_key">API Key</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="basic">Basic Auth (user:pass)</option>
                      <option value="oauth2">OAuth 2.0 (configure after creation)</option>
                      <option value="windows">Windows (NTLM / Kerberos)</option>
                    </Select>
                </Field>
                <HttpCredentialsWarning baseUrl={baseUrlDraft} authType={authType} />
                {authType === "windows" && (
                  <WindowsAuthFields value={windowsAuth} onChange={setWindowsAuth} />
                )}
                {authType === "bearer" && (
                  <Field label="Bearer token">
                    <Input name="auth_value" type="password" required placeholder="Access token" autoComplete="off" />
                  </Field>
                )}
                {authType === "api_key" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Header name">
                      <Input name="api_key_name" required defaultValue="X-API-Key" />
                    </Field>
                    <Field label="API key">
                      <Input name="auth_value" type="password" required autoComplete="off" />
                    </Field>
                  </div>
                )}
                {authType === "basic" && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Username">
                      <Input name="basic_username" required autoComplete="username" />
                    </Field>
                    <Field label="Password">
                      <Input name="basic_password" type="password" autoComplete="new-password" />
                    </Field>
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
                  <label className="mb-1.5 block text-ui font-medium text-fg">
                    Database Engine
                  </label>
                  <div className="flex gap-2">
                    {DB_TYPES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setDbType(d.value)}
                        aria-pressed={dbType === d.value}
                        className={cn(
                          "flex-1 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-ui font-medium transition-colors",
                          dbType === d.value ? "border-primary bg-primary-wash outline outline-1 outline-primary" : "border-border hover:bg-subtle",
                        )}
                      >
                        <span className="text-lg">{d.icon}</span>
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Host / Server" className="col-span-2">
                    <Input
                        name="db_host"
                        required
                        placeholder={
                          dbType === "mssql"
                            ? "server.database.windows.net"
                            : "db.example.com"
                        }
                      />
                  </Field>
                  <Field label="Port">
                    <Input
                        name="db_port"
                        defaultValue={selectedDbType?.port}
                        placeholder={selectedDbType?.port}
                      />
                  </Field>
                </div>

                <Field label="Database Name">
                  <Input
                      name="db_database"
                      required
                      placeholder={
                        dbType === "mssql" ? "master" : "my_database"
                      }
                    />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Username">
                    <Input
                        name="db_username"
                        required
                        placeholder={dbType === "mssql" ? "sa" : "postgres"}
                      />
                  </Field>
                  <Field label="Password">
                    <Input
                        name="db_password"
                        type="password"
                        placeholder="••••••••"
                      />
                  </Field>
                </div>
              </>
            )}

            {/* Tags */}
            <div>
              <label className="mb-1.5 block text-ui font-medium text-fg">Tags</label>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-primary-wash text-primary-text">
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
              <InlineNotice tone={testResult.success ? "success" : "danger"} title={testResult.success ? "Connected" : "Connection failed"} message={testResult.message} />
            )}

          </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                className="mr-auto"
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
                      if (selectedAuthType === "windows") authConfig = windowsAuthToConfig(windowsAuth, false)
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
                <Zap size={14} />
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <DialogClose asChild>
                <Button type="button" variant="secondary" disabled={submitting}>Cancel</Button>
              </DialogClose>
              <SubmitButton pending={submitting} pendingLabel="Creating…">Create integration</SubmitButton>
            </DialogFooter>
          </form>
      </DialogContent>
    </Dialog>
  )
}
