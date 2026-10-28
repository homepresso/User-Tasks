"use client"

import { useState, useEffect } from "react"
import { serverRead } from "@/lib/server-read"
import { saveWebhookPayloadMapping } from "@/app/actions/workflow-webhooks"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
      <div className="animate-pulse space-y-3">
        <div className="h-8 rounded" style={{ backgroundColor: "var(--theme-surface)" }} />
        <div className="h-8 rounded" style={{ backgroundColor: "var(--theme-surface)" }} />
      </div>
    )
  }

  return (
    <div className="space-y-4" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <Globe size={14} style={{ color: "var(--theme-primary-text)" }} />
        <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>
          {mode === 'middleware' ? 'Middleware Configuration' : 'Webhook Configuration'}
        </h4>
      </div>

      {!webhook ? (
        /* ─── Create Webhook ─── */
        <div className="rounded-lg p-4 text-center" style={{ backgroundColor: "var(--theme-surface)", border: "1px dashed var(--theme-surface-border)" }}>
          <Globe size={24} className="mx-auto mb-2" style={{ color: "var(--theme-muted-text)" }} />
          <p className="text-xs mb-3" style={{ color: "var(--theme-muted-text)" }}>
            {mode === 'middleware'
              ? 'Create a middleware endpoint to receive external data and return the workflow response synchronously.'
              : 'Create a webhook endpoint to receive external data that triggers this workflow.'}
          </p>
          {createError && (
            <p className="text-[10px] mb-3" style={{ color: "var(--theme-danger)" }}>
              {createError}
            </p>
          )}
          <Button size="sm" onClick={createWebhook} disabled={creating}>
            <Plus size={14} className="mr-1" />
            {creating ? "Creating..." : mode === 'middleware' ? "Create Middleware Endpoint" : "Create Webhook Endpoint"}
          </Button>
        </div>
      ) : (
        <>
          {/* ─── Endpoint Details ─── */}
          <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "var(--theme-surface)", border: "1px solid var(--theme-surface-border)" }}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--theme-muted-text)" }}>
                Endpoint URL
              </span>
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                webhook.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              }`}>
                {webhook.is_active ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="flex gap-1">
              <code className="flex-1 rounded px-2 py-1.5 text-[10px] font-mono break-all"
                style={{ backgroundColor: "var(--theme-card-bg)", border: "1px solid var(--theme-surface-border)" }}>
                POST {webhookUrl}
              </code>
              <button onClick={() => copyToClipboard(webhookUrl!, "url")}
                className="shrink-0 p-1.5 rounded hover:opacity-70" style={{ color: "var(--theme-primary-text)" }}>
                {copied === "url" ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>

            <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
              <span className="flex items-center gap-1 cursor-pointer hover:opacity-70"
                onClick={() => navigator.clipboard.writeText((webhook as any).api_key_plain || webhook.api_key_prefix)}
                title="Click to copy key">
                <Key size={8} /> {(webhook as any).api_key_plain || `${webhook.api_key_prefix}...`} 📋
              </span>
              <button
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
                }}
                className="px-1.5 py-0.5 rounded hover:opacity-70"
                style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-primary-text)' }}>
                Regenerate Key
              </button>
              <span>{webhook.receive_count ?? 0} received</span>
              {webhook.last_received_at && (
                <span>Last: {new Date(webhook.last_received_at).toLocaleDateString()}</span>
              )}
            </div>

            <div className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
              <span className="font-medium">Auth:</span>{" "}
              <code className="font-mono">Authorization: Bearer YOUR_KEY</code>{" "}
              or <code className="font-mono">?key=YOUR_KEY</code>
            </div>
            {mode === 'middleware' && (
              <div className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                The response returned by the <code className="font-mono">End Workflow</code> node is sent back to the caller.
              </div>
            )}
          </div>

          {/* ─── New API Key Alert ─── */}
          {newKey && (
            <div className="rounded-lg p-3 space-y-2"
              style={{ backgroundColor: "var(--theme-primary-light)", border: "1.5px solid var(--theme-primary)" }}>
              <p className="text-[10px] font-semibold" style={{ color: "var(--theme-primary-text)" }}>
                API Key Created — Copy now, won't be shown again!
              </p>
              <div className="flex gap-1">
                <code className="flex-1 rounded px-2 py-1 text-[10px] font-mono break-all"
                  style={{ backgroundColor: "var(--theme-card-bg)" }}>
                  {newKey}
                </code>
                <button onClick={() => copyToClipboard(newKey, "key")}
                  className="shrink-0 p-1" style={{ color: "var(--theme-primary-text)" }}>
                  {copied === "key" ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <button onClick={() => setNewKey(null)} className="text-[9px] underline"
                style={{ color: "var(--theme-muted-text)" }}>
                I've copied it
              </button>
            </div>
          )}

          {/* ─── Auto-mapped Variables ─── */}
          <div className="rounded-lg p-2.5 text-[10px]" style={{ backgroundColor: "var(--theme-surface)" }}>
            <p className="font-semibold mb-1" style={{ color: "var(--theme-muted-text)" }}>
              Auto-mapped from payload
            </p>
            <p style={{ color: "var(--theme-muted-text)" }}>
              JSON body fields are automatically available as workflow variables. Send <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{'{"name": "value"}'}</code> and use as <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{'{{name}}'}</code>. Full payload available as <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{'{{_raw}}'}</code>.
            </p>
          </div>

          {/* ─── Workflow Variables ─── */}
          {workflowVariables && workflowVariables.length > 0 && (
            <div className="rounded-lg p-2.5 text-[10px]" style={{ backgroundColor: "var(--theme-surface)" }}>
              <p className="font-semibold mb-1" style={{ color: "var(--theme-muted-text)" }}>
                Workflow Variables — send these in the JSON body:
              </p>
              <div className="space-y-0.5">
                {workflowVariables.map(v => (
                  <div key={v.name} className="flex items-center gap-2">
                    <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{v.name}</code>
                    <span style={{ color: "var(--theme-muted-text)" }}>({v.type})</span>
                    {v.defaultValue && <span style={{ color: "var(--theme-muted-text)" }}>default: {v.defaultValue}</span>}
                  </div>
                ))}
              </div>
              <p className="mt-1.5" style={{ color: "var(--theme-muted-text)" }}>
                Body fields matching these names are automatically mapped — no payload mapping needed.
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
              <details className="text-[10px]" open>
                <summary className="cursor-pointer font-medium" style={{ color: "var(--theme-primary-text)" }}>
                  Example request
                </summary>
                <pre className="mt-1 rounded p-2 text-[9px] font-mono overflow-x-auto whitespace-pre-wrap"
                  style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-card-text)" }}>
{`curl -X POST "${webhookUrl}" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(exampleBody, null, 2)}'`}
                </pre>
                <button
                  onClick={downloadPostman}
                  className="mt-1.5 flex items-center gap-1.5 text-[10px] font-medium px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity"
                  style={{ borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
                >
                  <Download size={12} style={{ color: "#FF6C37" }} />
                  Download Postman Collection
                </button>
              </details>
            )
          })()}
        </>
      )}
    </div>
  )
}
