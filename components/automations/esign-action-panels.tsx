"use client"

/**
 * Designer settings for the e-signature steps (lib/esign): Send for
 * Signature, Wait for Signature, E-signature Envelope and the E-signature
 * Event trigger. Config keys match lib/esign/handlers.ts; providers and
 * capabilities come from lib/esign/catalog.ts; docs at
 * /docs/integrations/e-signature.
 */

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Copy, Plus, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card } from "@/components/ui/card"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Select as UiSelect } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { serverRead } from "@/lib/server-read"
import { VariableInput } from "./variable-input"
import {
  DOWNLOAD_KINDS, ENVELOPE_ACTIONS, ESIGN_EVENTS, esignProviderForConnector, esignWebhookPath, type EsignProviderInfo,
} from "@/lib/esign/catalog"

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

interface PanelProps {
  type: string
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables?: { name: string; group: string; label?: string }[]
}

const linkClass = "text-primary-text underline"
const DOCS = "/docs/integrations/e-signature"

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-fg">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-fg-muted">{children}</p>
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: ReadonlyArray<readonly [string, string]>; label: string }) {
  return (
    <UiSelect size="sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="text-xs">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </UiSelect>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} label={label} className="text-xs" />
}

function Segmented({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; label: string }) {
  return (
    <div className="flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn(
            "flex-1 min-w-[3rem] rounded-[calc(var(--ds-radius-sm)-2px)] px-1 py-1 text-xs font-medium transition-[color,background-color,box-shadow] duration-[var(--ds-dur-fast)]",
            value === v ? "bg-panel text-fg shadow-elev-1" : "text-fg-muted hover:text-fg",
          )}>
          {l}
        </button>
      ))}
    </div>
  )
}

function Section({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="rounded-lg border border-border px-2 py-1.5" open={open}>
      <summary className="cursor-pointer select-none text-xs font-medium text-fg-muted hover:text-fg">{title}</summary>
      <div className="space-y-2 pt-2">{children}</div>
    </details>
  )
}

function NumberField({ config, onUpdate, field, placeholder, label, min = 0, max }: { config: Record<string, any>; onUpdate: (k: string, v: any) => void; field: string; placeholder: string; label: string; min?: number; max?: number }) {
  return (
    <Input type="number" min={min} max={max} value={config[field] ?? ""} aria-label={label}
      onChange={(e) => onUpdate(field, e.target.value === "" ? "" : Number(e.target.value))} placeholder={placeholder} size="sm" className="text-xs" />
  )
}

/* ── Integrations ─────────────────────────────────────────────────── */

interface EsignIntegration { id: string; name: string; type: string; is_active: boolean; provider: EsignProviderInfo }

