"use client"

import { useState, useEffect } from "react"
import { serverRead } from "@/lib/server-read"
import { connectorBrandForTags } from "@/lib/connectors/connector-brand"
import { VariableInput } from "./variable-input"
import { Globe, Database, Zap, Network, ArrowRight, ArrowDown, Check, Variable, ChevronDown, X, Plus, Trash2, Code, FormInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ReferenceStaticValueInput } from "@/components/shared/reference-static-value-input"
import { referenceResponseSchema, stripSample, normalizeResponseSchema } from "@/lib/response-schema"
import { ResponseModelTree, describeModel, outputNameFor } from "./response-model-editor"

const typeIcons: Record<string, any> = {
  rest_api: Globe,
  database: Database,
  graphql: Zap,
  webhook: Network,
}

interface Integration {
  id: string
  name: string
  type: string
  is_active: boolean
}

interface Reference {
  id: string
  name: string
  description: string | null
  integration_id: string
  inputs: any[]
  outputs: any[]
  request_config: any
}

interface CallReferenceConfigProps {
  config: Record<string, any>
  nodeId?: string
  /** The node's output prefix — its response is `{{<prefix>_response}}`. */
  outputPrefix?: string
  onUpdate: (key: string, value: any) => void
  onBatchUpdate?: (updates: Record<string, any>) => void
}

