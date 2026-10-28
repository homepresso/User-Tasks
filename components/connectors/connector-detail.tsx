"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ConnectorFieldRenderer } from "./connector-field-renderer"
import {
  X, Loader2, CheckCircle2, XCircle, Zap, Trash2, Power, PowerOff,
  MessageSquare, Mail, Sparkles, Brain, CreditCard, Phone,
  Cloud, HardDrive, Users, Plug, ExternalLink, CloudCog, FolderOpen,
  Container, Database, Snowflake, Leaf, UserCircle, Globe,
  Archive, Ticket, Inbox, FileText, CheckSquare, PenTool, Cog, ServerCog,
  Workflow, Layers, RefreshCw, Plus, AlertTriangle,
} from "lucide-react"
import { updateConnector, disableConnector, reenableConnector, deleteConnector, testConnectorConnection } from "@/app/actions/connectors"
import { runInlineJob, useJobs } from "@/components/jobs/jobs-provider"
import type { ConnectorDefinition } from "@/lib/connectors/registry"
import { getConnectorUiCopy } from "@/lib/connectors/ui"
import { getConnectorFieldErrors, getMissingConnectorFields } from "@/lib/connectors/form-state"
import { runConnectorPreflight } from "@/lib/connectors/preflight"
import { InlineNotice } from "@/components/ui/inline-notice"
import { ExportAssetButton } from "@/components/shared/config-transfer"

const iconMap: Record<string, any> = {
  MessageSquare, Mail, Sparkles, Brain, CreditCard, Phone,
  Cloud, HardDrive, Users, Plug, CloudCog, FolderOpen,
  Container, Database, Snowflake, Leaf, UserCircle, Globe,
  Archive, Ticket, Inbox, FileText, CheckSquare, PenTool, Cog, ServerCog,
  Workflow, Layers,
}

interface LiveReference {
  id: string
  integration_id: string
  name: string
  description: string | null
}

interface DetailProps {
  definition: ConnectorDefinition
  connector: {
    id: string
    config: Record<string, any>
    credentials: Record<string, any>
    is_enabled: boolean
    last_tested_at: string | null
    last_test_status: string | null
    last_test_message: string | null
    integration_id: string | null
    display_name?: string | null
  }
  liveReferences?: LiveReference[]
  onClose: () => void
  onUpdated: () => void
  onAddInstance?: () => void
}

