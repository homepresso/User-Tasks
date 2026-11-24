"use client"

/**
 * Email template variables on a workflow step (Send Email, a User Task's
 * assignment notification): the variables the chosen template uses, as a
 * mapping table. The template's own variables get an input bound through the
 * usual data picker / expressions (auto-mapped to a same-named form field,
 * task value or workflow variable when there is one); built-in ones show as
 * "filled automatically"; run paths (`{{form.x}}`) as read from the run.
 * Unmapped = the old behaviour (a same-named run value). A preview renders
 * the email with the mapped sample values.
 *
 * The step keeps a snapshot of the template's variables (`_template_variables`
 * / `_notification_template_variables`) so validation and wiring checks work
 * without loading the template.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Eye, Wand2 } from "lucide-react"
import { serverRead } from "@/lib/server-read"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Tooltip } from "@/components/ui/tooltip"
import { VariableInput } from "./variable-input"
import { EmailPreviewFrame } from "@/components/email-templates/email-preview-frame"
import { autoMapVariables, mappingFilled, sampleValues, templateVariableSnapshot, type EmailTemplateVariable, type TemplateVariableSnapshot } from "@/lib/email-editor/variables"
import { renderEmailTemplate } from "@/lib/email-editor/render"
import { extractPreheader } from "@/lib/email-editor/preview"
import { getPublicConfig } from "@/lib/config/public"

export interface EmailTemplateMappingProps {
  templateId: string
  /** The step's snapshot of the template's variables. */
  snapshot: TemplateVariableSnapshot[] | undefined
  mappings: Record<string, string> | undefined
  /** One batched update (mappings and/or snapshot). */
  onChange(update: { mappings?: Record<string, string>; snapshot?: TemplateVariableSnapshot[] }): void
  /** Data paths available to this step, in the designer's preferred order (auto-mapping). */
  candidates: string[]
  extraVariables?: { name: string; group: string }[]
  noun?: string
}

const sameSnapshot = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Preview value for a mapped variable: literal text as is, an expression as its sample (or the expression). */
export function previewValueFor(variable: { name: string; label: string; sample?: string }, mapping: string | undefined): string {
  const m = (mapping ?? '').trim()
  if (m && !m.includes('{{')) return m
  if (variable.sample !== undefined && variable.sample !== '') return variable.sample
  return m ? `[${m.replace(/^\{\{|\}\}$/g, '')}]` : `[${variable.label}]`
}

