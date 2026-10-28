"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { generateApiKey, revokeApiKey, deleteApiKey } from "@/app/actions/api-keys"
import { bulkDeleteWithJob, useJobs } from "@/components/jobs/jobs-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card } from "@/components/ui/card"
import {
  Key, Plus, Trash2, Ban, Copy, Check, Clock, X,
  Infinity, Calendar, Search,
} from "lucide-react"
import { formatRelativeDate, getInitials } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { InlineNotice } from "@/components/ui/inline-notice"
import { buildQueuedDeleteNotice, type DeleteNotice } from "@/lib/queued-delete-feedback"

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  expires_at: string | null
  is_revoked: boolean | null
  last_used_at: string | null
  created_at: string
  key_type?: string | null
  scopes?: any
  user_id?: string | null
  workflow_source_id: string | null
}

interface ApiKeysManagerProps {
  apiKeys: ApiKey[]
  workflowSources: { id: string; display_name: string; engine_type: string }[]
  webhooks: { id: string; slug: string; workflow: { name: string } | null }[]
  workflows: { id: string; name: string; is_active: boolean | null }[]
  tables: { id: string; name: string; slug: string }[]
  users: { id: string; display_name: string | null; email: string | null }[]
}

const KEY_TYPES = [
  {
    value: "permanent",
    label: "Permanent",
    description: "Never expires — use for trusted systems",
    icon: Infinity,
    color: "#22C55E",
    expiresIn: "",
  },
  {
    value: "90days",
    label: "90 Days",
    description: "Expires in 90 days — good for apps",
    icon: Calendar,
    color: "#3B82F6",
    expiresIn: "90",
  },
  {
    value: "30days",
    label: "30 Days",
    description: "Short-lived — testing and development",
    icon: Clock,
    color: "#F59E0B",
    expiresIn: "30",
  },
  {
    value: "7days",
    label: "7 Days",
    description: "Temporary — one-time integrations",
    icon: Clock,
    color: "#EF4444",
    expiresIn: "7",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Set your own expiry date",
    icon: Calendar,
    color: "#8B5CF6",
    expiresIn: "custom",
  },
]