export function useEsignIntegrations() {
  return useQuery({
    queryKey: ["esign-integrations"],
    queryFn: async () => {
      const data = (await serverRead("automations.referencePicker")).data as { integrations?: Array<{ id: string; name: string; type: string; is_active: boolean }> } | null
      return (data?.integrations ?? []).flatMap((i) => {
        const provider = esignProviderForConnector(i.type)
        return provider ? [{ ...i, provider }] : []
      }) as EsignIntegration[]
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

function IntegrationPicker({ config, onBatchUpdate, allowAny }: { config: Record<string, any>; onBatchUpdate: (u: Record<string, any>) => void; allowAny?: boolean }) {
  const { data: integrations = [], isLoading } = useEsignIntegrations()
  const value = String(config.integration_id ?? "")
  return (
    <div className="space-y-1">
      <Label>E-signature connection</Label>
      <UiSelect size="sm" aria-label="E-signature connection" value={value} className="text-xs"
        onChange={(e) => {
          const hit = integrations.find((i) => i.id === e.target.value)
          onBatchUpdate({ integration_id: e.target.value, provider_label: hit?.provider.label ?? "", template_id: config.template_id, template_name: config.template_name })
        }}>
        <option value="">{allowAny ? "Any e-signature connection" : isLoading ? "Loading…" : "Choose a connection…"}</option>
        {integrations.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.provider.label}){i.is_active ? "" : " — inactive"}</option>)}
      </UiSelect>
      {!isLoading && integrations.length === 0 && (
        <Hint>No e-signature connection yet. Add DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow or BoldSign in <a href="/connectors" className={linkClass}>Connectors</a>.</Hint>
      )}
    </div>
  )
}

function useSelectedProvider(config: Record<string, any>): EsignProviderInfo | null {
  const { data: integrations = [] } = useEsignIntegrations()
  return integrations.find((i) => i.id === config.integration_id)?.provider ?? null
}

/* ── Template picker ──────────────────────────────────────────────── */

interface TemplateRow { id: string; name: string; description: string | null; roles: string[]; updated_at: string | null }

export function TemplatePicker({ integrationId, value, onSelect }: { integrationId: string; value: string; onSelect: (t: TemplateRow) => void }) {
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const { data, isFetching } = useQuery({
    queryKey: ["esign-templates", integrationId, debounced],
    enabled: Boolean(integrationId),
    queryFn: async () => (await serverRead("automations.esignTemplates", { integration_id: integrationId, search: debounced || undefined })).data as { ok: boolean; error?: string; templates: TemplateRow[] } | null,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  if (!integrationId) return <Hint>Choose a connection to browse its templates.</Hint>
  const templates = data?.templates ?? []
  return (
    <div className="space-y-1" data-testid="esign-template-picker">
      <Input size="sm" leading={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates…" aria-label="Search templates" className="text-xs" />
      <div role="listbox" aria-label="Templates" className="max-h-44 overflow-y-auto rounded-lg border border-border">
        {isFetching && !templates.length && <p className="px-2 py-1.5 text-xs text-fg-muted">Loading templates…</p>}
        {data && !data.ok && <p className="px-2 py-1.5 text-xs text-danger">{data.error}</p>}
        {data?.ok && !templates.length && !isFetching && <p className="px-2 py-1.5 text-xs text-fg-muted">No templates{debounced ? ` match "${debounced}"` : ""}.</p>}
        {templates.map((t) => (
          <button key={t.id} type="button" role="option" aria-selected={value === t.id} onClick={() => onSelect(t)}
            className={cn(
              "block w-full border-b border-border-subtle px-2 py-1.5 text-left text-xs text-fg transition-colors last:border-b-0",
              value === t.id ? "bg-primary-wash" : "hover:bg-subtle",
            )}>
            <span className="font-medium">{t.name}</span>
            {t.roles.length > 0 && <span className="block text-xs text-fg-muted">Roles: {t.roles.join(", ")}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Recipients ───────────────────────────────────────────────────── */

interface RecipientRow { name?: string; email?: string; role?: string; routing_order?: number | string; kind?: string; anchor?: string }

function RecipientsEditor({ config, onUpdate, extraVariables, provider, roles }: { config: Record<string, any>; onUpdate: (k: string, v: any) => void; extraVariables?: PanelProps["extraVariables"]; provider: EsignProviderInfo | null; roles: string[] }) {
  const rows: RecipientRow[] = Array.isArray(config.recipients) ? config.recipients : []
  const set = (next: RecipientRow[]) => onUpdate("recipients", next)
  const patch = (i: number, p: Partial<RecipientRow>) => set(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <Card key={i} variant="inset" padding="sm" className="space-y-1.5" data-testid="esign-recipient">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-fg-muted">Recipient {i + 1}</span>
            <IconButton type="button" size="sm" label={`Remove recipient ${i + 1}`} icon={<X />} onClick={() => set(rows.filter((_, j) => j !== i))} className="-my-1" />
          </div>
          <VariableInput value={r.name ?? ""} onChange={(v) => patch(i, { name: v })} placeholder="Name, e.g. {{form.name}}" extraVariables={extraVariables} />
          <VariableInput value={r.email ?? ""} onChange={(v) => patch(i, { email: v })} placeholder="Email, e.g. {{form.email}}" extraVariables={extraVariables} />
          <div className="grid grid-cols-3 gap-1">
            {roles.length > 0 ? (
              <UiSelect size="sm" aria-label={`Role of recipient ${i + 1}`} value={r.role ?? ""} onChange={(e) => patch(i, { role: e.target.value })} className="text-xs">
                <option value="">Role…</option>
                {roles.map((role) => <option key={role} value={role}>{role}</option>)}
              </UiSelect>
            ) : (
              <Input value={r.role ?? ""} onChange={(e) => patch(i, { role: e.target.value })} placeholder="Role" aria-label={`Role of recipient ${i + 1}`} size="sm" className="text-xs" />
            )}
            <Input type="number" min={1} value={r.routing_order ?? ""} onChange={(e) => patch(i, { routing_order: e.target.value === "" ? "" : Number(e.target.value) })} placeholder="Order" aria-label={`Signing order of recipient ${i + 1}`} size="sm" className="text-xs" />
            <UiSelect size="sm" aria-label={`Type of recipient ${i + 1}`} value={r.kind ?? "signer"} onChange={(e) => patch(i, { kind: e.target.value })} className="text-xs">
              <option value="signer">Signer</option>
              <option value="cc">Copy (CC)</option>
            </UiSelect>
          </div>
          {(!provider || provider.supports.anchors) && (r.kind ?? "signer") !== "cc" && config.source !== "template" && (
            <Input value={r.anchor ?? ""} onChange={(e) => patch(i, { anchor: e.target.value })} placeholder="Signature anchor text, e.g. /sn1/" aria-label={`Signature anchor of recipient ${i + 1}`} size="sm" className="text-xs" />
          )}
        </Card>
      ))}
      <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus />} onClick={() => set([...rows, { kind: "signer", routing_order: rows.length + 1 }])}>
        Add recipient
      </Button>
      <div className="space-y-1">
        <Label>Recipients from a variable (optional)</Label>
        <VariableInput value={config.recipients_expr ?? ""} onChange={(v) => onUpdate("recipients_expr", v)} placeholder="{{signers}} — a list of { name, email, role }" extraVariables={extraVariables} />
      </div>
    </div>
  )
}

function KeyValueRows({ rows, onChange, keyPlaceholder, valuePlaceholder, extraVariables }: { rows: Array<{ key?: string; value?: string }>; onChange: (rows: Array<{ key?: string; value?: string }>) => void; keyPlaceholder: string; valuePlaceholder: string; extraVariables?: PanelProps["extraVariables"] }) {
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-1">
          <Input value={r.key ?? ""} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} placeholder={keyPlaceholder} aria-label="Field name" size="sm" className="w-2/5 text-xs" />
          <div className="flex-1"><VariableInput value={r.value ?? ""} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, value: v } : x)))} placeholder={valuePlaceholder} extraVariables={extraVariables} /></div>
          <IconButton type="button" size="sm" label="Remove field" icon={<X />} onClick={() => onChange(rows.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus />} onClick={() => onChange([...rows, { key: "", value: "" }])}>
        Add field
      </Button>
    </div>
  )
}

