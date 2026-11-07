"use client"

import { useState } from "react"
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Button } from "@/components/ui/button"
import { ConnectorFieldRenderer } from "./connector-field-renderer"
import {
  X, ChevronRight, ChevronLeft, Loader2, CheckCircle2, XCircle,
  MessageSquare, Mail, Sparkles, Brain, CreditCard, Phone,
  Cloud, HardDrive, Users, Plug, Zap, CloudCog, FolderOpen,
  Container, Database, Snowflake, Leaf, UserCircle, Globe,
  Archive, Ticket, Inbox, FileText, CheckSquare, PenTool, Cog, ServerCog,
  Workflow, Layers,
} from "lucide-react"
import { enableConnector, testConnectorConnection } from "@/app/actions/connectors"
import type { ConnectorDefinition } from "@/lib/connectors/registry"
import { getConnectorUiCopy } from "@/lib/connectors/ui"
import { getConnectorFieldErrors, getMissingConnectorFields } from "@/lib/connectors/form-state"
import { runConnectorPreflight } from "@/lib/connectors/preflight"
import { ReferenceModePicker, type ReferenceMode } from "@/components/integrations/reference-mode-picker"

const iconMap: Record<string, any> = {
  MessageSquare, Mail, Sparkles, Brain, CreditCard, Phone,
  Cloud, HardDrive, Users, Plug, CloudCog, FolderOpen,
  Container, Database, Snowflake, Leaf, UserCircle, Globe,
  Archive, Ticket, Inbox, FileText, CheckSquare, PenTool, Cog, ServerCog,
  Workflow, Layers,
}

interface SetupDialogProps {
  definition: ConnectorDefinition
  onClose: () => void
  onEnabled: () => void
}

type Step = 'credentials' | 'config' | 'test'