export function EmailTemplateMapping({ templateId, snapshot, mappings, onChange, candidates, extraVariables, noun = 'Template' }: EmailTemplateMappingProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['workflow-email-template-variables', templateId],
    queryFn: async () => {
      const result = await serverRead('automations.emailTemplateVariables', { templateId })
      if (result.error) throw new Error(result.error.message)
      return result.data as { id: string; name: string; subject: string; html_body: string; text_body: string; variables: EmailTemplateVariable[] }
    },
    staleTime: 30_000,
  })
  const map = useMemo(() => mappings ?? {}, [mappings])

  // Keep the snapshot current; auto-map variables that are new to it.
  const latest = useRef({ snapshot, map, candidates, onChange })
  useEffect(() => { latest.current = { snapshot, map, candidates, onChange } })
  useEffect(() => {
    if (!data) return
    const next = templateVariableSnapshot(data.variables)
    const { snapshot: prev, map: currentMap, candidates: paths, onChange: emit } = latest.current
    if (sameSnapshot(prev, next)) return
    const known = new Set((prev ?? []).map((v) => v.name))
    const auto = autoMapVariables(next.filter((v) => !known.has(v.name)), paths, currentMap)
    emit({ snapshot: next, ...(Object.keys(auto).length ? { mappings: { ...currentMap, ...auto } } : {}) })
  }, [data])

  const variables = data ? templateVariableSnapshot(data.variables) : snapshot ?? []
  const custom = variables.filter((v) => v.source === 'custom')
  const auto = variables.filter((v) => v.source === 'auto')
  const run = variables.filter((v) => v.source === 'run')
  const unmapped = custom.filter((v) => !mappingFilled(map[v.name]))
  const suggestions = autoMapVariables(custom, candidates, map)

  const setMapping = (name: string, value: string) => {
    const next = { ...map }
    if (value.trim()) next[name] = value
    else delete next[name]
    onChange({ mappings: next })
  }

  const preview = useMemo(() => {
    if (!data || !previewOpen) return null
    const appUrl = (getPublicConfig().appUrl || '').trim().replace(/\/+$/, '') || 'https://app.example.com'
    const values = sampleValues(data.variables, {}, appUrl)
    for (const v of templateVariableSnapshot(data.variables)) if (v.source === 'custom') values[v.name] = previewValueFor(v, map[v.name])
    return renderEmailTemplate(data, { variables: values })
  }, [data, map, previewOpen])

  if (error) return <p className="text-xs text-danger">Could not load the template&apos;s variables: {(error as Error).message}</p>

  return (
    <div className="space-y-2 rounded-lg border border-border-subtle p-2.5" data-template-mapping="">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs font-medium text-fg">{noun} variables</p>
        {Object.keys(suggestions).length > 0 && (
          <Tooltip content="Map the remaining variables to same-named form fields, task values or workflow variables">
            <Button type="button" size="sm" variant="ghost" leadingIcon={<Wand2 />} onClick={() => onChange({ mappings: { ...map, ...suggestions } })}>Auto-map</Button>
          </Tooltip>
        )}
        <Button type="button" size="sm" variant="ghost" leadingIcon={<Eye />} disabled={!data} onClick={() => setPreviewOpen(true)}>Preview</Button>
      </div>
      {isLoading && !snapshot && <p className="text-xs text-fg-muted">Loading variables…</p>}
      {custom.length === 0 && !isLoading && <p className="text-xs text-fg-muted">This template has no variables to map — everything it uses is filled automatically.</p>}
      {custom.length > 0 && (
        <div className="space-y-2" role="table" aria-label={`${noun} variable mappings`}>
          {custom.map((v) => {
            const filled = mappingFilled(map[v.name])
            return (
              <div key={v.name} role="row" className="space-y-1" data-template-variable={v.name}>
                <div className="flex items-center gap-1.5" role="rowheader">
                  <span className="text-xs font-medium text-fg">{v.label}</span>
                  <code className="text-2xs text-fg-muted">{`{{${v.name}}}`}</code>
                  {v.required && <Badge tone={filled ? 'neutral' : 'danger'}>required</Badge>}
                  {!filled && !v.required && (
                    <Tooltip content={`Not mapped: the email reads {{${v.name}}} from the run if it is set there, otherwise it is blank`}>
                      <AlertTriangle size={12} className="text-warning" aria-label="Not mapped" />
                    </Tooltip>
                  )}
                </div>
                <div role="cell">
                  <VariableInput value={map[v.name] ?? ''} onChange={(value) => setMapping(v.name, value)} placeholder={v.sample ? `e.g. ${v.sample}` : 'A value or {{expression}}'} extraVariables={extraVariables} />
                </div>
                {v.description && <p className="text-2xs text-fg-muted">{v.description}</p>}
              </div>
            )
          })}
        </div>
      )}
      {unmapped.length > 0 && (
        <p className="text-2xs text-fg-muted">{unmapped.length} unmapped — {unmapped.length === 1 ? 'it reads' : 'they read'} a same-named run value as before (blank if there is none).</p>
      )}
      {(auto.length > 0 || run.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle pt-2" data-template-auto-variables="">
          <span className="text-2xs text-fg-muted">Filled automatically:</span>
          {auto.map((v) => <Tooltip key={v.name} content={v.description ?? v.name}><span><Badge tone="neutral">{v.label}</Badge></span></Tooltip>)}
          {run.map((v) => <Tooltip key={v.name} content={`Read from the run: {{${v.name}}}`}><span><Badge tone="info">{v.name}</Badge></span></Tooltip>)}
        </div>
      )}
      {previewOpen && preview && (
        <Dialog open onOpenChange={setPreviewOpen}>
          <DialogContent size="xl" title={`Preview: ${data?.name ?? 'email'}`} description="Mapped values are shown as their samples; literal text as written." className="h-[85vh]">
            <EmailPreviewFrame className="mt-3 min-h-0 flex-1 border-t border-border-subtle" html={preview.html} subject={preview.subject} preheader={extractPreheader(preview.html)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