function OutputVar({ config, onUpdate, fallback }: { config: Record<string, any>; onUpdate: (k: string, v: any) => void; fallback: string }) {
  return (
    <div className="space-y-1">
      <Label>Output variable</Label>
      <Input value={config.output_var ?? ""} onChange={(e) => onUpdate("output_var", e.target.value.replace(/[^\w]/g, "_"))} placeholder={fallback} aria-label="Output variable" size="sm" className="font-mono text-xs" />
    </div>
  )
}

/* ── Send for Signature ───────────────────────────────────────────── */

function SendPanel({ config, onUpdate, onBatchUpdate, extraVariables }: PanelProps) {
  const provider = useSelectedProvider(config)
  const source = config.source === "template" ? "template" : "documents"
  const roles: string[] = Array.isArray(config.template_roles) ? config.template_roles : []
  return (
    <div className="space-y-3">
      <IntegrationPicker config={config} onBatchUpdate={onBatchUpdate} />
      <div className="space-y-1">
        <Label>Send</Label>
        <Segmented label="Source" value={source} onChange={(v) => onUpdate("source", v)} options={[["documents", "Documents"], ["template", "Provider template"]]} />
      </div>
      {source === "documents" ? (
        <div className="space-y-1">
          <Label>Documents</Label>
          <VariableInput value={config.documents ?? ""} onChange={(v) => onUpdate("documents", v)} placeholder="{{form.contract}} or {{contract_pdf}}" extraVariables={extraVariables} />
          <Hint>Form attachments, files from earlier steps (Word / PDF generation), storage references or URLs — one or a list.{provider && !provider.supports.multipleDocuments ? ` ${provider.label} takes one file: PDFs are merged.` : ""}</Hint>
        </div>
      ) : (
        <div className="space-y-1">
          <Label>Template</Label>
          <TemplatePicker integrationId={String(config.integration_id ?? "")} value={String(config.template_id ?? "")}
            onSelect={(t) => onBatchUpdate({ template_id: t.id, template_name: t.name, template_roles: t.roles })} />
          <Input value={config.template_id ?? ""} onChange={(e) => onUpdate("template_id", e.target.value)} placeholder="Template ID" aria-label="Template ID" size="sm" className="font-mono text-xs" />
          {config.template_name && <Hint>Selected: {config.template_name}</Hint>}
        </div>
      )}
      <div className="space-y-1">
        <Label>Recipients</Label>
        <RecipientsEditor config={config} onUpdate={onUpdate} extraVariables={extraVariables} provider={provider} roles={roles} />
        {source === "template" && <Hint>Each recipient fills the template role named in Role.</Hint>}
        {source === "documents" && provider?.supports.anchors && <Hint>Anchor text (e.g. /sn1/ in white text) places the signature field; without one the signer places it.</Hint>}
      </div>
      <div className="space-y-1">
        <Label>Email subject</Label>
        <VariableInput value={config.subject ?? ""} onChange={(v) => onUpdate("subject", v)} placeholder="Please sign: {{form.title}}" extraVariables={extraVariables} />
      </div>
      <div className="space-y-1">
        <Label>Message (optional)</Label>
        <VariableInput value={config.message ?? ""} onChange={(v) => onUpdate("message", v)} placeholder="Hi {{form.name}}, please review and sign." multiline rows={2} extraVariables={extraVariables} />
      </div>
      {source === "template" && (
        <Section title="Prefill template fields">
          <KeyValueRows rows={Array.isArray(config.prefill) ? config.prefill : []} onChange={(rows) => onUpdate("prefill", rows)} keyPlaceholder="Field / tab name" valuePlaceholder="{{value}}" extraVariables={extraVariables} />
        </Section>
      )}
      <Section title="Reminders, expiry and signing">
        {(!provider || provider.supports.reminders) && (
          <div className="space-y-1"><Label>Remind every (days)</Label><NumberField config={config} onUpdate={onUpdate} field="reminder_days" placeholder="Off" label="Remind every days" min={1} max={30} /></div>
        )}
        {(!provider || provider.supports.expiry) && (
          <div className="space-y-1"><Label>Expires after (days)</Label><NumberField config={config} onUpdate={onUpdate} field="expires_in_days" placeholder="Provider default" label="Expires after days" min={1} max={365} /></div>
        )}
        {(!provider || provider.supports.embeddedSigning) && (
          <Toggle checked={Boolean(config.embedded)} onChange={(v) => onUpdate("embedded", v)} label="Embedded signing (sign through a link in a task or form)" />
        )}
        {source === "documents" && (!provider || provider.supports.textTags) && (
          <Toggle checked={config.use_text_tags !== false} onChange={(v) => onUpdate("use_text_tags", v)} label="Documents contain text tags" />
        )}
        {provider?.supports.testMode && (
          <div className="space-y-1">
            <Label>Test mode</Label>
            <Select label="Test mode" value={String(config.test_mode ?? "default")} onChange={(v) => onUpdate("test_mode", v === "default" ? "" : v === "true")} options={[["default", "Connection default"], ["true", "On (not binding)"], ["false", "Off"]]} />
          </div>
        )}
      </Section>
      <Section title="Advanced">
        <div className="space-y-1">
          <Label>Client reference (idempotency key)</Label>
          <VariableInput value={config.client_reference ?? ""} onChange={(v) => onUpdate("client_reference", v)} placeholder="Default: derived from the run and step" extraVariables={extraVariables} />
          <Hint>A retry with the same reference returns the envelope already sent instead of sending a second one.</Hint>
        </div>
        <div className="space-y-1">
          <Label>{provider?.label ?? "Provider"} request fields (JSON)</Label>
          <VariableInput value={config.advanced ?? ""} onChange={(v) => onUpdate("advanced", v)} placeholder={'{ "brandId": "…" }'} multiline rows={3} extraVariables={extraVariables} />
          <Hint>Merged into the provider request — see the provider&apos;s API reference.</Hint>
        </div>
      </Section>
      <OutputVar config={config} onUpdate={onUpdate} fallback="envelope" />
      <Hint>Then add <strong>Wait for Signature</strong> with Envelope ID <code>{"{{"}{config.output_var || "envelope"}.envelope_id{"}}"}</code>. <a href={DOCS} className={linkClass}>E-signature docs</a></Hint>
    </div>
  )
}