export function CallReferenceConfig({ config, nodeId, outputPrefix, onUpdate, onBatchUpdate }: CallReferenceConfigProps) {
  // Short suffix for unique variable names (stable per node)
  const suffix = (nodeId ?? '').slice(0, 4)
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [allReferences, setAllReferences] = useState<Reference[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  useEffect(() => {
    async function load() {
      const { data } = await serverRead("automations.callReferenceOptions")
      setIntegrations((data?.integrations as any) ?? [])
      setAllReferences((data?.references as any) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const selectedRef = allReferences.find((r) => r.id === config.reference_id)

  // Snapshot the reference's response model on the node (without the sample)
  // so the data picker can browse it offline; refreshed when the reference's
  // model changes (a new test capture, a regenerated spec).
  const refModel = selectedRef ? stripSample(referenceResponseSchema(selectedRef)) : null
  const refModelKey = refModel ? JSON.stringify(refModel) : ''
  const snapshotKey = config._ref_response_schema ? JSON.stringify(config._ref_response_schema) : ''
  useEffect(() => {
    if (!selectedRef || refModelKey === snapshotKey) return
    onUpdate('_ref_response_schema', refModelKey ? JSON.parse(refModelKey) : undefined)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRef?.id, refModelKey, snapshotKey])
  const rawInputs: any[] = selectedRef?.inputs ?? []
  // Merge location overrides from workflow config
  const locationOverrides = config._ref_inputs_override as any[] | undefined
  const refInputs: any[] = rawInputs.map((inp: any) => {
    const override = locationOverrides?.find((o: any) => (o.id ?? o.name) === (inp.id ?? inp.name))
    return override ? { ...inp, location: override.location } : inp
  })
  const refOutputs: any[] = selectedRef?.outputs ?? []
  const selectedInteg = integrations.find((i) => i.id === (selectedRef?.integration_id ?? config.integration_id))

  const inputMappings: Record<string, string> = (() => {
    try {
      if (typeof config.input_mappings === "string") return JSON.parse(config.input_mappings)
      if (typeof config.input_mappings === "object") return config.input_mappings ?? {}
    } catch { /* ignore */ }
    try {
      if (typeof config.inputs === "string") return JSON.parse(config.inputs)
    } catch { /* ignore */ }
    return {}
  })()

  function updateInputMapping(inputName: string, value: string) {
    onUpdate("input_mappings", { ...inputMappings, [inputName]: value })
  }

  function selectReference(ref: Reference) {
    const mappings: Record<string, string> = {}
    const inputs = ref.inputs as any[] ?? []
    inputs.forEach((inp: any) => {
      mappings[inp.name] = inputMappings[inp.name] ?? inp.default_value ?? ""
    })
    const outMappings: Record<string, { enabled: boolean; variableName: string }> = {}
    const outputs = ref.outputs as any[] ?? []
    outputs.forEach((out: any) => {
      const existing = config.output_mappings?.[out.name]
      outMappings[out.name] = {
        enabled: existing?.enabled ?? true,
        variableName: existing?.variableName || `ref_${out.name}${suffix ? '_' + suffix : ''}`,
      }
    })

    const reqConfig = ref.request_config as any
    const batch = onBatchUpdate ?? ((u: Record<string, any>) => { Object.entries(u).forEach(([k, v]) => onUpdate(k, v)) })
    // Surface the reference's (or its integration's) icon on the node —
    // uploaded SVG/PNG first, then the OOTB connector's brand icon+color.
    const integ: any = integrations.find((i) => i.id === ref.integration_id)
    const uploadedIcon = reqConfig?.icon_url ?? integ?.config?.icon_url
    const brand = connectorBrandForTags(integ?.tags)
    batch({
      reference_id: ref.id,
      reference_name: ref.name,
      // Uploaded icon > official connector logo > lucide brand icon (load-error fallback)
      node_icon_url: uploadedIcon ?? brand?.logoSrc ?? "",
      node_icon_lucide: brand?.icon ?? "",
      node_icon_color: brand?.color ?? "",
      reference_method: reqConfig?.method ?? "GET",
      integration_id: ref.integration_id,
      input_mappings: mappings,
      output_mappings: outMappings,
      _ref_outputs: outputs.map((o: any) => ({ name: o.name, path: o.path, type: o.type })),
      _ref_response_schema: stripSample(referenceResponseSchema(ref)) ?? undefined,
      _ref_inputs: inputs.map((inp: any) => ({ name: inp.name, type: inp.type, required: inp.required ?? false, location: inp.location ?? 'query' })),
      _body_is_array: reqConfig?.body_template ? reqConfig.body_template.trim().startsWith('[') : false,
    })
  }

  function clearReference() {
    const batch = onBatchUpdate ?? ((u: Record<string, any>) => { Object.entries(u).forEach(([k, v]) => onUpdate(k, v)) })
    batch({
      reference_id: "",
      reference_name: "",
      reference_method: "",
      integration_id: "",
      node_icon_url: "",
      node_icon_lucide: "",
      node_icon_color: "",
      input_mappings: {},
      output_mappings: {},
      _ref_response_schema: undefined,
      custom_outputs: [],
    })
  }

  if (loading) {
    return (
      <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
        <div className="animate-pulse h-8 rounded" style={{ backgroundColor: "var(--theme-surface)" }} />
        <div className="animate-pulse h-8 rounded" style={{ backgroundColor: "var(--theme-surface)" }} />
      </div>
    )
  }

  // ─── Selected reference detail view ───
  if (selectedRef) {
    const Icon = typeIcons[selectedInteg?.type ?? "rest_api"] ?? Globe
    const reqConfig = selectedRef.request_config as any

    return (
      <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
        {/* Selected reference header */}
        <div
          className="rounded-lg p-2.5 flex items-center gap-2"
          style={{ backgroundColor: "var(--theme-primary-light)", border: "1.5px solid var(--theme-primary)" }}
        >
          <Icon size={14} style={{ color: "var(--theme-primary-text)" }} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: "var(--theme-primary-text)" }}>
              {selectedRef.name}
            </p>
            {selectedInteg && (
              <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
                {selectedInteg.name} · {selectedInteg.type.replace("_", " ")}
              </p>
            )}
          </div>
          <button onClick={clearReference} className="p-1 rounded hover:opacity-70" title="Change reference">
            <X size={12} style={{ color: "var(--theme-muted-text)" }} />
          </button>
        </div>

        {/* Request preview */}
        {reqConfig && (
          <div className="rounded-lg p-2 text-[10px] font-mono" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            <span className="font-bold" style={{ color: "var(--theme-primary-text)" }}>
              {reqConfig.method ?? "GET"}
            </span>{" "}
            {reqConfig.path_template ?? "/"}
          </div>
        )}

        {/* ─── INPUTS (non-body) ─── */}
        {(() => {
          const nonBodyInputs = refInputs.filter((inp: any) => (inp.location ?? 'query') !== 'body')
          const bodyInputs = refInputs.filter((inp: any) => inp.location === 'body')
          const bodyMode = config._body_mode ?? 'form'
          return (
            <>
              {nonBodyInputs.length > 0 && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-muted-text)" }}>
                    <ArrowRight size={10} />
                    Parameters
                    <span className="text-[9px] font-normal normal-case">({nonBodyInputs.length})</span>
                  </label>
                  <div className="space-y-2.5">
                    {nonBodyInputs.map((inp: any) => (
                      <InputField key={inp.id ?? inp.name} inp={inp} value={inputMappings[inp.name] ?? ""} onChange={updateInputMapping} onLocationChange={(loc) => {
                        const updated = refInputs.map((i: any) => (i.id ?? i.name) === (inp.id ?? inp.name) ? { ...i, location: loc } : i)
                        onUpdate('_ref_inputs_override', updated)
                      }} />
                    ))}
                  </div>
                </div>
              )}

              {/* ─── BODY ─── */}
              {(bodyInputs.length > 0 || (reqConfig?.method && reqConfig.method !== 'GET')) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>
                      <ArrowRight size={10} />
                      Body
                      {bodyInputs.length > 0 && <span className="text-[9px] font-normal normal-case">({bodyInputs.length} fields)</span>}
                    </label>
                    <div className="flex items-center rounded-lg overflow-hidden" style={{ border: '1px solid var(--theme-surface-border)' }}>
                      <button onClick={() => onUpdate('_body_mode', 'form')}
                        className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium"
                        style={{ backgroundColor: bodyMode === 'form' ? 'var(--theme-primary-light)' : 'transparent', color: bodyMode === 'form' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
                        <FormInput size={10} /> Form
                      </button>
                      <button onClick={() => onUpdate('_body_mode', 'json')}
                        className="flex items-center gap-1 px-2 py-1 text-[9px] font-medium"
                        style={{ backgroundColor: bodyMode === 'json' ? 'var(--theme-primary-light)' : 'transparent', color: bodyMode === 'json' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)', borderLeft: '1px solid var(--theme-surface-border)' }}>
                        <Code size={10} /> JSON
                      </button>
                    </div>
                  </div>

                  {bodyMode === 'form' ? (
                    bodyInputs.length === 0 ? (
                      <p className="text-[10px] rounded-lg px-2.5 py-2" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)" }}>
                        No body fields defined. Switch to JSON mode to write a custom body.
                      </p>
                    ) : (config._body_is_array || reqConfig?.body_template?.trim()?.startsWith('[')) ? (
                      <ArrayBodyForm
                        bodyInputs={bodyInputs}
                        rows={(() => { try { const r = config._body_rows; if (Array.isArray(r) && r.length > 0) return r } catch {} return [Object.fromEntries(bodyInputs.map((i: any) => [i.name, inputMappings[i.name] ?? '']))] })()}
                        onUpdateRows={(newRows) => {
                          const merged = { ...inputMappings }
                          if (newRows.length > 0) {
                            for (const inp of bodyInputs) merged[inp.name] = newRows[0][inp.name] ?? ''
                          }
                          const batch = onBatchUpdate ?? ((u: Record<string, any>) => { Object.entries(u).forEach(([k, v]) => onUpdate(k, v)) })
                          batch({ _body_rows: newRows, input_mappings: merged })
                        }}
                      />
                    ) : (
                      <div className="space-y-2.5">
                        {bodyInputs.map((inp: any) => (
                          <InputField key={inp.id ?? inp.name} inp={inp} value={inputMappings[inp.name] ?? ""} onChange={updateInputMapping} onLocationChange={(loc) => {
                            const updated = refInputs.map((i: any) => (i.id ?? i.name) === (inp.id ?? inp.name) ? { ...i, location: loc } : i)
                            onUpdate('_ref_inputs_override', updated)
                          }} />
                        ))}
                      </div>
                    )
                  ) : (
                    <div>
                      <textarea
                        value={config._custom_body ?? reqConfig?.body_template ?? ''}
                        onChange={(e) => onUpdate('_custom_body', e.target.value)}
                        rows={6}
                        placeholder='{"key": "{{variable}}", "items": [...]}'
                        className="w-full rounded-lg border px-3 py-2 text-[11px] font-mono"
                        style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
                      />
                      <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                        Use {'{{variable}}'} syntax for dynamic values
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Non-body inputs when no body inputs exist */}
              {nonBodyInputs.length === 0 && refInputs.length > 0 && bodyInputs.length === 0 && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-muted-text)" }}>
                    <ArrowRight size={10} />
                    Inputs
                    <span className="text-[9px] font-normal normal-case">({refInputs.length})</span>
                  </label>
                  <div className="space-y-2.5">
                    {refInputs.map((inp: any) => (
                      <InputField key={inp.id ?? inp.name} inp={inp} value={inputMappings[inp.name] ?? ""} onChange={updateInputMapping} onLocationChange={(loc) => {
                        const updated = refInputs.map((i: any) => (i.id ?? i.name) === (inp.id ?? inp.name) ? { ...i, location: loc } : i)
                        onUpdate('_ref_inputs_override', updated)
                      }} />
                    ))}
                  </div>
                </div>
              )}

              {refInputs.length === 0 && (
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-muted-text)" }}>
                    <ArrowRight size={10} /> Inputs
                  </label>
                  <p className="text-[10px] rounded-lg px-2.5 py-2" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)" }}>
                    No inputs required
                  </p>
                </div>
              )}
            </>
          )
        })()}

        {/* ─── OUTPUTS ─── */}
        <div>
          <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-muted-text)" }}>
            <ArrowDown size={10} />
            Outputs → Variables
            {refOutputs.length > 0 && (
              <span className="text-[9px] font-normal normal-case">({refOutputs.length})</span>
            )}
          </label>
          {refOutputs.length === 0 ? (
            <p className="text-[10px] rounded-lg px-2.5 py-2" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)" }}>
              No outputs defined. The full response is available as {'{{api_response}}'}.
            </p>
          ) : (
            <OutputVariableMapper
              outputs={refOutputs}
              outputMappings={config.output_mappings ?? {}}
              onUpdate={(mappings) => onUpdate("output_mappings", mappings)}
              suffix={suffix}
            />
          )}
        </div>

        {/* ─── Response model ─── */}
        <ResponseModelSection
          config={config}
          prefix={outputPrefix || 'step'}
          onUpdate={onUpdate}
        />

        {/* Always-available outputs note */}
        <div className="rounded-lg p-2 text-[9px]" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
          <p className="font-medium mb-0.5">Always available after execution:</p>
          <p><code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{'{{api_response}}'}</code> — full JSON response</p>
          <p><code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{'{{api_status}}'}</code> — HTTP status code</p>
        </div>
      </div>
    )
  }

  // ─── Reference picker view ───
  const q = search.toLowerCase()
  const filteredRefs = allReferences.filter((r) => {
    if (config.integration_id && r.integration_id !== config.integration_id) return false
    if (q) {
      const integ = integrations.find((i) => i.id === r.integration_id)
      const haystack = `${r.name} ${r.description ?? ""} ${integ?.name ?? ""} ${(r.request_config as any)?.method ?? ""} ${(r.request_config as any)?.path_template ?? ""}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
      {/* Search + filter row */}
      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: "var(--theme-muted-text)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search references..."
            className="w-full rounded-lg border pl-7 pr-2 py-1.5 text-[11px]"
            style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
          />
        </div>
        <select
          value={config.integration_id ?? ""}
          onChange={(e) => onUpdate("integration_id", e.target.value)}
          className="rounded-lg border px-1.5 py-1.5 text-[11px] max-w-[120px]"
          style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
        >
          <option value="">All</option>
          {integrations.map((integ) => (
            <option key={integ.id} value={integ.id}>{integ.name}</option>
          ))}
        </select>
      </div>

      {/* Compact reference list */}
      {filteredRefs.length === 0 ? (
        <p className="text-[10px] py-3 text-center rounded-lg" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)" }}>
          {allReferences.length === 0 ? "No references found. Create one in Integrations." : "No matches"}
        </p>
      ) : (
        <div className="space-y-0.5 max-h-60 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--theme-surface-border)" }}>
          {filteredRefs.map((ref) => {
            const integ = integrations.find((i) => i.id === ref.integration_id)
            const Icon = typeIcons[integ?.type ?? "rest_api"] ?? Globe
            const reqConfig = ref.request_config as any
            const method = reqConfig?.method ?? "GET"

            return (
              <button
                key={ref.id}
                type="button"
                onClick={() => { selectReference(ref); setSearch("") }}
                className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-[11px] transition-colors hover:opacity-80"
                style={{ borderBottom: "1px solid var(--theme-surface-border)" }}
              >
                <Icon size={11} className="shrink-0" style={{ color: "var(--theme-muted-text)" }} />
                <span className="font-medium truncate flex-1">{ref.name}</span>
                <span className="text-[9px] font-mono shrink-0 px-1 py-0.5 rounded" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-primary-text)" }}>
                  {method}
                </span>
                <span className="text-[9px] shrink-0" style={{ color: "var(--theme-muted-text)" }}>
                  {(ref.inputs as any[])?.length ?? 0}/{(ref.outputs as any[])?.length ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {filteredRefs.length > 0 && (
        <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
          {filteredRefs.length} reference{filteredRefs.length !== 1 ? "s" : ""} · click to select
        </p>
      )}
    </div>
  )
}

// ─── Output Variable Mapper ───

interface OutputMapping {
  enabled: boolean
  variableName: string
}

function OutputVariableMapper({
  outputs,
  outputMappings,
  onUpdate,
  suffix = '',
}: {
  outputs: any[]
  outputMappings: Record<string, OutputMapping>
  onUpdate: (mappings: Record<string, OutputMapping>) => void
  suffix?: string
}) {
  const defaultVarName = (name: string) => `ref_${name}${suffix ? '_' + suffix : ''}`

  function toggleOutput(outputName: string) {
    const current = outputMappings[outputName]
    const updated = { ...outputMappings }
    updated[outputName] = {
      enabled: !current?.enabled,
      variableName: current?.variableName || defaultVarName(outputName),
    }
    onUpdate(updated)
  }

  function updateVariableName(outputName: string, variableName: string) {
    const updated = { ...outputMappings }
    updated[outputName] = { ...updated[outputName], enabled: true, variableName }
    onUpdate(updated)
  }

  function autoMapAll() {
    const updated: Record<string, OutputMapping> = {}
    outputs.forEach((out: any) => {
      updated[out.name] = {
        enabled: true,
        variableName: outputMappings[out.name]?.variableName || defaultVarName(out.name),
      }
    })
    onUpdate(updated)
  }

  function clearAll() {
    const updated: Record<string, OutputMapping> = {}
    outputs.forEach((out: any) => {
      updated[out.name] = { enabled: false, variableName: defaultVarName(out.name) }
    })
    onUpdate(updated)
  }

  const enabledCount = outputs.filter((o: any) => outputMappings[o.name]?.enabled).length

  return (
    <div>
      <div className="flex items-center justify-end gap-1 mb-2">
        <button type="button" onClick={autoMapAll}
          className="text-[9px] font-medium px-2 py-0.5 rounded-full hover:opacity-80"
          style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
          Map all
        </button>
        {enabledCount > 0 && (
          <button type="button" onClick={clearAll}
            className="text-[9px] font-medium px-2 py-0.5 rounded-full hover:opacity-80"
            style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            Clear
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {outputs.filter((out: any) => !out.path?.startsWith("[].")).map((out: any) => {
          const mapping = outputMappings[out.name]
          const isEnabled = mapping?.enabled ?? false
          const varName = mapping?.variableName ?? defaultVarName(out.name)
          const isList = out.type === "array" || out.type === "list"
          const isObj = out.type === "object"
          // Find column descriptors for this list output
          const columnOutputs = isList ? outputs.filter((o: any) => o.path?.startsWith("[].")) : []

          return (
            <div
              key={out.id ?? out.name}
              className="rounded-lg p-2 transition-all"
              style={{
                backgroundColor: isEnabled ? "var(--theme-primary-light)" : "var(--theme-surface)",
                border: isEnabled ? "1.5px solid var(--theme-primary)" : "1px solid var(--theme-surface-border)",
              }}
            >
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => toggleOutput(out.name)}
                  className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors"
                  style={{
                    backgroundColor: isEnabled ? "var(--theme-primary)" : "var(--theme-card-bg)",
                    borderColor: isEnabled ? "var(--theme-primary)" : "var(--theme-surface-border)",
                  }}>
                  {isEnabled && <Check size={10} className="text-white" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <code className="text-[10px] font-mono font-medium" style={{ color: isEnabled ? "var(--theme-primary-text)" : "var(--theme-card-text)" }}>
                      {out.name}
                    </code>
                    {isList && (
                      <span className="text-[8px] px-1 py-0.5 rounded font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                        LIST
                      </span>
                    )}
                    {isObj && (
                      <span className="text-[8px] px-1 py-0.5 rounded font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        OBJECT
                      </span>
                    )}
                    {!isList && !isObj && (
                      <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>({out.type})</span>
                    )}
                  </div>
                  {out.path && (
                    <code className="text-[9px] font-mono" style={{ color: "var(--theme-muted-text)" }}>
                      ← {out.path}
                    </code>
                  )}
                </div>
              </div>

              {isEnabled && (
                <div className="mt-2 flex items-center gap-1">
                  <ArrowRight size={10} style={{ color: "var(--theme-muted-text)" }} />
                  <span className="text-[10px] font-mono" style={{ color: "var(--theme-muted-text)" }}>{`{{`}</span>
                  <input
                    value={varName}
                    onChange={(e) => updateVariableName(out.name, e.target.value)}
                    className="flex-1 text-[10px] font-mono px-1.5 py-0.5 rounded border outline-none"
                    style={{
                      borderColor: "var(--theme-surface-border)",
                      backgroundColor: "var(--theme-card-bg)",
                      color: "var(--theme-primary-text)",
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  <span className="text-[10px] font-mono" style={{ color: "var(--theme-muted-text)" }}>{`}}`}</span>
                </div>
              )}

              {isEnabled && isList && (
                <div className="mt-1.5 ml-5 space-y-1">
                  <p className="text-[8px] font-medium" style={{ color: "var(--theme-muted-text)" }}>
                    Use a <strong>Loop</strong> node with items={`{{${varName}}}`}
                  </p>
                  {columnOutputs.length > 0 && (
                    <div className="rounded p-1.5 space-y-0.5" style={{ backgroundColor: "var(--theme-surface)" }}>
                      <p className="text-[8px] font-semibold" style={{ color: "var(--theme-muted-text)" }}>
                        Available fields per item:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {columnOutputs.map((col: any) => (
                          <span key={col.name} className="text-[8px] font-mono px-1 py-0.5 rounded"
                            style={{ backgroundColor: "var(--theme-card-bg)", color: "var(--theme-primary-text)" }}>
                            {'{{'}item.{col.path.replace('[].', '')}{'}}'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {enabledCount > 0 && (
        <p className="text-[9px] mt-2" style={{ color: "var(--theme-primary-text)" }}>
          {enabledCount} variable{enabledCount !== 1 ? "s" : ""} mapped
        </p>
      )}
    </div>
  )
}

// ─── Array body form with repeating rows ───
function ArrayBodyForm({ bodyInputs, rows, onUpdateRows }: {
  bodyInputs: any[]
  rows: Record<string, string>[]
  onUpdateRows: (rows: Record<string, string>[]) => void
}) {
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation() }

  return (
    <div className="space-y-2" onPointerDown={stop} onMouseDown={stop}>
      {rows.map((row, rowIdx) => (
        <div key={rowIdx} className="rounded-lg p-2 space-y-1.5" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Item {rowIdx + 1}</span>
            {rows.length > 1 && (
              <button onClick={() => onUpdateRows(rows.filter((_, i) => i !== rowIdx))}
                className="p-0.5 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}><Trash2 size={10} /></button>
            )}
          </div>
          {bodyInputs.map((inp: any) => (
            <div key={inp.name}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[9px] font-mono font-medium" style={{ color: 'var(--theme-primary-text)' }}>{inp.name}</span>
                <span className="text-[8px]" style={{ color: 'var(--theme-muted-text)' }}>({inp.type})</span>
                {inp.required && <span className="text-[8px] font-medium text-red-400">required</span>}
              </div>
              <VariableInput value={row[inp.name] ?? ''} onChange={(v) => {
                const newRows = [...rows]
                newRows[rowIdx] = { ...newRows[rowIdx], [inp.name]: v }
                onUpdateRows(newRows)
              }} placeholder={inp.description || `Enter ${inp.name}`} />
            </div>
          ))}
        </div>
      ))}
      <button
        onClick={() => onUpdateRows([...rows, Object.fromEntries(bodyInputs.map((inp: any) => [inp.name, '']))])}
        className="flex items-center gap-1 text-[10px] px-2 py-1.5 rounded-lg w-full justify-center hover:opacity-80"
        style={{ color: 'var(--theme-primary-text)', backgroundColor: 'var(--theme-primary-light)' }}>
        <Plus size={12} /> Add item
      </button>
    </div>
  )
}

// ─── Reusable input field for non-array inputs ───
function InputField({ inp, value, onChange, onLocationChange }: {
  inp: any; value: string; onChange: (name: string, value: string) => void; onLocationChange: (loc: string) => void
}) {
  const isMissing = inp.required && !value.trim()
  const isVariableValue = value.includes('{{')
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[10px] font-mono font-medium" style={{ color: "var(--theme-primary-text)" }}>{inp.name}</span>
        <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>({inp.type})</span>
        <select value={inp.location ?? 'query'} onChange={(e) => onLocationChange(e.target.value)}
          className="text-[9px] px-1 py-0.5 rounded border-0"
          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
          <option value="query">Query</option>
          <option value="path">Path</option>
          <option value="header">Header</option>
          <option value="body">Body</option>
        </select>
        {inp.required && (
          <span className={`text-[9px] font-medium ${isMissing ? 'text-amber-500' : 'text-red-400'}`}>
            {isMissing ? '⚠ required' : 'required'}
          </span>
        )}
        {inp.source === "static" && (
          <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>static</span>
        )}
      </div>
      {inp.description && <p className="text-[9px] mb-1" style={{ color: "var(--theme-muted-text)" }}>{inp.description}</p>}
      <div style={isMissing ? { outline: '1.5px solid #F59E0B', borderRadius: '0.5rem' } : undefined}>
        <VariableInput value={value} onChange={(v) => onChange(inp.name, v)}
          placeholder={inp.source === "static" ? inp.default_value || "Static value" : `e.g. {{task.id}} or static value`} />
      </div>
      {!isVariableValue ? (
        <div className="mt-1.5">
          <ReferenceStaticValueInput
            input={inp}
            value={value}
            onChange={(nextValue) => onChange(inp.name, nextValue)}
            inputClassName="!h-8 !text-[11px] font-mono"
            selectClassName="w-full rounded-lg border px-3 py-2 text-[11px]"
            selectStyle={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
            checkboxLabel="Set static boolean value"
          />
        </div>
      ) : null}
    </div>
  )
}

/**
 * The reference's response model as a tree. "+" on a row adds a named
 * output on this node (custom_outputs: { name, path } relative to the
 * response); downstream steps can also pick any field directly.
 */
function ResponseModelSection({ config, prefix, onUpdate }: { config: Record<string, any>; prefix: string; onUpdate: (key: string, value: any) => void }) {
  const [open, setOpen] = useState(true)
  const model = normalizeResponseSchema(config._ref_response_schema)
  const customOutputs = (Array.isArray(config.custom_outputs) ? config.custom_outputs : []) as { name: string; path: string }[]
  const rootPath = `${prefix}_response`
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--theme-muted-text)" }}>
        <ChevronDown size={10} className={open ? '' : '-rotate-90'} />
        Response model
        <span className="text-[10px] font-normal normal-case ml-auto">{describeModel(model)}</span>
      </button>
      {open && (model ? (
        <div className="space-y-1.5">
          <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
            Later steps pick these values from the <span className="font-medium">Insert data</span> button on any field. Use + to also save one as a named output.
          </p>
          <ResponseModelTree
            schema={model}
            rootPath={rootPath}
            onAddOutput={(item, relativePath) => {
              const base = outputNameFor(item.path, rootPath)
              let name = base
              for (let i = 2; customOutputs.some((o) => o.name === name); i++) name = `${base}_${i}`
              onUpdate('custom_outputs', [...customOutputs, { name, path: relativePath }])
            }}
          />
        </div>
      ) : (
        <p className="text-[10px] rounded-lg px-2.5 py-2" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)" }}>
          No response model yet. Test the reference in Integrations to capture one — then its fields appear here and in the data picker.
        </p>
      ))}
      {customOutputs.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-[10px] font-medium" style={{ color: "var(--theme-muted-text)" }}>Outputs added from the model</p>
          {customOutputs.map((out, index) => (
            <div key={`${out.name}-${index}`} className="flex items-center gap-1.5 rounded border px-2 py-1" style={{ borderColor: "var(--theme-surface-border)" }}>
              <input
                value={out.name}
                aria-label="Output variable name"
                onChange={(e) => {
                  const next = [...customOutputs]
                  next[index] = { ...out, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') }
                  onUpdate('custom_outputs', next)
                }}
                className="w-28 rounded border px-1 py-0.5 font-mono text-[11px]"
                style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px]" style={{ color: "var(--theme-muted-text)" }}>= response{out.path ? `.${out.path}` : ''}</span>
              <button type="button" aria-label={`Remove ${out.name}`} onClick={() => onUpdate('custom_outputs', customOutputs.filter((_, i) => i !== index))} className="p-0.5 hover:opacity-70">
                <X size={11} style={{ color: "var(--theme-muted-text)" }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
