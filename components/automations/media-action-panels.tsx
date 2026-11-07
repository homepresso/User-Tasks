"use client"

/**
 * Designer settings for the media actions (lib/media): Transcribe, Analyze
 * Image / Video, Redact Image / Video, Generate / Edit Image, Text to Speech
 * and Media Utilities. Config keys match lib/media/handlers.ts; providers and
 * capabilities come from lib/media/catalog.ts; docs at /docs/workflows/media.
 */

import { useQuery } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { IconButton } from "@/components/ui/icon-button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Input } from "@/components/ui/input"
import { Select as UiSelect } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { serverRead } from "@/lib/server-read"
import { VariableInput } from "./variable-input"
import { INFO_CATEGORIES, INFO_REGIONS, PATTERN_INFO_TYPES, inRegions, resolveInfoTypes } from "@/lib/documents/pii/catalog"
import {
  AUDIO_FORMATS, IMAGE_FEATURES, MEDIA_BACKGROUND_NODE_TYPES, MEDIA_PROVIDERS, MEDIA_TOOL_OPERATIONS, REDACT_TARGETS, TRANSCRIPT_FORMATS, VIDEO_FEATURES,
  isMediaNodeType, mediaProviderForType, providerSupportsNode, type MediaNodeType, type MediaProviderInfo,
} from "@/lib/media/catalog"
import { mediaOutputVar } from "@/lib/media/schemas"
import type { MediaCapability } from "@/lib/media/types"

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

interface PanelProps {
  type: string
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables?: { name: string; group: string; label?: string }[]
}

/** Toggle pill (aria-pressed): primary fill when on. */
const chipClass = (on: boolean) => cn(
  "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
  on ? "border-primary bg-primary text-primary-fg" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
)
const PROVIDER_DOCS = "/docs/workflows/media/providers"

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-fg">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-fg-muted">{children}</p>
}

