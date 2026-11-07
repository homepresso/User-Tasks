"use client"

import { useState, useEffect } from "react"
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from "@/lib/server-read"
import { saveWebhookPayloadMapping } from "@/app/actions/workflow-webhooks"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { formatAbsolute, formatDate } from "@/lib/format/date"
import { formatCount } from "@/lib/format/number"
import { Copy, Check, Plus, X, Globe, Key, Send, Variable, ArrowRight, Download } from "lucide-react"
import { cn } from "@/lib/utils"

interface PayloadMapping {
  incoming_field: string
  variable_name: string
  type: "string" | "number" | "boolean" | "object" | "array"
  description: string
  sample_value: string
}

interface WebhookTriggerConfigProps {
  workflowId: string
  workflowVariables?: { name: string; type: string; defaultValue: string; description: string }[]
  mode?: 'webhook' | 'middleware'
}

export function WebhookTriggerConfig({ workflowId, workflowVariables, mode = 'webhook' }: WebhookTriggerConfigProps) {
  const [webhook, setWebhook] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  // Synchronous guard: two clicks in one frame would create two endpoints.
  const createGuard = useSubmitGuard()
  const [copied, setCopied] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [mappings, setMappings] = useState<PayloadMapping[]>([])
  const [saving, setSaving] = useState(false)
  const [testPayload, setTestPayload] = useState("")
  const [showTest, setShowTest] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    loadWebhook()
  }, [workflowId])

  async function loadWebhook() {
    setLoading(true)
    const { data } = await serverRead("automations.webhook", { workflowId })

    if (data) {
      setWebhook(data)
      const pm = data.payload_mapping
      setMappings(Array.isArray(pm) ? (pm as unknown as PayloadMapping[]) : [])
    }
    setLoading(false)
  }

  async function createWebhook() {
    await createGuard.run(async () => {
      setCreating(true)
      setCreateError(null)

      // The session's workspace (current_tenant_id ?? tenant_id), resolved server-side.
      const { data: current, error: sessionError } = await serverRead("automations.currentTenant")
      if (sessionError?.status === 401) {
        setCreateError("You need to be signed in to create an endpoint.")
        setCreating(false)
        return
      }

      const tenantId = current?.tenantId
      if (!tenantId) {
        setCreateError("No tenant was found for this user.")
        setCreating(false)
        return
      }

      const slug = `wh-${workflowId.slice(0, 8)}-${Date.now().toString(36)}`
      const resp = await fetch("/api/webhooks/create-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_id: workflowId,
          tenant_id: tenantId,
          slug,
        }),
      })

      if (resp.ok) {
        const result = await resp.json().catch(() => null)
        if (result?.raw_key) setNewKey(result.raw_key)
        await loadWebhook()
      } else {
        const result = await resp.json().catch(() => null)
        setCreateError(result?.error ?? `Failed to create ${mode === 'middleware' ? 'middleware' : 'webhook'} endpoint.`)
      }

      setCreating(false)
    })
  }

  async function saveMappings() {
    if (!webhook) return
    setSaving(true)
    await saveWebhookPayloadMapping(webhook.id, mappings)
    setSaving(false)
  }

  function addMapping() {
    setMappings([
      ...mappings,
      { incoming_field: "", variable_name: "", type: "string", description: "", sample_value: "" },
    ])
  }

  function removeMapping(index: number) {
    setMappings(mappings.filter((_, i) => i !== index))
  }

  function updateMapping(index: number, field: keyof PayloadMapping, value: string) {
    setMappings(
      mappings.map((m, i) => {
        if (i !== index) return m
        const updated = { ...m, [field]: value }
        // Auto-generate variable name from incoming field
        if (field === "incoming_field" && !m.variable_name) {
          updated.variable_name = value.split(".").pop()?.replace(/[^a-zA-Z0-9_]/g, "_") ?? ""
        }
        return updated
      })
    )
  }

  function parseFromSample() {
    try {
      const parsed = JSON.parse(testPayload)
      const newMappings: PayloadMapping[] = []

      function extractFields(obj: any, prefix: string = "") {
        for (const [key, value] of Object.entries(obj)) {
          const path = prefix ? `${prefix}.${key}` : key
          if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            extractFields(value, path)
          } else {
            const type = Array.isArray(value) ? "array" :
              typeof value === "number" ? "number" :
              typeof value === "boolean" ? "boolean" : "string"
            newMappings.push({
              incoming_field: path,
              variable_name: path.split(".").pop()?.replace(/[^a-zA-Z0-9_]/g, "_") ?? key,
              type: type as any,
              description: "",
              sample_value: String(value).slice(0, 50),
            })
          }
        }
      }

      extractFields(parsed)
      setMappings(newMappings)
      setShowTest(false)
    } catch {
      alert("Invalid JSON")
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  const webhookUrl = webhook
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/inbound?hook=${webhook.slug}`
    : null

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2 text-fg-muted">
        <Globe size={14} aria-hidden="true" />
        <h4 className="text-xs font-medium">
          {mode === 'middleware' ? 'Middleware configuration' : 'Webhook configuration'}
        </h4>
      </div>

      {!webhook ? (
        /* ─── Create Webhook ─── */
        <EmptyState
          size="sm"
          icon={Globe}
          title={mode === 'middleware' ? 'No middleware endpoint' : 'No webhook endpoint'}
          description={mode === 'middleware'
            ? 'Create a middleware endpoint to receive external data and return the workflow response synchronously.'
            : 'Create a webhook endpoint to receive external data that triggers this workflow.'}
          className="px-2"
        >
          {createError && (
            <p className="mt-3 text-xs text-danger" role="alert">
              {createError}
            </p>
          )}
          <Button size="sm" variant="secondary" className="mt-4" onClick={createWebhook} disabled={creating} leadingIcon={<Plus />}>
            {creating ? "Creating…" : mode === 'middleware' ? "Create middleware endpoint" : "Create webhook endpoint"}
          </Button>
        </EmptyState>
      ) : (
        <>
          {/* ─── Endpoint Details ─── */}
          <Card variant="inset" padding="sm" className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">
                Endpoint URL
              </span>
              <StatusPill status={webhook.is_active ? "active" : "inactive"} label={webhook.is_active ? "Active" : "Inactive"} />
            </div>
            <div className="flex items-start gap-1">
              <code className="flex-1 break-all rounded-md border border-border bg-panel px-2 py-1.5 font-mono text-2xs text-fg">
                POST {webhookUrl}
              </code>
              <IconButton
                size="sm"
                label={copied === "url" ? "Copied" : "Copy URL"}
                icon={copied === "url" ? <Check className="text-success" /> : <Copy />}
                onClick={() => copyToClipboard(webhookUrl!, "url")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <Tooltip content="Copy key">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-sm font-mono text-2xs hover:text-fg"
                  onClick={() => navigator.clipboard.writeText((webhook as any).api_key_plain || webhook.api_key_prefix)}
                >
                  <Key size={12} aria-hidden="true" /> {(webhook as any).api_key_plain || `${webhook.api_key_prefix}...`}
                  <Copy size={12} aria-hidden="true" />
                </button>
              </Tooltip>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0 text-xs"
                onClick={async () => {
                  // The server generates the new key and returns it once.
                  const resp = await fetch("/api/webhooks/create-key", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ webhook_id: webhook.id }),
                  })
                  const result = await resp.json().catch(() => null)
                  if (resp.ok && result?.raw_key) { setNewKey(result.raw_key); await loadWebhook() }
                  else setCreateError(result?.error ?? "Failed to regenerate the key.")
                }}>
                Regenerate key
              </Button>
              <span className="num">{formatCount(webhook.receive_count ?? 0)} received</span>
              {webhook.last_received_at && (
                <Tooltip content={formatAbsolute(webhook.last_received_at)}>
                  <span>Last: {formatDate(webhook.last_received_at)}</span>
                </Tooltip>
              )}
            </div>

            <div className="text-xs text-fg-muted">
              <span className="font-medium">Auth:</span>{" "}
              <code className="font-mono text-2xs text-fg">Authorization: Bearer YOUR_KEY</code>{" "}
              or <code className="font-mono text-2xs text-fg">?key=YOUR_KEY</code>
            </div>
            {mode === 'middleware' && (
              <div className="text-xs text-fg-muted">
                The response returned by the <code className="font-mono text-2xs text-fg">End Workflow</code> node is sent back to the caller.
              </div>
            )}
          </Card>

          {/* ─── New API Key Alert ─── */}
          {newKey && (
            <InlineNotice
              tone="warning"
              title="API key created"
              className="px-2.5 py-2 text-xs"
            >
              <p className="text-fg-muted">Copy it now: it won&apos;t be shown again.</p>
              <div className="mt-1.5 flex items-start gap-1">
                <code className="flex-1 break-all rounded-md border border-border bg-panel px-2 py-1 font-mono text-2xs text-fg">
                  {newKey}
                </code>
                <IconButton
                  size="sm"
                  label={copied === "key" ? "Copied" : "Copy key"}
                  icon={copied === "key" ? <Check className="text-success" /> : <Copy />}
                  onClick={() => copyToClipboard(newKey, "key")}
                />
              </div>
              <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0 text-xs" onClick={() => setNewKey(null)}>
                I&apos;ve copied it
              </Button>
            </InlineNotice>
          )}

          {/* ─── Auto-mapped Variables ─── */}
          <div className="space-y-1 border-t border-border-subtle pt-3 text-xs">
            <p className="font-medium text-fg-muted">
              Auto-mapped from payload
            </p>
            <p className="text-fg-muted">
              JSON body fields are automatically available as workflow variables. Send <code className="font-mono text-2xs text-fg">{'{"name": "value"}'}</code> and use as <code className="font-mono text-2xs text-fg">{'{{name}}'}</code>. Full payload available as <code className="font-mono text-2xs text-fg">{'{{_raw}}'}</code>.
            </p>
          </div>

          {/* ─── Workflow Variables ─── */}
          {workflowVariables && workflowVariables.length > 0 && (
            <div className="space-y-1 border-t border-border-subtle pt-3 text-xs">
              <p className="font-medium text-fg-muted">
                Workflow variables: send these in the JSON body
              </p>
              <div className="space-y-0.5">
                {workflowVariables.map(v => (
                  <div key={v.name} className="flex items-center gap-2">
                    <code className="font-mono text-2xs text-fg">{v.name}</code>
                    <span className="text-2xs text-fg-subtle">{v.type}</span>
                    {v.defaultValue && <span className="truncate text-2xs text-fg-muted">default: {v.defaultValue}</span>}
                  </div>
                ))}
              </div>
              <p className="text-fg-muted">
                Body fields matching these names are automatically mapped, so no payload mapping is needed.
              </p>
            </div>
          )}

          {/* ─── Example Request ─── */}
          {(() => {
            const exampleBody: Record<string, any> = {}
            if (workflowVariables?.length) {
              for (const v of workflowVariables) {
                exampleBody[v.name] = v.type === 'number' ? Number(v.defaultValue) || 0
                  : v.type === 'boolean' ? v.defaultValue === 'true'
                  : v.defaultValue || `<${v.type}>`
              }
            }
            for (const m of mappings) {
              exampleBody[m.incoming_field.split(".").pop()!] = m.sample_value || `<${m.type}>`
            }
            if (Object.keys(exampleBody).length === 0) exampleBody.value = 0

            function downloadPostman() {
              const collection = {
                info: {
                  name: `Webhook — ${webhookUrl?.split('hook=')[1]?.slice(0, 12) ?? 'workflow'}`,
                  schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
                },
                item: [{
                  name: "Trigger Webhook",
                  request: {
                    method: "POST",
                    header: [
                      { key: "Authorization", value: "Bearer YOUR_API_KEY", type: "text" },
                      { key: "Content-Type", value: "application/json", type: "text" },
                    ],
                    body: {
                      mode: "raw",
                      raw: JSON.stringify(exampleBody, null, 2),
                      options: { raw: { language: "json" } },
                    },
                    url: { raw: webhookUrl, protocol: "https", host: [webhookUrl?.split("//")[1]?.split("/")[0] ?? ""], path: webhookUrl?.split("//")[1]?.split("/").slice(1).join("/").split("?")[0]?.split("/") ?? [], query: [{ key: "hook", value: webhookUrl?.split("hook=")[1] ?? "" }] },
                  },
                }],
              }
              const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/json" })
              const url = URL.createObjectURL(blob)
              const a = document.createElement("a")
              a.href = url
              a.download = `webhook-${webhookUrl?.split('hook=')[1]?.slice(0, 12) ?? 'collection'}.postman_collection.json`
              a.click()
              URL.revokeObjectURL(url)
            }

            return (
              <details className="border-t border-border-subtle pt-3 text-xs" open>
                <summary className="cursor-pointer select-none font-medium text-fg-muted hover:text-fg">
                  Example request
                </summary>
                <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-subtle p-2 font-mono text-2xs text-fg">
{`curl -X POST "${webhookUrl}" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(exampleBody, null, 2)}'`}
                </pre>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={downloadPostman}
                  className="mt-2"
                  leadingIcon={<Download />}
                >
                  Download Postman collection
                </Button>
              </details>
            )
          })()}
        </>
      )}
    </div>
  )
}