export function ConnectorDetail({ definition, connector, liveReferences = [], onClose, onUpdated, onAddInstance }: DetailProps) {
  const [credentials, setCredentials] = useState<Record<string, any>>(connector.credentials ?? {})
  const [config, setConfig] = useState<Record<string, any>>(connector.config ?? {})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ status: string; message: string; hint?: string } | null>(
    connector.last_test_status ? { status: connector.last_test_status, message: connector.last_test_message ?? '' } : null
  )
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const jobs = useJobs()
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)

  const Icon = iconMap[definition.icon] ?? Plug

  const expectedRefCount = definition.referenceTemplates.length
  const liveRefCount = liveReferences.length
  const refsMissing = liveRefCount < expectedRefCount
  const refsAllMissing = liveRefCount === 0 && expectedRefCount > 0
  const uiCopy = getConnectorUiCopy(definition)

  // Status reflects both is_enabled and whether references actually exist
  const effectiveStatus = !connector.is_enabled ? 'disabled' :
    refsAllMissing ? 'no_refs' :
    refsMissing ? 'partial' : 'active'

  const statusLabel = effectiveStatus === 'disabled' ? 'Disabled' :
    effectiveStatus === 'no_refs' ? 'No References' :
    effectiveStatus === 'partial' ? `Active (${liveRefCount}/${expectedRefCount} refs)` :
    'Active'

  const statusColor = effectiveStatus === 'active' ? definition.color :
    effectiveStatus === 'disabled' ? 'var(--theme-muted-text)' :
    'var(--theme-warning)'
  const missingCredentialFields = getMissingConnectorFields(definition.credentialFields, credentials)
  const missingConfigFields = getMissingConnectorFields(definition.fields, config)
  const credentialErrors = getConnectorFieldErrors(definition.credentialFields, credentials)
  const configErrors = getConnectorFieldErrors(definition.fields, config)
  const preflightResult = runConnectorPreflight(definition.key, config, credentials)
  const canSave = missingCredentialFields.length === 0
    && missingConfigFields.length === 0
    && Object.keys(credentialErrors).length === 0
    && Object.keys(configErrors).length === 0

  async function handleSave() {
    setSaving(true)
    try {
      await updateConnector(connector.id, config, credentials)
      setNotice({ tone: 'success', message: 'Connector saved.' })
      onUpdated()
    } catch (e: any) {
      setNotice({ tone: 'error', message: `Failed to save: ${e.message}` })
    }
    setSaving(false)
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnectorConnection(definition.key, config, credentials, connector.id)
      setTestResult(result)
    } catch (e: any) {
      setTestResult({ status: 'error', message: e.message })
    }
    setTesting(false)
  }

  async function handleToggle() {
    setToggling(true)
    try {
      if (connector.is_enabled) {
        await disableConnector(connector.id)
        setNotice({ tone: 'success', message: 'Connector disabled.' })
      } else {
        await reenableConnector(connector.id)
        setNotice({ tone: 'success', message: 'Connector enabled.' })
      }
      onUpdated()
    } catch (e: any) {
      setNotice({ tone: 'error', message: `Failed: ${e.message}` })
    }
    setToggling(false)
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteConnector(connector.id)
      setNotice({ tone: 'success', message: 'Connector deleted.' })
      onUpdated()
      onClose()
    } catch (e: any) {
      setNotice({ tone: 'error', message: `Failed to delete: ${e.message}` })
      setDeleting(false)
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    // A `connectors.regenerate_references` job.
    const outcome = await runInlineJob(jobs, 'connectors.regenerate_references', { connector_id: connector.id, name: connector.display_name ?? definition?.name ?? 'connector' }, { onSuccess: () => onUpdated() })
    if (outcome.status === 'failed') setNotice({ tone: 'error', message: `Failed to regenerate: ${outcome.error}` })
    else if (outcome.status === 'done') setNotice({ tone: 'success', message: outcome.job.result?.summary ? `References regenerated: ${outcome.job.result.summary}.` : 'References regenerated.' })
    setRegenerating(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--theme-card-bg)' }}
        onClick={e => e.stopPropagation()}
      >
        {notice && (
          <div className="px-6 pt-4">
            <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: definition.color + '15' }}>
            <Icon size={18} style={{ color: definition.color }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                {definition.name}
              </h2>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: statusColor + (effectiveStatus === 'active' ? '15' : '20'),
                  color: statusColor,
                }}>
                {statusLabel}
              </span>
            </div>
            {connector.last_tested_at && (
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                Last tested {new Date(connector.last_tested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <ExportAssetButton ids={[connector.id]} name={connector.display_name || definition.name} className="!h-7" />
          <button onClick={onClose} className="hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto space-y-5">
          {/* Credentials */}
          <div>
            <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>
              {uiCopy.credentialTitle}
            </h3>
            <ConnectorFieldRenderer
              fields={definition.credentialFields}
              values={credentials}
              onChange={(key, value) => setCredentials(prev => ({ ...prev, [key]: value }))}
            />
          </div>

          {/* Config */}
          {definition.fields.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>Configuration</h3>
              <ConnectorFieldRenderer
                fields={definition.fields}
                values={config}
                onChange={(key, value) => setConfig(prev => ({ ...prev, [key]: value }))}
              />
            </div>
          )}
          {definition.recommendedPermissions && (
            <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                {definition.recommendedPermissions.title ?? 'Recommended Permissions'}
              </p>
              <div className="space-y-1">
                {definition.recommendedPermissions.items.map((item) => (
                  <p key={item} className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    • {item}
                  </p>
                ))}
              </div>
              {definition.recommendedPermissions.note && (
                <p className="text-[10px]" style={{ color: 'var(--theme-card-text)' }}>
                  {definition.recommendedPermissions.note}
                </p>
              )}
            </div>
          )}

          {preflightResult && (
            <div
              className="rounded-xl border p-3"
              style={{
                borderColor: 'var(--theme-warning)',
                backgroundColor: 'var(--theme-warning)' + '10',
              }}
            >
              <p className="text-xs font-semibold" style={{ color: 'var(--theme-warning)' }}>
                Preflight Issues
              </p>
              <p className="text-[10px] mt-1" style={{ color: 'var(--theme-card-text)' }}>
                {preflightResult.message}
              </p>
              {preflightResult.hint && (
                <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                  {preflightResult.hint}
                </p>
              )}
            </div>
          )}

          {/* Test */}
          <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
            <Button size="sm" onClick={handleTest} disabled={testing || Boolean(preflightResult)} variant="outline" className="w-full">
              {testing ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Testing...</> :
                <><Zap size={14} className="mr-1.5" /> Test Connection</>}
            </Button>
            {testResult && (
              <div className="flex items-start gap-2 rounded-lg p-2.5" style={{
                backgroundColor: testResult.status === 'success' ? 'var(--theme-success)' + '10' : 'var(--theme-danger)' + '10',
              }}>
                {testResult.status === 'success' ?
                  <CheckCircle2 size={14} style={{ color: 'var(--theme-success)' }} className="shrink-0 mt-0.5" /> :
                  <XCircle size={14} style={{ color: 'var(--theme-danger)' }} className="shrink-0 mt-0.5" />
                }
                <div>
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{testResult.message}</p>
                  {testResult.hint && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--theme-card-text)' }}>
                      Hint: {testResult.hint}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Live References */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                {uiCopy.referenceHeading} ({liveRefCount}/{expectedRefCount})
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerate}
                disabled={regenerating}
                className="h-6 text-[10px] px-2"
              >
                {regenerating ? <Loader2 size={10} className="mr-1 animate-spin" /> : <RefreshCw size={10} className="mr-1" />}
                {regenerating ? 'Regenerating...' : 'Regenerate'}
              </Button>
            </div>

            {/* Warning if references are missing */}
            {refsMissing && (
              <div className="flex items-start gap-2 rounded-lg p-2.5 mb-2" style={{
                backgroundColor: 'var(--theme-warning)' + '10',
              }}>
                <AlertTriangle size={12} style={{ color: 'var(--theme-warning)' }} className="shrink-0 mt-0.5" />
                <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  {refsAllMissing
                    ? 'All references have been deleted. Click Regenerate to recreate them.'
                    : `${expectedRefCount - liveRefCount} reference${expectedRefCount - liveRefCount > 1 ? 's' : ''} missing. Click Regenerate to restore.`
                  }
                </p>
              </div>
            )}

            <div className="space-y-1">
              {liveRefCount > 0 ? (
                // Show actual live references from DB
                liveReferences.map(ref => (
                  <div key={ref.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5" style={{ backgroundColor: 'var(--theme-surface)' }}>
                    <Icon size={10} style={{ color: definition.color }} />
                    <span className="text-[11px] truncate" style={{ color: 'var(--theme-card-text)' }}>{ref.name}</span>
                    {ref.description && (
                      <span className="text-[9px] truncate" style={{ color: 'var(--theme-muted-text)' }}>— {ref.description}</span>
                    )}
                  </div>
                ))
              ) : (
                // Fallback: show expected templates (greyed out)
                definition.referenceTemplates.map(tpl => (
                  <div key={tpl.key} className="flex items-center gap-2 rounded-lg px-3 py-1.5 opacity-40" style={{ backgroundColor: 'var(--theme-surface)' }}>
                    <Icon size={10} style={{ color: 'var(--theme-muted-text)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{tpl.name}</span>
                    <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>— not created</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Docs link */}
          {definition.docsUrl && (
            <a href={definition.docsUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] hover:underline"
              style={{ color: definition.color }}>
              <ExternalLink size={10} /> {uiCopy.docsLabel}
            </a>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleToggle} disabled={toggling}>
              {toggling ? <Loader2 size={14} className="animate-spin" /> :
                connector.is_enabled ? <><PowerOff size={14} className="mr-1" /> Disable</> :
                <><Power size={14} className="mr-1" /> Enable</>}
            </Button>
            {onAddInstance && (
              <Button variant="outline" size="sm" onClick={onAddInstance}>
                <Plus size={14} className="mr-1" /> New Instance
              </Button>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-red-500">Are you sure?</span>
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : 'Delete'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>No</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} className="!text-red-500">
                <Trash2 size={14} />
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !canSave}
              className={!canSave ? "opacity-60" : ""}
              style={{ backgroundColor: definition.color, color: 'white', borderColor: definition.color }}>
              {saving ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Saving...</> : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