export function ApiKeysManager({ apiKeys, workflowSources, webhooks: _webhooks, workflows, tables, users }: ApiKeysManagerProps) {
  const [localApiKeys, setLocalApiKeys] = useState<ApiKey[]>(apiKeys)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [selectedType, setSelectedType] = useState("permanent")
  const [customDays, setCustomDays] = useState("")
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<"all" | "active" | "revoked" | "expired">("all")
  const [keyKind, setKeyKind] = useState<"tenant" | "user">("tenant")
  const [selectedUserId, setSelectedUserId] = useState("")
  const [userSearch, setUserSearch] = useState("")
  const [userPickerOpen, setUserPickerOpen] = useState(false)
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([])
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([])
  const [deleteNotice, setDeleteNotice] = useState<DeleteNotice | null>(null)
  const userPickerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const jobs = useJobs()

  useEffect(() => {
    setLocalApiKeys(apiKeys)
  }, [apiKeys])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userPickerRef.current && !userPickerRef.current.contains(event.target as Node)) {
        setUserPickerOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function handleCreate(formData: FormData) {
    const typeConfig = KEY_TYPES.find((t) => t.value === selectedType)
    let expiresIn = typeConfig?.expiresIn ?? ""
    if (selectedType === "custom" && customDays) {
      expiresIn = customDays
    }
    formData.set("expires_in", expiresIn)
    const key = await generateApiKey(formData)
    setNewKey(key)
    setCreating(false)
    router.refresh()
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? It will stop working immediately.")) return
    await revokeApiKey(id)
    setDeleteNotice({ tone: 'success', message: 'API key revoked. It will stop working immediately.' })
    router.refresh()
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this API key permanently?")) return
    const previous = localApiKeys
    setLocalApiKeys((current) => current.filter((key) => key.id !== id))
    try {
      await deleteApiKey(id)
      setDeleteNotice({ tone: 'success', message: 'API key deleted.' })
      router.refresh()
    } catch (error) {
      setLocalApiKeys(previous)
      setDeleteNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to delete API key' })
      throw error
    }
  }

  async function handleDeleteVisible() {
    const ids = filteredKeys.map((key) => key.id)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} visible API key${ids.length !== 1 ? 's' : ''} permanently?`)) return
    const previous = localApiKeys
    setLocalApiKeys((current) => current.filter((key) => !ids.includes(key.id)))
    try {
      const result = await bulkDeleteWithJob(jobs, 'api_key', ids, () => router.refresh())
      if (!result.background) setDeleteNotice(buildQueuedDeleteNotice({
        queued: result.queued,
        total: ids.length,
        singular: 'API key',
        plural: 'API keys',
      }))
      router.refresh()
    } catch (error) {
      setLocalApiKeys(previous)
      setDeleteNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to delete API keys' })
      throw error
    }
  }

  function copyKey() {
    if (newKey) {
      navigator.clipboard.writeText(newKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const now = new Date()
  const filteredKeys = localApiKeys.filter((key) => {
    if (search && !key.name.toLowerCase().includes(search.toLowerCase()) && !key.key_prefix.includes(search)) return false
    const isExpired = key.expires_at && new Date(key.expires_at) < now
    if (filter === "active") return !key.is_revoked && !isExpired
    if (filter === "revoked") return key.is_revoked
    if (filter === "expired") return isExpired && !key.is_revoked
    return true
  })

  const activeCount = localApiKeys.filter((k) => !k.is_revoked && (!k.expires_at || new Date(k.expires_at) > now)).length
  const revokedCount = localApiKeys.filter((k) => k.is_revoked).length
  const expiredCount = localApiKeys.filter((k) => k.expires_at && new Date(k.expires_at) < now && !k.is_revoked).length
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return users.slice(0, 12)
    return users
      .filter((user) =>
        (user.display_name ?? "").toLowerCase().includes(query) ||
        (user.email ?? "").toLowerCase().includes(query)
      )
      .slice(0, 12)
  }, [userSearch, users])

  function toggleSelection(list: string[], value: string, setList: (values: string[]) => void) {
    setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  }

  function selectUser(userId: string) {
    setSelectedUserId(userId)
    setUserSearch("")
    setUserPickerOpen(false)
  }

  return (
    <div className="space-y-4">
      {deleteNotice && (
        <InlineNotice
          tone={deleteNotice.tone}
          message={deleteNotice.message}
          onDismiss={() => setDeleteNotice(null)}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="!p-3">
          <p className="text-[10px] font-medium" style={{ color: "var(--theme-muted-text)" }}>Active</p>
          <p className="text-2xl font-bold" style={{ color: "var(--theme-primary-text)" }}>{activeCount}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[10px] font-medium" style={{ color: "var(--theme-muted-text)" }}>Expired</p>
          <p className="text-2xl font-bold" style={{ color: "var(--theme-warning)" }}>{expiredCount}</p>
        </Card>
        <Card className="!p-3">
          <p className="text-[10px] font-medium" style={{ color: "var(--theme-muted-text)" }}>Revoked</p>
          <p className="text-2xl font-bold" style={{ color: "var(--theme-danger)" }}>{revokedCount}</p>
        </Card>
      </div>

      {/* New key alert */}
      {newKey && (
        <div className="rounded-lg p-4 space-y-2" style={{ backgroundColor: "var(--theme-primary-light)", border: "2px solid var(--theme-primary)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--theme-primary-text)" }}>
            API Key Created — Copy it now!
          </p>
          <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
            This key will not be shown again. Store it securely.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 rounded px-3 py-2 text-xs font-mono break-all"
              style={{ backgroundColor: "var(--theme-card-bg)", border: "1px solid var(--theme-surface-border)" }}>
              {newKey}
            </code>
            <Button size="sm" variant="outline" onClick={copyKey}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setNewKey(null)} className="!text-xs">
            Dismiss
          </Button>
        </div>
      )}

      {/* Create / Search / Filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--theme-muted-text)" }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search keys..." className="pl-9" />
        </div>
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
          {(["all", "active", "revoked", "expired"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-2 text-[10px] font-medium capitalize transition-colors"
              style={{
                backgroundColor: filter === f ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: filter === f ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}>
              {f}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCreating(!creating)}>
          <Plus size={14} className="mr-1" /> New Key
        </Button>
        {filteredKeys.length > 1 && (
          <Button size="sm" variant="outline" onClick={handleDeleteVisible}>
            <Trash2 size={14} className="mr-1" /> Delete Visible
          </Button>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <Card>
          <h3 className="text-sm font-semibold mb-4">Generate API Key</h3>
          <form action={handleCreate} className="space-y-4">
            <input type="hidden" name="key_type" value={keyKind} />
            <input type="hidden" name="user_id" value={selectedUserId} />
            <input type="hidden" name="workflow_ids_json" value={JSON.stringify(selectedWorkflowIds)} />
            <input type="hidden" name="table_ids_json" value={JSON.stringify(selectedTableIds)} />

            <div>
              <label className="block text-xs font-medium mb-1">Key Name</label>
              <Input name="name" required placeholder="e.g. Production Workflow, Nintex Integration" />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2">Key Context</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "tenant", label: "Tenant Key", description: "Shared system key for integrations and service-to-service access" },
                  { value: "user", label: "User Key", description: "Runs API and MCP actions as a specific UserTasks user" },
                ].map((option) => {
                  const selected = keyKind === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setKeyKind(option.value as "tenant" | "user")}
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
              <p className="text-[10px] mt-2" style={{ color: "var(--theme-muted-text)" }}>
                Use a user key for Claude/OpenAI MCP clients when you want task, workflow, and data actions to run with a known UserTasks user context.
              </p>
            </div>

            {keyKind === "user" && (
              <div>
                <label className="block text-xs font-medium mb-1">User Context</label>
                <div ref={userPickerRef} className="relative">
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--theme-muted-text)" }} />
                    <Input
                      value={userSearch}
                      onChange={(e) => {
                        setUserSearch(e.target.value)
                        setUserPickerOpen(true)
                      }}
                      onFocus={() => setUserPickerOpen(true)}
                      placeholder={selectedUser ? "Change user…" : "Search users by name or email…"}
                      className="pl-9 pr-9"
                      required={!selectedUserId}
                    />
                    {selectedUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUserId("")
                          setUserSearch("")
                          setUserPickerOpen(true)
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-70"
                        style={{ color: "var(--theme-muted-text)" }}
                        title="Clear selected user"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {selectedUser && (
                    <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full px-2.5 py-1.5 text-xs"
                      style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold"
                        style={{ backgroundColor: "var(--theme-primary)", color: 'var(--theme-on-primary)' }}>
                        {getInitials(selectedUser.display_name || selectedUser.email || "U")}
                      </span>
                      <span className="truncate">
                        {selectedUser.display_name || selectedUser.email || selectedUser.id}
                        {selectedUser.email ? ` · ${selectedUser.email}` : ""}
                      </span>
                    </div>
                  )}

                  {userPickerOpen && (
                    <div
                      className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border shadow-lg"
                      style={{
                        backgroundColor: "var(--theme-card-bg)",
                        borderColor: "var(--theme-surface-border)",
                      }}
                    >
                      {filteredUsers.length === 0 ? (
                        <div className="px-3 py-3 text-xs" style={{ color: "var(--theme-muted-text)" }}>
                          No users match that search.
                        </div>
                      ) : (
                        filteredUsers.map((user) => {
                          const isActive = selectedUserId === user.id
                          return (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => selectUser(user.id)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:opacity-90"
                              style={{
                                backgroundColor: isActive ? "var(--theme-primary-light)" : "transparent",
                                color: isActive ? "var(--theme-primary-text)" : "var(--theme-card-text)",
                              }}
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                                style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                                {getInitials(user.display_name || user.email || "U")}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium">
                                  {user.display_name || user.email || user.id}
                                </span>
                                <span className="block truncate text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                                  {user.email || user.id}
                                </span>
                              </span>
                              {isActive && (
                                <span className="text-[10px] font-medium">Selected</span>
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
                <p className="text-[10px] mt-1" style={{ color: "var(--theme-muted-text)" }}>
                  Start typing to find the user whose task, workflow, and data context this key should run as.
                </p>
              </div>
            )}

            {/* Key type selector */}
            <div>
              <label className="block text-xs font-medium mb-2">Expiry Type</label>
              <div className="grid grid-cols-5 gap-2">
                {KEY_TYPES.map((type) => {
                  const Icon = type.icon
                  const isSelected = selectedType === type.value
                  return (
                    <button key={type.value} type="button" onClick={() => setSelectedType(type.value)}
                      className="rounded-lg border-2 p-2 text-center transition-all"
                      style={{
                        borderColor: isSelected ? type.color : "var(--theme-surface-border)",
                        backgroundColor: isSelected ? type.color + "10" : "transparent",
                      }}>
                      <Icon size={16} className="mx-auto mb-1" style={{ color: type.color }} />
                      <p className="text-[10px] font-medium">{type.label}</p>
                    </button>
                  )
                })}
              </div>
              <p className="text-[10px] mt-1" style={{ color: "var(--theme-muted-text)" }}>
                {KEY_TYPES.find((t) => t.value === selectedType)?.description}
              </p>
            </div>

            {/* Custom days input */}
            {selectedType === "custom" && (
              <div>
                <label className="block text-xs font-medium mb-1">Expires in (days)</label>
                <Input type="number" value={customDays} onChange={(e) => setCustomDays(e.target.value)}
                  min="1" max="3650" placeholder="e.g. 365" />
              </div>
            )}

            {/* Scope */}
            <div>
              <label className="block text-xs font-medium mb-1">
                Legacy Workflow Source <span className="font-normal" style={{ color: "var(--theme-muted-text)" }}>(optional)</span>
              </label>
              <select name="workflow_source_id"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
                <option value="">All workflows (unrestricted)</option>
                <optgroup label="Workflow Sources">
                  {workflowSources.map((ws) => (
                    <option key={ws.id} value={ws.id}>{ws.display_name} ({ws.engine_type})</option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium mb-2">
                  Workflow Scope <span className="font-normal" style={{ color: "var(--theme-muted-text)" }}>(optional)</span>
                </label>
                <div className="max-h-48 overflow-auto rounded-lg border p-2 space-y-1"
                  style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                  {workflows.length === 0 ? (
                    <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>No workflows available.</p>
                  ) : workflows.map((workflow) => (
                    <label key={workflow.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:opacity-90 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedWorkflowIds.includes(workflow.id)}
                        onChange={() => toggleSelection(selectedWorkflowIds, workflow.id, setSelectedWorkflowIds)}
                      />
                      <span className="text-xs">
                        {workflow.name}
                        <span style={{ color: "var(--theme-muted-text)" }}> {workflow.is_active ? "· Active" : "· Draft"}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] mt-1" style={{ color: "var(--theme-muted-text)" }}>
                  Leave empty for all workflows. When set, workflow APIs and MCP workflow tools are limited to these items.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium mb-2">
                  Data Table Scope <span className="font-normal" style={{ color: "var(--theme-muted-text)" }}>(optional)</span>
                </label>
                <div className="max-h-48 overflow-auto rounded-lg border p-2 space-y-1"
                  style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                  {tables.length === 0 ? (
                    <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>No tables available.</p>
                  ) : tables.map((table) => (
                    <label key={table.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:opacity-90 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTableIds.includes(table.id)}
                        onChange={() => toggleSelection(selectedTableIds, table.id, setSelectedTableIds)}
                      />
                      <span className="text-xs">
                        {table.name}
                        <span style={{ color: "var(--theme-muted-text)" }}> · {table.slug}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-[10px] mt-1" style={{ color: "var(--theme-muted-text)" }}>
                  Leave empty for all tables. OData, REST data routes, and MCP data tools honor this scope.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" size="sm">
                <Key size={14} className="mr-1" /> Generate Key
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Key list */}
      {filteredKeys.length === 0 ? (
        <Card>
          <div className="text-center py-6">
            <Key size={32} className="mx-auto mb-2" style={{ color: "var(--theme-muted-text)" }} />
            <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>
              {localApiKeys.length === 0 ? "No API keys yet. Generate one to enable integrations." : "No keys match your filter."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredKeys.map((key) => {
            const isExpired = key.expires_at && new Date(key.expires_at) < now
            const isPermanent = !key.expires_at

            return (
              <Card key={key.id} className="!p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Key size={14} style={{
                        color: key.is_revoked ? "var(--theme-danger)" :
                          isExpired ? "var(--theme-warning)" : "var(--theme-primary)"
                      }} />
                      <span className="text-sm font-medium">{key.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                        {key.key_type === "user" ? "User key" : "Tenant key"}
                      </span>
                      <code className="text-[10px] font-mono px-1.5 py-0.5 rounded cursor-pointer hover:opacity-70"
                        style={{ backgroundColor: "var(--theme-surface)" }}
                        onClick={(e) => {
                          e.stopPropagation()
                          const plain = (key as any).key_plain
                          if (plain) {
                            navigator.clipboard.writeText(plain)
                          } else {
                            navigator.clipboard.writeText(key.key_prefix)
                          }
                        }}
                        title={(key as any).key_plain ? "Click to copy full key" : "Click to copy prefix"}>
                        {(key as any).key_plain ? `${(key as any).key_plain.slice(0, 12)}...` : `${key.key_prefix}...`} 📋
                      </code>
                      {!(key as any).key_plain && !key.is_revoked && (
                        <span className="text-[9px] px-1 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
                          title="The full key is shown only once, at creation. If you lost it, delete this key and create a new one.">
                          Shown once at creation
                        </span>
                      )}
                      {key.is_revoked && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Revoked</span>
                      )}
                      {isExpired && !key.is_revoked && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">Expired</span>
                      )}
                      {!isExpired && !key.is_revoked && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">Active</span>
                      )}
                      {isPermanent && !key.is_revoked && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                          <Infinity size={8} className="inline" /> No expiry
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: "var(--theme-muted-text)" }}>
                      <span>Created {formatRelativeDate(key.created_at)}</span>
                      {key.expires_at && <span>Expires {formatRelativeDate(key.expires_at)}</span>}
                      {key.last_used_at && <span>Last used {formatRelativeDate(key.last_used_at)}</span>}
                    </div>
                    {((key.scopes?.workflow_ids?.length ?? 0) > 0 || (key.scopes?.table_ids?.length ?? 0) > 0 || key.user_id) && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {key.user_id && (
                          <span className="text-[10px] px-2 py-1 rounded-full"
                            style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
                            User context
                          </span>
                        )}
                        {(key.scopes?.workflow_ids?.length ?? 0) > 0 && (
                          <span className="text-[10px] px-2 py-1 rounded-full"
                            style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                            {(key.scopes?.workflow_ids?.length ?? 0)} workflow scope{(key.scopes?.workflow_ids?.length ?? 0) === 1 ? "" : "s"}
                          </span>
                        )}
                        {(key.scopes?.table_ids?.length ?? 0) > 0 && (
                          <span className="text-[10px] px-2 py-1 rounded-full"
                            style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                            {(key.scopes?.table_ids?.length ?? 0)} table scope{(key.scopes?.table_ids?.length ?? 0) === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0 ml-3">
                    {!key.is_revoked && (
                      <button onClick={() => handleRevoke(key.id)}
                        className="p-1.5 rounded hover:text-amber-500 transition-colors"
                        style={{ color: "var(--theme-muted-text)" }} title="Revoke">
                        <Ban size={14} />
                      </button>
                    )}
                    <button onClick={() => handleDelete(key.id)}
                      className="p-1.5 rounded hover:text-red-500 transition-colors"
                      style={{ color: "var(--theme-muted-text)" }} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