/* ── Wait for Signature ───────────────────────────────────────────── */

function WaitPanel({ config, onUpdate, onBatchUpdate, extraVariables }: PanelProps) {
  const provider = useSelectedProvider(config)
  return (
    <div className="space-y-3">
      <IntegrationPicker config={config} onBatchUpdate={onBatchUpdate} />
      <div className="space-y-1">
        <Label>Envelope ID</Label>
        <VariableInput value={config.envelope_id ?? ""} onChange={(v) => onUpdate("envelope_id", v)} placeholder="{{envelope.envelope_id}}" extraVariables={extraVariables} />
      </div>
      <div className="space-y-1">
        <Label>Give up after (days)</Label>
        <NumberField config={config} onUpdate={onUpdate} field="timeout_days" placeholder="30" label="Timeout days" min={1} max={365} />
      </div>
      <Toggle checked={config.download !== false} onChange={(v) => onUpdate("download", v)} label="Store the signed document when completed" />
      {config.download !== false && (
        <>
          <Select label="Document to store" value={String(config.document ?? "combined")} onChange={(v) => onUpdate("document", v)} options={DOWNLOAD_KINDS.map((k) => [k.value, k.label] as const)} />
          {provider && !provider.supports.certificate && config.document !== "combined" && <Hint>{provider.label} has no separate certificate: the signed PDF includes the audit trail.</Hint>}
          <Input value={config.file_name ?? ""} onChange={(e) => onUpdate("file_name", e.target.value)} placeholder="File name (optional)" aria-label="File name" size="sm" className="text-xs" />
        </>
      )}
      <Section title="Polling">
        <div className="space-y-1"><Label>Check every (minutes)</Label><NumberField config={config} onUpdate={onUpdate} field="poll_minutes" placeholder="5" label="Poll minutes" min={1} max={1440} /></div>
        <Hint>Without webhooks the envelope is checked on this schedule; with the connection&apos;s webhook configured the run resumes within seconds and polling becomes a 30-minute safety net.</Hint>
      </Section>
      <OutputVar config={config} onUpdate={onUpdate} fallback="signature" />
      <Hint>Label outgoing connections <strong>Completed</strong>, <strong>Declined</strong>, <strong>Voided</strong>, <strong>Expired</strong> or <strong>Timeout</strong> to branch on the outcome; unlabelled connections always run. The signed PDF is <code>{"{{"}{config.output_var || "signature"}.signed_document{"}}"}</code>.</Hint>
    </div>
  )
}