export function ConnectorSetupDialog({ definition, onClose, onEnabled }: SetupDialogProps) {
  const hasConfigFields = definition.fields.length > 0
  const steps: Step[] = hasConfigFields ? ['credentials', 'config', 'test'] : ['credentials', 'test']

  const [currentStep, setCurrentStep] = useState<Step>('credentials')
  const [credentials, setCredentials] = useState<Record<string, any>>(() => {
    const defaults: Record<string, any> = {}
    definition.credentialFields.forEach(f => { if (f.defaultValue) defaults[f.key] = f.defaultValue })
    return defaults
  })
  const [config, setConfig] = useState<Record<string, any>>(() => {
    const defaults: Record<string, any> = {}
    definition.fields.forEach(f => { if (f.defaultValue) defaults[f.key] = f.defaultValue })
    return defaults
  })
  const [displayName, setDisplayName] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ status: string; message: string; hint?: string } | null>(null)
  const [enabling, setEnabling] = useState(false)
  // Synchronous guard: a double click must not enable the connector twice.
  const enableGuard = useSubmitGuard()
  const [error, setError] = useState<string | null>(null)

  const Icon = iconMap[definition.icon] ?? Plug
  const stepIndex = steps.indexOf(currentStep)
  const uiCopy = getConnectorUiCopy(definition)
  const credentialErrors = getConnectorFieldErrors(definition.credentialFields, credentials)
  const configErrors = getConnectorFieldErrors(definition.fields, config)
  const preflightResult = runConnectorPreflight(definition.key, config, credentials)

  function canAdvance(): boolean {
    if (currentStep === 'credentials') {
      return getMissingConnectorFields(definition.credentialFields, credentials).length === 0
        && Object.keys(credentialErrors).length === 0
    }
    if (currentStep === 'config') {
      return getMissingConnectorFields(definition.fields, config).length === 0
        && Object.keys(configErrors).length === 0
    }
    return Object.keys(credentialErrors).length === 0
      && Object.keys(configErrors).length === 0
      && !preflightResult
  }

  function nextStep() {
    const idx = steps.indexOf(currentStep)
    if (idx < steps.length - 1) setCurrentStep(steps[idx + 1])
  }

  function prevStep() {
    const idx = steps.indexOf(currentStep)
    if (idx > 0) setCurrentStep(steps[idx - 1])
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const result = await testConnectorConnection(definition.key, config, credentials)
      setTestResult(result)
    } catch (e: any) {
      setTestResult({ status: 'error', message: e.message })
    }
    setTesting(false)
  }

  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('all')
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set())

  async function handleEnable() {
    await enableGuard.run(async () => {
      setEnabling(true)
      setError(null)
      try {
        await enableConnector(definition.key, config, credentials, displayName || undefined,
          { mode: referenceMode, ...(referenceMode === 'selected' ? { keys: Array.from(selectedTemplates) } : {}) })
        onEnabled()
      } catch (e: any) {
        setError(e.message)
        setEnabling(false)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" />

      {/* Dialog */}
      <div
        className="relative w-full max-w-lg mx-4 rounded-2xl shadow-2xl overflow-hidden bg-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: definition.color + '15' }}
          >
            <Icon size={18} style={{ color: definition.color }} />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-fg">
              Connect {definition.name}
            </h2>
            <p className="text-2xs text-fg-muted">
              Step {stepIndex + 1} of {steps.length}
            </p>
          </div>
          <button onClick={onClose} className="hover:opacity-70 text-fg-muted">
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 w-full bg-bg">
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${((stepIndex + 1) / steps.length) * 100}%`,
              backgroundColor: definition.color,
            }}
          />
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
          {currentStep === 'credentials' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold mb-1 text-fg">
                  {uiCopy.credentialTitle}
                </h3>
                <p className="text-2xs text-fg-muted">
                  {uiCopy.credentialDescription}
                </p>
              </div>
              <ConnectorFieldRenderer
                fields={definition.credentialFields}
                values={credentials}
                onChange={(key, value) => setCredentials(prev => ({ ...prev, [key]: value }))}
              />
              {definition.docsUrl && (
                <a href={definition.docsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-2xs hover:underline"
                  style={{ color: definition.color }}>
                  {uiCopy.docsLabel}
                  <ChevronRight size={10} />
                </a>
              )}
              {definition.recommendedPermissions && (
                <div className="rounded-xl border p-3 space-y-2 border-border bg-bg">
                  <p className="text-xs font-semibold text-fg">
                    {definition.recommendedPermissions.title ?? 'Recommended Permissions'}
                  </p>
                  <div className="space-y-1">
                    {definition.recommendedPermissions.items.map((item) => (
                      <p key={item} className="text-2xs text-fg-muted">
                        • {item}
                      </p>
                    ))}
                  </div>
                  {definition.recommendedPermissions.note && (
                    <p className="text-2xs text-fg">
                      {definition.recommendedPermissions.note}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {currentStep === 'config' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold mb-1 text-fg">
                  {uiCopy.configTitle}
                </h3>
                <p className="text-2xs text-fg-muted">
                  {uiCopy.configDescription}
                </p>
              </div>
              <ConnectorFieldRenderer
                fields={definition.fields}
                values={config}
                onChange={(key, value) => setConfig(prev => ({ ...prev, [key]: value }))}
              />
            </div>
          )}

          {currentStep === 'test' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold mb-1 text-fg">
                  Test & Enable
                </h3>
                <p className="text-2xs text-fg-muted">
                  Verify the connection works, then enable the connector. Its references will be available via the Call Reference activity in your workflows.
                </p>
              </div>

              {preflightResult && (
                <div
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: 'var(--theme-warning)',
                    backgroundColor: 'var(--theme-warning)' + '10',
                  }}
                >
                  <p className="text-xs font-semibold text-warning">
                    Preflight Issues
                  </p>
                  <p className="text-2xs mt-1 text-fg">
                    {preflightResult.message}
                  </p>
                  {preflightResult.hint && (
                    <p className="text-2xs mt-1 text-fg-muted">
                      {preflightResult.hint}
                    </p>
                  )}
                </div>
              )}
              {definition.recommendedPermissions && (
                <div className="rounded-xl border p-3 space-y-2 border-border bg-bg">
                  <p className="text-xs font-semibold text-fg">
                    {definition.recommendedPermissions.title ?? 'Recommended Permissions'}
                  </p>
                  <div className="space-y-1">
                    {definition.recommendedPermissions.items.map((item) => (
                      <p key={item} className="text-2xs text-fg-muted">
                        • {item}
                      </p>
                    ))}
                  </div>
                  {definition.recommendedPermissions.note && (
                    <p className="text-2xs text-fg">
                      {definition.recommendedPermissions.note}
                    </p>
                  )}
                </div>
              )}

              {/* Instance name */}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-fg">
                  Instance Name (optional)
                </label>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder={`${definition.name} — e.g. Production, Staging, US Region`}
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-panel border-border text-fg"
                />
                <p className="text-2xs text-fg-muted">
                  Label this instance to distinguish it from others of the same type.
                </p>
              </div>

              {/* Test connection */}
              <div className="rounded-xl border p-4 space-y-3 border-border bg-bg">
                <Button
                  size="sm"
                  onClick={handleTest}
                  disabled={testing || !canAdvance() || Boolean(preflightResult)}
                  className="w-full"
                  style={{ backgroundColor: definition.color, color: 'white' }}
                >
                  {testing ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Testing Connection...</> :
                    <><Zap size={14} className="mr-1.5" /> Test Connection</>}
                </Button>

                {testResult && (
                  <div className="flex items-start gap-2 rounded-lg p-3" style={{
                    backgroundColor: testResult.status === 'success' ? 'var(--theme-success)' + '10' : 'var(--theme-danger)' + '10',
                  }}>
                    {testResult.status === 'success' ? (
                      <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-success" />
                    ) : (
                      <XCircle size={16} className="shrink-0 mt-0.5 text-danger" />
                    )}
                    <div>
                      <p className="text-xs font-medium" style={{
                        color: testResult.status === 'success' ? 'var(--theme-success)' : 'var(--theme-danger)',
                      }}>
                        {testResult.status === 'success' ? 'Connection Successful' : 'Connection Failed'}
                      </p>
                      <p className="text-2xs mt-0.5 text-fg-muted">
                        {testResult.message}
                      </p>
                      {testResult.hint && (
                        <p className="text-2xs mt-1 text-fg">
                          Hint: {testResult.hint}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Which catalogue operations become references */}
              {definition.referenceTemplates.length > 0 && (
                <div>
                  <p className="text-2xs font-medium mb-2 text-fg-muted">
                    {uiCopy.referenceHeading} for the Call Reference activity:
                  </p>
                  <ReferenceModePicker
                    options={definition.referenceTemplates.map((tpl) => ({ key: tpl.key, name: tpl.name, description: tpl.description, method: tpl.method }))}
                    mode={referenceMode}
                    onModeChange={setReferenceMode}
                    selected={selectedTemplates}
                    onSelectedChange={setSelectedTemplates}
                    noun={uiCopy.referenceHeading.toLowerCase()}
                  />
                </div>
              )}

              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div>
            {stepIndex > 0 && (
              <Button variant="ghost" size="sm" onClick={prevStep}>
                <ChevronLeft size={14} className="mr-1" /> Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            {currentStep === 'test' ? (
              <Button
                size="sm"
                onClick={handleEnable}
                disabled={enabling || !canAdvance()}
                style={{ backgroundColor: definition.color, color: 'white', borderColor: definition.color }}
              >
                {enabling ? <><Loader2 size={14} className="mr-1.5 animate-spin" /> Enabling...</> : 'Enable Connector'}
              </Button>
            ) : (
              <Button size="sm" onClick={nextStep} disabled={!canAdvance()}
                style={{ backgroundColor: definition.color, color: 'white', borderColor: definition.color }}>
                Continue <ChevronRight size={14} className="ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