function Warn({ children }: { children: React.ReactNode }) {
  return <InlineNotice tone="warning" className="gap-2 px-2 py-1.5 text-xs leading-snug [&>span>svg]:size-3.5">{children}</InlineNotice>
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; label: string }) {
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

function Chips({ value, onChange, options, label }: { value: string[]; onChange: (v: string[]) => void; options: ReadonlyArray<readonly [string, string]>; label: string }) {
  const set = new Set(value)
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map(([v, l]) => {
        const on = set.has(v)
        return (
          <button key={v} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
            className={chipClass(on)}>
            {l}
          </button>
        )
      })}
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

function NumberInput({ config, onUpdate, field, placeholder, min, max, step, label }: { config: Record<string, any>; onUpdate: (k: string, v: any) => void; field: string; placeholder: string; min?: number; max?: number; step?: number | "any"; label: string }) {
  return (
    <Input type="number" min={min} max={max} step={step} value={config[field] ?? ""} aria-label={label}
      onChange={(e) => onUpdate(field, e.target.value === "" ? "" : Number(e.target.value))} placeholder={placeholder} size="sm" className="text-xs" />
  )
}

const arr = (v: unknown, fallback: string[]): string[] => (Array.isArray(v) ? v.map(String) : fallback)

/* ── Providers ─────────────────────────────────────────────────────── */

interface MediaIntegration { id: string; name: string; type: string; is_active: boolean; provider: MediaProviderInfo }

/** Workspace integrations that reach a media provider. */
export function useMediaIntegrations() {
  return useQuery({
    queryKey: ["media-integrations"],
    queryFn: async () => {
      const data = (await serverRead("automations.referencePicker")).data as { integrations?: Array<{ id: string; name: string; type: string; is_active: boolean }> } | null
      return (data?.integrations ?? []).flatMap((i) => {
        const provider = mediaProviderForType(i.type)
        return provider ? [{ ...i, provider }] : []
      }) as MediaIntegration[]
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

const CAPABILITY_PHRASE: Record<MediaCapability, string> = {
  transcribe: "transcribe speech",
  analyze_image: "describe or label images",
  detect_faces: "locate faces",
  ocr: "read text with its position",
  moderation: "check image safety",
  detect_objects: "locate objects such as license plates",
  analyze_video: "watch a whole video",
  generate_image: "generate images",
  edit_image: "edit images",
  tts: "turn text into speech",
}

function orList(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`
}

/** Providers that have a capability, as "A, B or C". */
function alternatives(cap: MediaCapability): string {
  return orList(MEDIA_PROVIDERS.filter((p) => p.capabilities.includes(cap)).map((p) => p.label))
}

/** The capabilities the chosen features / targets / operation need. */
function neededCapabilities(type: MediaNodeType, config: Record<string, any>): MediaCapability[] {
  switch (type) {
    case "media_analyze_image": {
      const features = arr(config.features, ["description", "labels", "text"])
      return [...new Set(IMAGE_FEATURES.filter((f) => features.includes(f.id)).map((f) => f.capability as MediaCapability))]
    }
    case "media_redact_image":
    case "media_redact_video": {
      const targets = arr(config.targets, ["faces", "text_pii"])
      return [...new Set(REDACT_TARGETS.filter((t) => targets.includes(t.id) && t.capability).map((t) => t.capability as MediaCapability))]
    }
    case "media_generate_image": return [config.operation === "edit" ? "edit_image" : "generate_image"]
    case "media_transcribe": return ["transcribe"]
    case "media_tts": return ["tts"]
    default: return []
  }
}

/** Messages for what the provider cannot do for this configuration. */
export function mediaCapabilityGaps(type: string, config: Record<string, any>, provider: MediaProviderInfo | null | undefined): string[] {
  if (!provider || !isMediaNodeType(type)) return []
  const gaps = neededCapabilities(type, config)
    .filter((cap) => !provider.capabilities.includes(cap))
    .map((cap) => `${provider.label} cannot ${CAPABILITY_PHRASE[cap]} — choose ${alternatives(cap)}.`)
  if (type === "media_analyze_video" && !provider.capabilities.includes("analyze_video") && provider.capabilities.includes("analyze_image")) {
    gaps.push(`${provider.label} looks at up to ${config.max_frames || 12} frames sampled from the video (needs FFmpeg on the server). ${alternatives("analyze_video")} can watch the whole video.`)
  }
  return gaps
}

/** Is a provider needed for this configuration (mirrors validateNode)? */
function providerRequired(type: string, config: Record<string, any>): boolean {
  if (type === "media_tools") return false
  if (type === "media_redact_image" || type === "media_redact_video") {
    // Faces, plates and text on screen need the provider; boxes alone and speech alone (with a speech provider) do not.
    return arr(config.targets, ["faces", "text_pii"]).some((t) => t !== "custom")
  }
  return true
}

function ProviderPicker({ type, config, onBatchUpdate, field = "integration_id", label = "AI provider", filter, optionalLabel }: PanelProps & {
  field?: string; label?: string; filter?: (p: MediaProviderInfo) => boolean; optionalLabel?: string
}) {
  const integrations = useMediaIntegrations()
  const nodeType = type as MediaNodeType
  const usable = (integrations.data ?? []).filter((i) => (filter ? filter(i.provider) : providerSupportsNode(i.provider, nodeType)))
  const selectedId = String(config[field] ?? "")
  const selected = (integrations.data ?? []).find((i) => i.id === selectedId)
  const gaps = field === "integration_id" ? mediaCapabilityGaps(type, config, selected?.provider) : []
  const labelField = field === "integration_id" ? "provider_label" : field.replace(/_integration_id$/, "_provider_label")
  const options: Array<[string, string]> = [
    ["", integrations.isLoading ? "Loading…" : optionalLabel ?? (usable.length ? "Choose a connection" : "No media-capable connection")],
    ...usable.map((i) => [i.id, `${i.name} — ${i.provider.label}${i.is_active === false ? " (inactive)" : ""}`] as [string, string]),
  ]
  if (selectedId && !usable.some((i) => i.id === selectedId)) options.push([selectedId, selected ? `${selected.name} — cannot do this step` : "Unknown connection"])
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select label={label} value={selectedId} onChange={(id) => {
        const hit = (integrations.data ?? []).find((i) => i.id === id)
        onBatchUpdate({ [field]: id, [labelField]: hit ? hit.provider.label : "" })
      }} options={options} />
      {!integrations.isLoading && usable.length === 0 && (
        <Hint>
          Add an OpenAI, Gemini, Azure AI, AWS, Deepgram, AssemblyAI, ElevenLabs or Stability AI connector in Integrations, with your own API key. <a href={PROVIDER_DOCS} target="_blank" rel="noreferrer" className="text-primary-text underline">Provider setup</a>
        </Hint>
      )}
      {selected?.provider.notes && <Hint>{selected.provider.notes}</Hint>}
      {gaps.map((g) => <Warn key={g}>{g}</Warn>)}
      {field === "integration_id" && selected && <Hint>The media is sent to {selected.provider.label} when the step runs.</Hint>}
    </div>
  )
}

/* ── Shared fields ─────────────────────────────────────────────────── */

function MediaSource({ config, onUpdate, extraVariables, field = "source", label = "Media", placeholder = "{{form.recording}} or {{media_file}}" }: PanelProps & { field?: string; label?: string; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <VariableInput value={config[field] ?? ""} onChange={(v) => onUpdate(field, v)} placeholder={placeholder} extraVariables={extraVariables} />
      <Hint>A file from a form or another step (a list uses its first file), a <code>storage://</code> reference, a URL or base64 content. Files are read for this workspace only.</Hint>
    </div>
  )
}

function OutputVar({ type, config, onUpdate }: { type: string; config: Record<string, any>; onUpdate: (k: string, v: any) => void }) {
  return (
    <div className="space-y-1">
      <Label>Output variable</Label>
      <Input value={config.output_var ?? ""} onChange={(e) => onUpdate("output_var", e.target.value.replace(/[^\w]/g, ""))} placeholder={mediaOutputVar(type, { ...config, output_var: "" })} size="sm" className="font-mono text-xs" />
    </div>
  )
}

function OutputName({ config, onUpdate, extraVariables, placeholder = "<source>-…" }: PanelProps & { placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label>Output file name</Label>
      <VariableInput value={config.output_name ?? ""} onChange={(v) => onUpdate("output_name", v)} placeholder={placeholder} extraVariables={extraVariables} />
    </div>
  )
}

const MODEL_KEY: Partial<Record<MediaNodeType, keyof MediaProviderInfo["defaults"]>> = {
  media_transcribe: "transcribe",
  media_analyze_image: "vision",
  media_analyze_video: "video",
  media_redact_image: "vision",
  media_redact_video: "vision",
  media_generate_image: "image",
  media_tts: "tts",
}

function ModelInput({ type, config, onUpdate }: PanelProps) {
  const integrations = useMediaIntegrations()
  const provider = (integrations.data ?? []).find((i) => i.id === config.integration_id)?.provider
  const key = MODEL_KEY[type as MediaNodeType]
  const fallback = (key && provider?.defaults[key]) || "Provider default"
  return (
    <div className="space-y-1">
      <Label>Model</Label>
      <Input value={config.model ?? ""} onChange={(e) => onUpdate("model", e.target.value)} placeholder={fallback} size="sm" className="font-mono text-xs" aria-label="Model" />
    </div>
  )
}

function RunMode({ type, config, onUpdate }: PanelProps) {
  if (!(MEDIA_BACKGROUND_NODE_TYPES as readonly string[]).includes(type)) return null
  return (
    <div className="space-y-1">
      <Label>Run</Label>
      <Segmented label="Run mode" value={config.run_mode ?? "auto"} onChange={(v) => onUpdate("run_mode", v)} options={[["auto", "Auto"], ["inline", "Inline"], ["background", "Background"]]} />
      <Hint>
        Auto runs in the background when the media is longer than 5 minutes (instance setting MEDIA_INLINE_MAX_SECONDS) or the provider works as a job, and the run continues when it finishes. Background needs a saved workflow; Save &amp; Test always runs inline.
      </Hint>
    </div>
  )
}

type AnswerFieldRow = { name: string; type: string; description?: string }

function AnswerFields({ config, onUpdate }: PanelProps) {
  const fields = (Array.isArray(config.fields) ? config.fields : []) as AnswerFieldRow[]
  const set = (i: number, patch: Partial<AnswerFieldRow>) => { const u = [...fields]; u[i] = { ...u[i], ...patch }; onUpdate("fields", u) }
  return (
    <div className="space-y-1.5">
      <Label>Answer fields (optional)</Label>
      {fields.map((f, i) => (
        <Card key={i} variant="inset" padding="sm" className="space-y-1 p-2">
          <div className="flex gap-1.5 items-center">
            <Input value={f.name} onChange={(e) => set(i, { name: e.target.value.replace(/[^\w]/g, "_") })} placeholder="damage_visible" aria-label="Field name" size="sm" className="font-mono text-xs flex-1 min-w-0" />
            <UiSelect size="sm" aria-label="Field type" value={f.type ?? "string"} onChange={(e) => set(i, { type: e.target.value })} wrapperClassName="w-auto shrink-0" className="text-xs">
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Yes / no</option>
              <option value="array">List</option>
              <option value="object">Object</option>
            </UiSelect>
            <IconButton type="button" size="sm" label="Remove field" icon={<X />} onClick={() => onUpdate("fields", fields.filter((_, j) => j !== i))} />
          </div>
          <Input value={f.description ?? ""} onChange={(e) => set(i, { description: e.target.value })} placeholder="What the field means (helps the model)" aria-label="Field description" size="sm" className="text-xs" />
        </Card>
      ))}
      <Button type="button" variant="link" size="sm" leadingIcon={<Plus />} onClick={() => onUpdate("fields", [...fields, { name: "", type: "string", description: "" }])}>Add field</Button>
      <Hint>With fields, the answer is an object with these keys; without, it is text.</Hint>
    </div>
  )
}

function PromptInput({ config, onUpdate, extraVariables, placeholder, label = "Question or instruction (optional)" }: PanelProps & { placeholder: string; label?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <VariableInput value={config.prompt ?? ""} onChange={(v) => onUpdate("prompt", v)} placeholder={placeholder} extraVariables={extraVariables} multiline rows={3} />
    </div>
  )
}

/* ── Transcribe ────────────────────────────────────────────────────── */

function TranscribePanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const ov = mediaOutputVar(props.type, config)
  return (
    <>
      <ProviderPicker {...props} />
      <MediaSource {...props} label="Audio or video" />
      <Label>Language</Label>
      <Input value={config.language ?? ""} onChange={(e) => onUpdate("language", e.target.value)} placeholder="Detect (or en, de, es-MX…)" size="sm" className="font-mono text-xs" aria-label="Language" />
      <Toggle checked={Boolean(config.diarize)} onChange={(v) => onUpdate("diarize", v)} label="Label speakers (diarization)" />
      {config.diarize && <NumberInput config={config} onUpdate={onUpdate} field="max_speakers" placeholder="Max speakers (detect)" min={1} max={30} label="Max speakers" />}
      <Toggle checked={Boolean(config.word_timestamps)} onChange={(v) => onUpdate("word_timestamps", v)} label="Word timings" />
      <Label>Files</Label>
      <Chips label="Transcript formats" value={arr(config.formats, ["srt"])} onChange={(v) => onUpdate("formats", v)} options={TRANSCRIPT_FORMATS.map((f) => [f, f.toUpperCase()] as const)} />
      <Hint>SRT and VTT are subtitle files; TXT is plain text; JSON has every segment and word.</Hint>
      <Section title="Advanced">
        <Label>Vocabulary hint</Label>
        <VariableInput value={config.prompt ?? ""} onChange={(v) => onUpdate("prompt", v)} placeholder="Product names, people, jargon" extraVariables={extraVariables} />
        <ModelInput {...props} />
        <OutputName {...props} placeholder="<source>-transcript" />
      </Section>
      <RunMode {...props} />
      <OutputVar type={props.type} config={config} onUpdate={onUpdate} />
      <Hint>
        Use <code>{`{{${ov}_text}}`}</code> in a Run Agent prompt to summarise, loop over <code>{`{{${ov}_segments}}`}</code>, or attach <code>{`{{${ov}_files}}`}</code> to an email.
      </Hint>
    </>
  )
}

/* ── Analyze image ─────────────────────────────────────────────────── */

function AnalyzeImagePanel(props: PanelProps) {
  const { config, onUpdate } = props
  const ov = mediaOutputVar(props.type, config)
  return (
    <>
      <ProviderPicker {...props} />
      <MediaSource {...props} label="Image" placeholder="{{form.photo}}" />
      <Label>Find</Label>
      <Chips label="Features" value={arr(config.features, ["description", "labels", "text"])} onChange={(v) => onUpdate("features", v)} options={IMAGE_FEATURES.map((f) => [f.id, f.label] as const)} />
      <Hint>Faces are located, never identified.</Hint>
      <PromptInput {...props} placeholder="Is there visible damage to the vehicle?" />
      {String(config.prompt ?? "").trim() && <AnswerFields {...props} />}
      <Section title="Advanced">
        <Label>Max labels / objects</Label>
        <NumberInput config={config} onUpdate={onUpdate} field="max_results" placeholder="20" min={1} max={100} label="Max results" />
        <ModelInput {...props} />
      </Section>
      <OutputVar type={props.type} config={config} onUpdate={onUpdate} />
      <Hint>
        Use <code>{`{{${ov}_description}}`}</code>, <code>{`{{${ov}_text}}`}</code>, <code>{`{{${ov}.face_count}}`}</code> or <code>{`{{${ov}_answer}}`}</code>.
      </Hint>
    </>
  )
}

/* ── Analyze video ─────────────────────────────────────────────────── */

function AnalyzeVideoPanel(props: PanelProps) {
  const { config, onUpdate } = props
  const ov = mediaOutputVar(props.type, config)
  return (
    <>
      <ProviderPicker {...props} />
      <MediaSource {...props} label="Video" placeholder="{{form.video}}" />
      <Label>Find</Label>
      <Chips label="Features" value={arr(config.features, ["summary", "scenes"])} onChange={(v) => onUpdate("features", v)} options={VIDEO_FEATURES.map((f) => [f.id, f.label] as const)} />
      <PromptInput {...props} placeholder="List every product shown, with the time it appears" />
      {String(config.prompt ?? "").trim() && <AnswerFields {...props} />}
      <Section title="Frames">
        <Label>Max frames</Label>
        <NumberInput config={config} onUpdate={onUpdate} field="max_frames" placeholder="12" min={1} max={60} label="Max frames" />
        <Hint>For providers that cannot watch a whole video, this many frames are sampled evenly (needs FFmpeg on the server).</Hint>
        <Toggle checked={Boolean(config.keyframes)} onChange={(v) => onUpdate("keyframes", v)} label="Save key frames as images" />
        <ModelInput {...props} />
      </Section>
      <RunMode {...props} />
      <OutputVar type={props.type} config={config} onUpdate={onUpdate} />
      <Hint>
        Use <code>{`{{${ov}_summary}}`}</code>, loop over <code>{`{{${ov}_scenes}}`}</code> or <code>{`{{${ov}_keyframes}}`}</code>.
      </Hint>
    </>
  )
}

/* ── Redact image / video ──────────────────────────────────────────── */

function InfoTypePicker({ config, onUpdate, onBatchUpdate, field = "info_types", showConfidence = true, label = "Information types" }: PanelProps & { field?: string; showConfidence?: boolean; label?: string }) {
  const raw = arr(config[field], ["@high"])
  const regions = arr(config.regions, [])
  const selected = new Set(resolveInfoTypes(raw, regions))
  const visible = PATTERN_INFO_TYPES.filter((t) => inRegions(t, regions))
  const setTypes = (ids: string[]) => onUpdate(field, PATTERN_INFO_TYPES.map((t) => t.id).filter((id) => ids.includes(id)))
  const toggle = (id: string, on: boolean) => setTypes(on ? [...selected, id] : [...selected].filter((x) => x !== id))
  const quick = raw.includes("@high") ? "high" : raw.includes("*") ? "all" : ""
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1">
        <button type="button" aria-pressed={quick === "high"} onClick={() => (showConfidence ? onBatchUpdate({ [field]: ["@high"], min_confidence: "high" }) : onUpdate(field, ["@high"]))} className={chipClass(quick === "high")}>
          All high-confidence types
        </button>
        <button type="button" aria-pressed={quick === "all"} onClick={() => onUpdate(field, ["*"])} className={chipClass(quick === "all")}>
          Every type
        </button>
        {selected.size > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => onUpdate(field, [])} className="h-auto px-2 py-0.5">Clear ({selected.size})</Button>}
      </div>
      {showConfidence && (
        <>
          <Label>Regions</Label>
          <Chips label="Regions" value={regions} onChange={(v) => onUpdate("regions", v)} options={INFO_REGIONS.filter((r) => r.id !== "global").map((r) => [r.id, r.label] as const)} />
          <Hint>No region chosen: every region. Global types (cards, IBANs, emails, dates of birth…) always apply.</Hint>
        </>
      )}
      {INFO_CATEGORIES.map((cat) => {
        const types = visible.filter((t) => t.category === cat.id)
        if (!types.length) return null
        const on = types.filter((t) => selected.has(t.id)).length
        return (
          <details key={cat.id} className="rounded-lg border border-border px-2 py-1.5">
            <summary className="text-xs font-medium text-fg cursor-pointer select-none flex items-center gap-2">
              <span className="flex-1">{cat.label}</span>
              <span className="num text-2xs font-normal text-fg-muted">{on}/{types.length}</span>
            </summary>
            <div className="space-y-1 pt-1.5">
              <label className="flex items-center gap-2 text-xs text-fg cursor-pointer font-medium">
                <Checkbox checked={on === types.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < types.length }}
                  onChange={(e) => setTypes(e.target.checked ? [...selected, ...types.map((t) => t.id)] : [...selected].filter((id) => !types.some((t) => t.id === id)))} />
                All {cat.label.toLowerCase()}
              </label>
              {types.map((t) => (
                <label key={t.id} className="flex items-start gap-2 text-xs text-fg cursor-pointer" title={`${t.format}. ${t.validation}.`}>
                  <Checkbox className="mt-0.5" checked={selected.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} aria-label={t.label} />
                  <span className="flex-1 min-w-0">
                    {t.label}
                    <span className="block text-2xs leading-snug text-fg-muted">{t.regions.join(", ")} · {t.confidence}</span>
                  </span>
                </label>
              ))}
            </div>
          </details>
        )
      })}
      {showConfidence && (
        <>
          <Label>Minimum confidence</Label>
          <Segmented label="Minimum confidence" value={config.min_confidence ?? "medium"} onChange={(v) => onUpdate("min_confidence", v)} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} />
        </>
      )}
    </div>
  )
}

function PatternList({ config, onUpdate }: PanelProps) {
  const patterns = (Array.isArray(config.patterns) ? config.patterns : []).map((p: any) => (typeof p === "string" ? { pattern: p } : p)) as Array<{ pattern: string }>
  return (
    <>
      <Label>Patterns</Label>
      {patterns.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={p.pattern ?? ""} onChange={(e) => { const u = [...patterns]; u[i] = { pattern: e.target.value }; onUpdate("patterns", u) }} placeholder="ACC-\d{6}" aria-label="Pattern" size="sm" className="font-mono text-xs flex-1 min-w-0" />
          <IconButton type="button" size="sm" label="Remove pattern" icon={<X />} onClick={() => onUpdate("patterns", patterns.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Button type="button" variant="link" size="sm" leadingIcon={<Plus />} onClick={() => onUpdate("patterns", [...patterns, { pattern: "" }])} className="self-start">Add pattern</Button>
    </>
  )
}

function RedactPanel(props: PanelProps) {
  const { type, config, onUpdate, extraVariables } = props
  const video = type === "media_redact_video"
  const detect = config.mode === "detect_only"
  const targets = arr(config.targets, ["faces", "text_pii"])
  const style = config.style ?? "blur"
  const audio = String(config.audio ?? "none")
  const ov = mediaOutputVar(type, config)
  const required = providerRequired(type, config)
  return (
    <>
      <ProviderPicker {...props} optionalLabel={required ? undefined : video ? "None (boxes or speech only)" : "None (boxes from earlier steps only)"} />
      <MediaSource {...props} label={video ? "Video (or audio)" : "Image"} placeholder={video ? "{{form.video}}" : "{{form.photo}}"} />
      <Label>Action</Label>
      <Segmented label="Action" value={detect ? "detect_only" : "redact"} onChange={(v) => onUpdate("mode", v)} options={[["redact", "Redact a copy"], ["detect_only", "Detect only (no changes)"]]} />
      <Label>Find</Label>
      <Chips label="Targets" value={targets} onChange={(v) => onUpdate("targets", v)} options={REDACT_TARGETS.map((t) => [t.id, t.label] as const)} />
      <Hint>Faces and plates are located, never identified. Boxes found by AI can be approximate — check results before relying on them.</Hint>
      {targets.includes("text_pii") && (
        <Section title="Sensitive text" open>
          <InfoTypePicker {...props} />
          <Label>Words and phrases</Label>
          <VariableInput value={config.terms ?? ""} onChange={(v) => onUpdate("terms", v)} placeholder="Project Falcon, {{customer.name}}" extraVariables={extraVariables} />
          <PatternList {...props} />
        </Section>
      )}
      {targets.includes("custom") && (
        <div className="space-y-1">
          <Label>Boxes</Label>
          <VariableInput value={typeof config.boxes === "string" ? config.boxes : ""} onChange={(v) => onUpdate("boxes", v)} placeholder="{{image_analysis.faces}}" extraVariables={extraVariables} />
          <Hint>
            A list of boxes: <code>{"{x, y, width, height}"}</code> as fractions (0–1) or <code>{"{left, top, width, height}"}</code> in pixels, optional <code>label</code>{video ? <>, and <code>start</code> / <code>end</code> seconds</> : null}.
          </Hint>
        </div>
      )}
      {video && (
        <Section title="Speech" open={audio !== "none"}>
          <Label>Sensitive speech</Label>
          <Segmented label="Audio" value={audio} onChange={(v) => onUpdate("audio", v)} options={[["none", "Leave"], ["bleep", "Bleep"], ["mute", "Mute"]]} />
          {audio !== "none" && (
            <>
              <ProviderPicker {...props} field="transcribe_integration_id" label="Speech provider" filter={(p) => p.capabilities.includes("transcribe")} optionalLabel="Same as the AI provider" />
              <Label>Transcript (optional)</Label>
              <VariableInput value={config.transcript ?? ""} onChange={(v) => onUpdate("transcript", v)} placeholder="{{transcript}}" extraVariables={extraVariables} />
              <Hint>Reuse a transcript from an earlier Transcribe step (with word timings) instead of transcribing again.</Hint>
              <InfoTypePicker {...props} field="audio_info_types" label="Spoken information types" showConfidence={false} />
              <Label>Spoken words and phrases</Label>
              <VariableInput value={config.audio_terms ?? ""} onChange={(v) => onUpdate("audio_terms", v)} placeholder="{{customer.name}}" extraVariables={extraVariables} />
              <Hint>Audio-only files (a call recording) work too: the speech is bleeped or muted.</Hint>
            </>
          )}
        </Section>
      )}
      {!detect && (
        <>
          <Label>Style</Label>
          <Segmented label="Style" value={style} onChange={(v) => onUpdate("style", v)} options={[["blur", "Blur"], ["pixelate", "Pixelate"], ["box", "Solid box"]]} />
          {style === "box" && <Input value={config.color ?? ""} onChange={(e) => onUpdate("color", e.target.value)} placeholder="#000000" aria-label="Box color" size="sm" className="font-mono text-xs" />}
          <Label>Padding (% of each box)</Label>
          <NumberInput config={config} onUpdate={onUpdate} field="padding" placeholder="10" min={0} max={100} label="Padding" />
        </>
      )}
      <Section title="Advanced">
        {video && (
          <>
            <Label>Seconds between analysed frames</Label>
            <NumberInput config={config} onUpdate={onUpdate} field="sample_interval" placeholder="1" min={0.2} step="any" label="Sample interval" />
            <Hint>Shorter catches faster movement but costs more provider calls. Videos up to 10 minutes by default (MEDIA_VIDEO_REDACT_MAX_SECONDS); needs FFmpeg on the server.</Hint>
          </>
        )}
        {!detect && (
          <>
            <Label>Output format</Label>
            {video
              ? <Segmented label="Output format" value={config.output_format ?? "mp4"} onChange={(v) => onUpdate("output_format", v)} options={[["mp4", "MP4"], ["webm", "WebM"], ["mov", "MOV"]]} />
              : <Segmented label="Output format" value={config.output_format ?? "same"} onChange={(v) => onUpdate("output_format", v)} options={[["same", "Same"], ["png", "PNG"], ["jpeg", "JPEG"]]} />}
            <OutputName {...props} placeholder="<source>-redacted" />
          </>
        )}
        <ModelInput {...props} />
      </Section>
      {video && <RunMode {...props} />}
      <OutputVar type={type} config={config} onUpdate={onUpdate} />
      <Hint>
        Loop over <code>{`{{${ov}_findings}}`}</code> or branch on <code>{`{{${ov}_count}}`}</code>{detect ? "" : <>; the copy is <code>{`{{${ov}_file}}`}</code></>}. Text findings are masked.
      </Hint>
    </>
  )
}

/* ── Generate / edit image ─────────────────────────────────────────── */

function GenerateImagePanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const edit = config.operation === "edit"
  const ov = mediaOutputVar(props.type, config)
  return (
    <>
      <ProviderPicker {...props} />
      <Label>Operation</Label>
      <Segmented label="Operation" value={edit ? "edit" : "generate"} onChange={(v) => onUpdate("operation", v)} options={[["generate", "Generate"], ["edit", "Edit an image"]]} />
      <PromptInput {...props} label="Prompt" placeholder={edit ? "Replace the background with a plain white studio wall" : "A flat illustration of a delivery van, brand colors teal and white"} />
      {edit && (
        <>
          <MediaSource {...props} label="Image to edit" placeholder="{{form.photo}}" />
          <Label>Mask (optional)</Label>
          <VariableInput value={config.mask ?? ""} onChange={(v) => onUpdate("mask", v)} placeholder="{{mask_file}}" extraVariables={extraVariables} />
          <Hint>A PNG the same size as the image: transparent pixels are the area to change.</Hint>
        </>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <Label>Size</Label>
          <Input value={config.size ?? ""} onChange={(e) => onUpdate("size", e.target.value)} placeholder="auto" aria-label="Size" size="sm" className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Label>Images</Label>
          <NumberInput config={config} onUpdate={onUpdate} field="count" placeholder="1" min={1} max={4} label="Count" />
        </div>
      </div>
      <Hint>Size: <code>auto</code>, pixels such as <code>1024x1024</code> or <code>1536x1024</code>, or an aspect ratio such as <code>16:9</code> (Stability AI).</Hint>
      <Label>Format</Label>
      <Segmented label="Format" value={config.format ?? "png"} onChange={(v) => onUpdate("format", v)} options={[["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]]} />
      <Section title="Advanced">
        <Label>Quality</Label>
        <Input value={config.quality ?? ""} onChange={(e) => onUpdate("quality", e.target.value)} placeholder="Provider default (low, medium, high…)" aria-label="Quality" size="sm" className="text-xs" />
        <Label>Negative prompt</Label>
        <VariableInput value={config.negative_prompt ?? ""} onChange={(v) => onUpdate("negative_prompt", v)} placeholder="text, watermark (Stability AI)" extraVariables={extraVariables} />
        <ModelInput {...props} />
        <OutputName {...props} placeholder="generated" />
      </Section>
      <OutputVar type={props.type} config={config} onUpdate={onUpdate} />
      <Hint>The first image is <code>{`{{${ov}_file}}`}</code>; all of them are <code>{`{{${ov}_files}}`}</code>.</Hint>
    </>
  )
}

/* ── Text to speech ────────────────────────────────────────────────── */

function TtsPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const ov = mediaOutputVar(props.type, config)
  return (
    <>
      <ProviderPicker {...props} />
      <Label>Text</Label>
      <VariableInput value={config.text ?? ""} onChange={(v) => onUpdate("text", v)} placeholder="Hello {{customer.first_name}}, your order has shipped." extraVariables={extraVariables} multiline rows={4} />
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-1">
          <Label>Voice</Label>
          <Input value={config.voice ?? ""} onChange={(e) => onUpdate("voice", e.target.value)} placeholder="Provider default" aria-label="Voice" size="sm" className="font-mono text-xs" />
        </div>
        <div className="space-y-1">
          <Label>Speed</Label>
          <NumberInput config={config} onUpdate={onUpdate} field="speed" placeholder="1" min={0.25} max={4} step="any" label="Speed" />
        </div>
      </div>
      <Hint>A voice name or id from your provider (for example <code>alloy</code> for OpenAI, or an ElevenLabs voice id).</Hint>
      <Label>Format</Label>
      <Segmented label="Format" value={config.format ?? "mp3"} onChange={(v) => onUpdate("format", v)} options={[["mp3", "MP3"], ["wav", "WAV"], ["opus", "Opus"], ["aac", "AAC"], ["flac", "FLAC"]]} />
      <Section title="Advanced">
        <Label>Language</Label>
        <Input value={config.language ?? ""} onChange={(e) => onUpdate("language", e.target.value)} placeholder="Detect (or en-US)" aria-label="Language" size="sm" className="font-mono text-xs" />
        <Label>Style instructions</Label>
        <VariableInput value={config.instructions ?? ""} onChange={(v) => onUpdate("instructions", v)} placeholder="Calm and friendly" extraVariables={extraVariables} />
        <ModelInput {...props} />
        <OutputName {...props} placeholder="speech" />
      </Section>
      <OutputVar type={props.type} config={config} onUpdate={onUpdate} />
      <Hint>The audio file is <code>{`{{${ov}_file}}`}</code> — attach it to an email or store it.</Hint>
    </>
  )
}

/* ── Media utilities ───────────────────────────────────────────────── */

const CONVERT_FORMATS = ["mp4", "webm", "mov", "gif", ...AUDIO_FORMATS] as const

function ToolsPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const op = String(config.operation ?? "info")
  const ov = mediaOutputVar(props.type, config)
  return (
    <>
      <Label>Operation</Label>
      <Select label="Operation" value={op} onChange={(v) => props.onBatchUpdate({ operation: v, format: "" })} options={MEDIA_TOOL_OPERATIONS.map((o) => [o.id, o.label] as [string, string])} />
      <MediaSource {...props} label="Audio or video" placeholder="{{form.video}}" />
      {op === "trim" && (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label>Start</Label>
            <VariableInput value={String(config.start ?? "")} onChange={(v) => onUpdate("start", v)} placeholder="0:05" extraVariables={extraVariables} />
          </div>
          <div className="space-y-1">
            <Label>End</Label>
            <VariableInput value={String(config.end ?? "")} onChange={(v) => onUpdate("end", v)} placeholder="0:30" extraVariables={extraVariables} />
          </div>
        </div>
      )}
      {op === "trim" && <Hint>Seconds (<code>12.5</code>) or <code>hh:mm:ss[.ms]</code>. Leave one empty to keep the start or the end.</Hint>}
      {op === "extract_audio" && (
        <>
          <Label>Format</Label>
          <Segmented label="Format" value={config.format ?? "mp3"} onChange={(v) => onUpdate("format", v)} options={AUDIO_FORMATS.map((f) => [f, f.toUpperCase()] as [string, string])} />
        </>
      )}
      {op === "convert" && (
        <>
          <Label>Convert to</Label>
          <Select label="Target format" value={config.format ?? ""} onChange={(v) => onUpdate("format", v)} options={[["", "Choose a format"], ...CONVERT_FORMATS.map((f) => [f, f.toUpperCase()] as [string, string])]} />
        </>
      )}
      {(op === "frames" || op === "thumbnail") && (
        <>
          <Label>Image format</Label>
          <Segmented label="Image format" value={config.format ?? "jpeg"} onChange={(v) => onUpdate("format", v)} options={[["jpeg", "JPEG"], ["png", "PNG"]]} />
        </>
      )}
      {op === "frames" && (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label>Every (seconds)</Label>
            <NumberInput config={config} onUpdate={onUpdate} field="interval" placeholder="1" min={0.1} step="any" label="Interval" />
          </div>
          <div className="space-y-1">
            <Label>Max frames</Label>
            <NumberInput config={config} onUpdate={onUpdate} field="count" placeholder="10" min={1} max={100} label="Max frames" />
          </div>
        </div>
      )}
      {op === "thumbnail" && (
        <>
          <Label>At</Label>
          <VariableInput value={String(config.at ?? "")} onChange={(v) => onUpdate("at", v)} placeholder="1 s (or 10% of a short clip)" extraVariables={extraVariables} />
        </>
      )}
      {op === "compress" && (
        <>
          <Label>Quality</Label>
          <Segmented label="Quality" value={config.quality ?? "medium"} onChange={(v) => onUpdate("quality", v)} options={[["low", "Smallest"], ["medium", "Balanced"], ["high", "Best"]]} />
        </>
      )}
      {(op === "convert" || op === "compress") && (
        <div className="grid grid-cols-2 gap-1.5">
          <div className="space-y-1">
            <Label>Max width</Label>
            <NumberInput config={config} onUpdate={onUpdate} field="max_width" placeholder="Keep" min={16} label="Max width" />
          </div>
          <div className="space-y-1">
            <Label>Max height</Label>
            <NumberInput config={config} onUpdate={onUpdate} field="max_height" placeholder="Keep" min={16} label="Max height" />
          </div>
        </div>
      )}
      {op === "burn_subtitles" && (
        <>
          <Label>Subtitles</Label>
          <VariableInput value={config.subtitles ?? ""} onChange={(v) => onUpdate("subtitles", v)} placeholder="{{transcript_srt}}" extraVariables={extraVariables} />
          <Hint>An SRT or VTT file, SRT text, or a transcript from a Transcribe step.</Hint>
        </>
      )}
      <Hint>Runs on the server with FFmpeg (the Docker image includes it). Not available on Vercel.</Hint>
      <RunMode {...props} />
      {op !== "info" && <OutputName {...props} />}
      <OutputVar type={props.type} config={config} onUpdate={onUpdate} />
      {op === "info" && <Hint>Use <code>{`{{${ov}.duration}}`}</code>, <code>{`{{${ov}.video.width}}`}</code> or <code>{`{{${ov}.has_audio}}`}</code>.</Hint>}
    </>
  )
}

const PANELS: Record<MediaNodeType, (p: PanelProps) => React.ReactElement> = {
  media_transcribe: TranscribePanel,
  media_analyze_image: AnalyzeImagePanel,
  media_analyze_video: AnalyzeVideoPanel,
  media_redact_image: RedactPanel,
  media_redact_video: RedactPanel,
  media_generate_image: GenerateImagePanel,
  media_tts: TtsPanel,
  media_tools: ToolsPanel,
}

export function isMediaActionPanel(type: string): boolean {
  return isMediaNodeType(type)
}

export function MediaActionConfig(props: PanelProps) {
  if (!isMediaNodeType(props.type)) return null
  const Panel = PANELS[props.type]
  return (
    <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
      <Panel {...props} />
    </div>
  )
}