/* ── Envelope actions ─────────────────────────────────────────────── */

function EnvelopePanel({ config, onUpdate, onBatchUpdate, extraVariables }: PanelProps) {
  const action = String(config.action ?? "status")
  const provider = useSelectedProvider(config)
  return (
    <div className="space-y-3">
      <IntegrationPicker config={config} onBatchUpdate={onBatchUpdate} />
      <div className="space-y-1">
        <Label>Action</Label>
        <Select label="Action" value={action} onChange={(v) => onUpdate("action", v)} options={ENVELOPE_ACTIONS.map((a) => [a.value, a.label] as const)} />
      </div>
      {action !== "list_templates" && (
        <div className="space-y-1">
          <Label>Envelope ID</Label>
          <VariableInput value={config.envelope_id ?? ""} onChange={(v) => onUpdate("envelope_id", v)} placeholder="{{envelope.envelope_id}}" extraVariables={extraVariables} />
        </div>
      )}
      {action === "download" && (
        <>
          <Select label="Document" value={String(config.document ?? "combined")} onChange={(v) => onUpdate("document", v)} options={DOWNLOAD_KINDS.map((k) => [k.value, k.label] as const)} />
          <Input value={config.file_name ?? ""} onChange={(e) => onUpdate("file_name", e.target.value)} placeholder="File name (optional)" aria-label="File name" size="sm" className="text-xs" />
        </>
      )}
      {action === "cancel" && (
        <div className="space-y-1">
          <Label>Reason</Label>
          <VariableInput value={config.reason ?? ""} onChange={(v) => onUpdate("reason", v)} placeholder="Cancelled: {{reason}}" extraVariables={extraVariables} />
        </div>
      )}
      {action === "signing_url" && (
        <>
          <VariableInput value={config.recipient_email ?? ""} onChange={(v) => onUpdate("recipient_email", v)} placeholder="Signer email" extraVariables={extraVariables} />
          <VariableInput value={config.return_url ?? ""} onChange={(v) => onUpdate("return_url", v)} placeholder="Return URL after signing (optional)" extraVariables={extraVariables} />
          <Hint>Send the envelope with Embedded signing on, then show <code>{"{{"}{config.output_var || "esign_result"}.url{"}}"}</code> as a &quot;Sign now&quot; link in a User Task.{provider?.id === "docusign" ? " DocuSign links are valid for 5 minutes and one use — create them right before showing them." : ""}</Hint>
        </>
      )}
      {action === "list_templates" && (
        <Input value={config.search ?? ""} onChange={(e) => onUpdate("search", e.target.value)} placeholder="Name contains (optional)" aria-label="Search" size="sm" className="text-xs" />
      )}
      <OutputVar config={config} onUpdate={onUpdate} fallback="esign_result" />
    </div>
  )
}

