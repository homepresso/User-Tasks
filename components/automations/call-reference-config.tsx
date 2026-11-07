"use client"

import { customKindOf, isCustomReference, isWriteReference, KIND_INFO } from '@/lib/custom-references/types'
import { WritesDataBadge } from '@/components/integrations/writes-data-badge'
import { useState, useEffect } from "react"
import { serverRead } from "@/lib/server-read"
import { connectorBrandForTags } from "@/lib/connectors/connector-brand"
import { VariableInput } from "./variable-input"
import { Globe, Database, Zap, Network, ArrowRight, ArrowDown, ChevronDown, X, Plus, Trash2, Code, FormInput, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input, controlClass, CONTROL_HEIGHT } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Card } from "@/components/ui/card"
import { Badge, Tag } from "@/components/ui/badge"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"
import { ReferenceStaticValueInput } from "@/components/shared/reference-static-value-input"
import { referenceResponseSchema, stripSample, normalizeResponseSchema } from "@/lib/response-schema"
import { ResponseModelTree, describeModel, outputNameFor } from "./response-model-editor"
import { LoadSampleButton } from "@/components/integrations/response-collection-picker"
import type { ResponseSchema } from "@/lib/response-schema"

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
        <div className="h-8 animate-pulse rounded-md bg-subtle" />
        <div className="h-8 animate-pulse rounded-md bg-subtle" />
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
        <div className="flex items-center gap-2 rounded-lg bg-primary-wash p-2.5">
          <Icon size={14} className="shrink-0 text-primary-text" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-semibold text-primary-text">
              {selectedRef.name}
            </p>
            {selectedInteg && (
              <p className="text-xs text-fg-muted">
                {selectedInteg.name} · {selectedInteg.type.replace("_", " ")}
              </p>
            )}
            {isWriteReference(selectedRef) && (
              <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-fg-muted" data-testid="call-reference-writes">
                <WritesDataBadge /> {KIND_INFO[customKindOf(selectedRef) ?? "create"].label} — runs for real each time this step runs.
              </p>
            )}
          </div>
          <IconButton onClick={clearReference} label="Change reference" icon={<X />} size="sm" />
        </div>

        {/* Request preview */}
        {reqConfig && (
          <div className="rounded-md bg-subtle p-2 font-mono text-xs text-fg-muted">
            <span className="font-semibold text-primary-text">
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
                  <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <ArrowRight size={12} />
                    Parameters
                    <span className="num font-normal">({nonBodyInputs.length})</span>
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
                    <label className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                      <ArrowRight size={12} />
                      Body
                      {bodyInputs.length > 0 && <span className="num font-normal">({bodyInputs.length} fields)</span>}
                    </label>
                    <SegmentedControl
                      aria-label="Body mode"
                      size="sm"
                      value={String(bodyMode)}
                      onValueChange={(mode) => onUpdate('_body_mode', mode)}
                      options={[
                        { value: 'form', icon: <FormInput size={14} />, text: 'Form' },
                        { value: 'json', icon: <Code size={14} />, text: 'JSON' },
                      ]}
                    />
                  </div>

                  {bodyMode === 'form' ? (
                    bodyInputs.length === 0 ? (
                      <p className="text-xs text-fg-muted">
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
                      <Textarea
                        value={config._custom_body ?? reqConfig?.body_template ?? ''}
                        onChange={(e) => onUpdate('_custom_body', e.target.value)}
                        rows={6}
                        placeholder='{"key": "{{variable}}", "items": [...]}'
                        className="font-mono text-xs"
                      />
                      <p className="mt-1 text-xs text-fg-muted">
                        Use {'{{variable}}'} syntax for dynamic values
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Non-body inputs when no body inputs exist */}
              {nonBodyInputs.length === 0 && refInputs.length > 0 && bodyInputs.length === 0 && (
                <div>
                  <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <ArrowRight size={12} />
                    Inputs
                    <span className="num font-normal">({refInputs.length})</span>
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
                  <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                    <ArrowRight size={12} /> Inputs
                  </label>
                  <p className="text-xs text-fg-muted">
                    No inputs required
                  </p>
                </div>
              )}
            </>
          )
        })()}

        {/* ─── OUTPUTS ─── */}
        <div>
          <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <ArrowDown size={12} />
            Outputs → variables
            {refOutputs.length > 0 && (
              <span className="num font-normal">({refOutputs.length})</span>
            )}
          </label>
          {refOutputs.length === 0 ? (
            <p className="text-xs text-fg-muted">
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
          loadSample={(
            <LoadSampleButton
              referenceId={selectedRef.id}
              inputs={rawInputs}
              mappings={inputMappings}
              compact
              onLoaded={(loaded: ResponseSchema) => {
                // The reference's copy too, so the snapshot refresh above keeps the new model.
                setAllReferences((refs) => refs.map((r) => (r.id === selectedRef.id ? { ...r, request_config: { ...((r.request_config as any) ?? {}), response_schema: loaded } } : r)))
                onUpdate('_ref_response_schema', stripSample(loaded) ?? undefined)
              }}
            />
          )}
        />

        {/* Always-available outputs note */}
        <Card variant="inset" padding="sm" className="text-xs text-fg-muted">
          <p className="font-medium mb-0.5">Always available after execution:</p>
          <p><code className="font-mono text-primary-text">{'{{api_response}}'}</code> — full JSON response</p>
          <p><code className="font-mono text-primary-text">{'{{api_status}}'}</code> — HTTP status code</p>
        </Card>
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
        <Input
          size="sm"
          wrapperClassName="flex-1"
          leading={<Search />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search references..."
          aria-label="Search references"
        />
        <Select
          size="sm"
          wrapperClassName="w-auto max-w-[120px] shrink-0"
          value={config.integration_id ?? ""}
          onChange={(e) => onUpdate("integration_id", e.target.value)}
          aria-label="Integration"
        >
          <option value="">All</option>
          {integrations.map((integ) => (
            <option key={integ.id} value={integ.id}>{integ.name}</option>
          ))}
        </Select>
      </div>

      {/* Compact reference list */}
      {filteredRefs.length === 0 ? (
        <p className="py-3 text-center text-xs text-fg-muted">
          {allReferences.length === 0 ? "No references found. Create one in Integrations." : "No matches"}
        </p>
      ) : (
        <div className="max-h-60 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border">
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
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-fg transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle"
              >
                <Icon size={14} className="shrink-0 text-fg-muted" />
                <span className="font-medium truncate flex-1">{ref.name}</span>
                {isCustomReference(ref) && (
                  <Badge tone="brand" className="text-2xs" data-testid="custom-tag">
                    Custom
                  </Badge>
                )}
                {isWriteReference(ref) && <WritesDataBadge className="shrink-0" />}
                <Tag mono className="text-primary-text">
                  {method}
                </Tag>
                <span className="num shrink-0 text-2xs text-fg-muted">
                  {(ref.inputs as any[])?.length ?? 0}/{(ref.outputs as any[])?.length ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {filteredRefs.length > 0 && (
        <p className="text-xs text-fg-muted">
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
        {enabledCount > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            Clear
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={autoMapAll}>
          Map all
        </Button>
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
              className={cn(
                "rounded-md p-2 transition-colors duration-[var(--ds-dur-fast)]",
                isEnabled ? "bg-primary-wash" : "bg-subtle",
              )}
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={isEnabled}
                  onChange={() => toggleOutput(out.name)}
                  aria-label={`Map ${out.name}`}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <code className={cn("font-mono text-xs font-medium", isEnabled ? "text-primary-text" : "text-fg")}>
                      {out.name}
                    </code>
                    {isList && (
                      <Badge tone="info" className="text-2xs">
                        List
                      </Badge>
                    )}
                    {isObj && (
                      <Badge tone="neutral" className="text-2xs">
                        Object
                      </Badge>
                    )}
                    {!isList && !isObj && (
                      <span className="text-2xs text-fg-muted">({out.type})</span>
                    )}
                  </div>
                  {out.path && (
                    <code className="font-mono text-2xs text-fg-muted">
                      ← {out.path}
                    </code>
                  )}
                </div>
              </div>

              {isEnabled && (
                <div className="mt-2 flex items-center gap-1">
                  <ArrowRight size={12} className="shrink-0 text-fg-muted" />
                  <span className="font-mono text-xs text-fg-muted">{`{{`}</span>
                  <Input
                    size="sm"
                    value={varName}
                    onChange={(e) => updateVariableName(out.name, e.target.value)}
                    aria-label={`Variable name for ${out.name}`}
                    className="flex-1 font-mono text-xs text-primary-text"
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                  <span className="font-mono text-xs text-fg-muted">{`}}`}</span>
                </div>
              )}

              {isEnabled && isList && (
                <div className="mt-1.5 ml-5 space-y-1">
                  <p className="text-xs text-fg-muted">
                    Use a <strong className="font-semibold">Loop</strong> node with items={`{{${varName}}}`}
                  </p>
                  {columnOutputs.length > 0 && (
                    <div className="space-y-1 rounded-md bg-panel p-1.5">
                      <p className="text-xs font-medium text-fg-muted">
                        Available fields per item:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {columnOutputs.map((col: any) => (
                          <span key={col.name} className="rounded-sm bg-subtle px-1 py-0.5 font-mono text-2xs text-primary-text">
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
        <p className="num mt-2 text-xs text-primary-text">
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
        <Card key={rowIdx} variant="inset" padding="sm" className="space-y-1.5 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg-muted">Item {rowIdx + 1}</span>
            {rows.length > 1 && (
              <IconButton onClick={() => onUpdateRows(rows.filter((_, i) => i !== rowIdx))}
                label={`Remove item ${rowIdx + 1}`} icon={<Trash2 />} size="sm" />
            )}
          </div>
          {bodyInputs.map((inp: any) => (
            <div key={inp.name}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="font-mono text-xs font-medium text-primary-text">{inp.name}</span>
                <span className="text-2xs text-fg-muted">({inp.type})</span>
                {inp.required && <span className="text-2xs font-medium text-danger">required</span>}
              </div>
              <VariableInput value={row[inp.name] ?? ''} onChange={(v) => {
                const newRows = [...rows]
                newRows[rowIdx] = { ...newRows[rowIdx], [inp.name]: v }
                onUpdateRows(newRows)
              }} placeholder={inp.description || `Enter ${inp.name}`} />
            </div>
          ))}
        </Card>
      ))}
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        leadingIcon={<Plus />}
        onClick={() => onUpdateRows([...rows, Object.fromEntries(bodyInputs.map((inp: any) => [inp.name, '']))])}>
        Add item
      </Button>
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
        <span className="font-mono text-xs font-medium text-primary-text">{inp.name}</span>
        <span className="text-2xs text-fg-muted">({inp.type})</span>
        <Select value={inp.location ?? 'query'} onChange={(e) => onLocationChange(e.target.value)}
          size="sm"
          aria-label={`Where ${inp.name} is sent`}
          wrapperClassName="w-auto"
          className="h-6 pl-1.5 pr-6 text-2xs text-fg-muted">
          <option value="query">Query</option>
          <option value="path">Path</option>
          <option value="header">Header</option>
          <option value="body">Body</option>
        </Select>
        {inp.required && (
          <span className={cn('text-2xs font-medium', isMissing ? 'text-warning' : 'text-danger')}>
            {isMissing ? '⚠ required' : 'required'}
          </span>
        )}
        {inp.source === "static" && (
          <Tag className="text-2xs">static</Tag>
        )}
      </div>
      {inp.description && <p className="mb-1 text-xs text-fg-muted">{inp.description}</p>}
      <div className={isMissing ? 'rounded-md outline-solid outline-[1.5px] outline-warning' : undefined}>
        <VariableInput value={value} onChange={(v) => onChange(inp.name, v)}
          placeholder={inp.source === "static" ? inp.default_value || "Static value" : `e.g. {{task.id}} or static value`} />
      </div>
      {!isVariableValue ? (
        <div className="mt-1.5">
          <ReferenceStaticValueInput
            input={inp}
            value={value}
            onChange={(nextValue) => onChange(inp.name, nextValue)}
            inputClassName={cn(CONTROL_HEIGHT.sm, "font-mono text-xs")}
            selectClassName={cn(controlClass, CONTROL_HEIGHT.sm, "flex items-center gap-2 px-2.5 text-xs")}
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
function ResponseModelSection({ config, prefix, onUpdate, loadSample }: { config: Record<string, any>; prefix: string; onUpdate: (key: string, value: any) => void; loadSample?: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const model = normalizeResponseSchema(config._ref_response_schema)
  const customOutputs = (Array.isArray(config.custom_outputs) ? config.custom_outputs : []) as { name: string; path: string }[]
  const rootPath = `${prefix}_response`
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="mb-1.5 flex w-full items-center gap-1.5 text-xs font-medium text-fg-muted hover:text-fg">
        <ChevronDown size={12} className={open ? '' : '-rotate-90'} />
        Response model
        <span className="ml-auto font-normal">{describeModel(model)}</span>
      </button>
      {open && (model ? (
        <div className="space-y-1.5">
          <p className="text-xs text-fg-muted">
            Later steps pick these values from the <span className="font-medium">Insert data</span> button on any field (lists drill into their items, e.g. <code>contents[] › key</code>). Use + to also save one as a named output.
          </p>
          {loadSample}
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
        <Card variant="inset" padding="sm" className="space-y-1.5">
          <p className="text-xs text-fg-muted">
            No response model yet. Load a sample (one test call) to capture one — then its fields appear here and in the data picker.
          </p>
          {loadSample}
        </Card>
      ))}
      {customOutputs.length > 0 && (
        <div className="mt-2 space-y-1">
          <p className="text-xs font-medium text-fg-muted">Outputs added from the model</p>
          {customOutputs.map((out, index) => (
            <div key={`${out.name}-${index}`} className="flex items-center gap-1.5 rounded-md bg-subtle px-2 py-1">
              <Input
                size="sm"
                value={out.name}
                aria-label="Output variable name"
                onChange={(e) => {
                  const next = [...customOutputs]
                  next[index] = { ...out, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') }
                  onUpdate('custom_outputs', next)
                }}
                className="w-28 shrink-0 font-mono text-xs"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">= response{out.path ? `.${out.path}` : ''}</span>
              <IconButton type="button" label={`Remove ${out.name}`} icon={<X />} size="sm" onClick={() => onUpdate('custom_outputs', customOutputs.filter((_, i) => i !== index))} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