/* ── E-signature Event trigger ────────────────────────────────────── */

export function EsignEventTriggerConfig({ config, onUpdate, onBatchUpdate }: PanelProps) {
  const { data: integrations = [] } = useEsignIntegrations()
  const selected = integrations.find((i) => i.id === config.integration_id) ?? null
  const events: string[] = Array.isArray(config.events) ? config.events : []
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  const webhooks = useMemo(() => (selected ? [selected] : integrations).map((i) => ({ name: i.name, url: `${origin}${esignWebhookPath(i.provider.id, i.id)}${i.provider.id === "adobe_sign" ? "?token=<webhook secret>" : ""}` })), [selected, integrations, origin])
  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <IntegrationPicker config={config} onBatchUpdate={onBatchUpdate} allowAny />
      <div className="space-y-1">
        <Label>Events</Label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Events">
          {ESIGN_EVENTS.map((e) => {
            const on = events.includes(e.value)
            return (
              <button key={e.value} type="button" aria-pressed={on} onClick={() => onUpdate("events", on ? events.filter((x) => x !== e.value) : [...events, e.value])}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
                  on ? "border-primary bg-primary text-primary-fg" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}>
                {e.label}
              </button>
            )
          })}
        </div>
        <Hint>None selected = every event.</Hint>
      </div>
      {webhooks.length > 0 && (
        <Section title="Webhook URL to register with the provider" open>
          {webhooks.map((w) => (
            <div key={w.url} className="space-y-0.5">
              <p className="text-xs font-medium text-fg">{w.name}</p>
              <div className="flex items-center gap-1">
                <code className="flex-1 break-all rounded bg-subtle px-1.5 py-1 text-2xs text-fg">{w.url}</code>
                <IconButton type="button" size="sm" label="Copy webhook URL" icon={<Copy />} onClick={() => navigator.clipboard?.writeText(w.url)} />
              </div>
            </div>
          ))}
          <Hint>Set the connection&apos;s webhook secret to the HMAC / signing key the provider shows. <a href={DOCS} className={linkClass}>Setup per provider</a></Hint>
        </Section>
      )}
      <Hint>Variables: <code>{"{{esign_event}}"}</code>, <code>{"{{esign_envelope_id}}"}</code>, <code>{"{{esign_status}}"}</code>, <code>{"{{esign_recipient.email}}"}</code>, <code>{"{{esign_envelope.recipients}}"}</code>.</Hint>
    </div>
  )
}

const PANELS: Record<string, (p: PanelProps) => React.ReactElement> = {
  esign_send: SendPanel,
  esign_wait: WaitPanel,
  esign_envelope: EnvelopePanel,
}

export function isEsignActionPanel(type: string): boolean {
  return type in PANELS
}

export function EsignActionConfig(props: PanelProps) {
  const Panel = PANELS[props.type]
  if (!Panel) return null
  return (
    <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
      <Panel {...props} />
    </div>
  )
}
