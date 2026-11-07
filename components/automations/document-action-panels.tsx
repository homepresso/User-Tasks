"use client"

/**
 * Designer settings for the document actions (lib/documents): Read, Compare,
 * Convert, PDF tools, Extract, Redact (and detect sensitive information) and Inspect. Config keys match
 * lib/documents/handlers.ts; docs at /docs/workflows/documents.
 */

import { useQuery } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select as UiSelect } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Card } from "@/components/ui/card"
import { InlineNotice } from "@/components/ui/inline-notice"
import { AutocompleteSelect } from "@/components/ui/autocomplete-select"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { serverQuery, serverRead } from "@/lib/server-read"
import { VariableInput } from "./variable-input"
import { INFO_CATEGORIES, INFO_REGIONS, INFO_TYPE_BY_ID, PATTERN_INFO_TYPES, inRegions, resolveInfoTypes } from "@/lib/documents/pii/catalog"

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

interface PanelProps {
  type: string
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables?: { name: string; group: string; label?: string }[]
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium text-fg">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-snug text-fg-muted">{children}</p>
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; label: string }) {
  return (
    <UiSelect size="sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </UiSelect>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} label={label} className="flex text-xs" />
}

function Segmented({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; label: string }) {
  return (
    <div className="flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn(
            "flex-1 min-w-[3rem] rounded-[calc(var(--ds-radius-sm)-2px)] px-1.5 py-1 text-xs font-medium transition-colors",
            value === v ? "bg-panel text-fg shadow-elev-1" : "text-fg-muted hover:text-fg",
          )}>
          {l}
        </button>
      ))}
    </div>
  )
}

/** A toggle pill (aria-pressed): brand wash when on. */
function chipClass(on: boolean) {
  return cn(
    "rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
    on ? "border-primary bg-primary-wash text-primary-text" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
  )
}

function Chips({ value, onChange, options, label }: { value: string[]; onChange: (v: string[]) => void; options: Array<[string, string]>; label: string }) {
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

/** "Add …" text action under a repeated list. */
function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <Button type="button" variant="link" size="sm" leadingIcon={<Plus />} onClick={onClick}>{children}</Button>
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <IconButton type="button" size="sm" label={label} icon={<X />} onClick={onClick} />
}

function FileSource({ config, onUpdate, extraVariables, field = "source", label = "Document", allowText = true, hint = true }: PanelProps & { field?: string; label?: string; allowText?: boolean; hint?: boolean }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <VariableInput value={config[field] ?? ""} onChange={(v) => onUpdate(field, v)} placeholder="{{form.attachments}} or {{api_file}}" extraVariables={extraVariables} />
      {hint && (
        <Hint>
          A file from a form or another step (a list uses its first file), a <code>storage://</code> reference or a URL{allowText ? ", or text" : ""}. Files are read for this workspace only.
        </Hint>
      )}
    </div>
  )
}

function OutputVar({ config, onUpdate, fallback }: { config: Record<string, any>; onUpdate: (k: string, v: any) => void; fallback: string }) {
  return (
    <div className="space-y-1">
      <Label>Output variable</Label>
      <Input value={config.output_var ?? ""} onChange={(e) => onUpdate("output_var", e.target.value.replace(/[^\w]/g, ""))} placeholder={fallback} size="sm" className="font-mono" />
    </div>
  )
}

function OutputName({ config, onUpdate, extraVariables, placeholder }: PanelProps & { placeholder: string }) {
  return (
    <div className="space-y-1">
      <Label>Output file name</Label>
      <VariableInput value={config.output_name ?? ""} onChange={(v) => onUpdate("output_name", v)} placeholder={placeholder} extraVariables={extraVariables} />
    </div>
  )
}

function OcrOptions(props: PanelProps) {
  const { config, onUpdate } = props
  return (
    <div className="space-y-1.5">
      <Label>OCR (scanned PDFs and images)</Label>
      <Segmented label="OCR" value={config.ocr ?? "off"} onChange={(v) => onUpdate("ocr", v)} options={[["off", "Off"], ["auto", "Pages without text"], ["force", "Every page"]]} />
      {(config.ocr ?? "off") !== "off" && (
        <>
          <Input value={config.ocr_languages ?? ""} onChange={(e) => onUpdate("ocr_languages", e.target.value)} placeholder="eng (eng+deu for several)" size="sm" className="font-mono" aria-label="OCR languages" />
          <OcrSetupNotice />
          <Hint>Each page reports a confidence (0–100) and the step output counts the pages sent. The provider is a workspace setting (Settings → Document OCR); the page limit is DOCUMENT_OCR_MAX_PAGES.</Hint>
        </>
      )}
    </div>
  )
}

/** A gentle warning when this workspace has no OCR provider (the step would fail at run time). */
function OcrSetupNotice() {
  const { data } = useQuery({
    queryKey: ["document-ocr-status"],
    queryFn: () => serverQuery("settings.documentOcrStatus"),
    staleTime: 60_000,
  })
  if (!data || data.status === "ready") return null
  return (
    <div data-testid="ocr-not-configured">
      <InlineNotice tone="warning" className="px-2.5 py-2 text-xs leading-snug">
        {data.status === "off" ? "OCR is turned off for this workspace." : "OCR isn't set up for this workspace yet, so this step will fail on scanned pages."}{" "}
        <Link href={data.settings_path} className="font-medium text-primary-text underline underline-offset-2" target="_blank">Set up Document OCR</Link>
      </InlineNotice>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-border px-2 py-1.5">
      <summary className="cursor-pointer select-none text-xs font-medium text-fg">{title}</summary>
      <div className="space-y-2 pt-2">{children}</div>
    </details>
  )
}

/* ── Read ──────────────────────────────────────────────────────────── */

function ReadPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const ov = config.output_var || "document"
  return (
    <>
      <FileSource {...props} />
      <Hint>Word, Excel, PowerPoint, PDF, OpenDocument, Markdown, HTML, CSV, JSON, XML, YAML and text.</Hint>
      <Section title="Pages, sheets and ranges">
        <Label>Pages / slides</Label>
        <VariableInput value={config.pages ?? ""} onChange={(v) => onUpdate("pages", v)} placeholder="All (or 1-5, 3, 4-)" extraVariables={extraVariables} />
        <Label>Sheet</Label>
        <VariableInput value={config.sheet ?? ""} onChange={(v) => onUpdate("sheet", v)} placeholder="All sheets (name or number)" extraVariables={extraVariables} />
        <Label>Range</Label>
        <VariableInput value={config.range ?? ""} onChange={(v) => onUpdate("range", v)} placeholder="Used range (or B2:F40)" extraVariables={extraVariables} />
        <Label>Header row</Label>
        <Select label="Header row" value={String(config.header_row ?? "auto")} onChange={(v) => onUpdate("header_row", v)} options={[["auto", "Detect"], ["first", "First row"], ["none", "No header (column_1, …)"], ["2", "Row 2"], ["3", "Row 3"]]} />
        <Label>Max rows</Label>
        <Input type="number" min={1} value={config.max_rows ?? ""} onChange={(e) => onUpdate("max_rows", e.target.value ? Number(e.target.value) : "")} placeholder="All" size="sm" />
      </Section>
      <Section title="Content options">
        <Toggle checked={config.include_tables !== false} onChange={(v) => onUpdate("include_tables", v)} label="Tables (and tables found in text PDFs)" />
        <Toggle checked={Boolean(config.include_images)} onChange={(v) => onUpdate("include_images", v)} label="List embedded images" />
        <Label>Tracked changes (Word)</Label>
        <Select label="Tracked changes" value={config.tracked_changes ?? "accept"} onChange={(v) => onUpdate("tracked_changes", v)} options={[["accept", "Read as accepted"], ["show", "Show insertions and deletions"]]} />
        <Label>Max characters</Label>
        <Input type="number" min={1000} value={config.max_chars ?? ""} onChange={(e) => onUpdate("max_chars", e.target.value ? Number(e.target.value) : "")} placeholder="2,000,000" size="sm" />
      </Section>
      <OcrOptions {...props} />
      <OutputVar config={config} onUpdate={onUpdate} fallback="document" />
      <Hint>
        Use <code>{`{{${ov}.text}}`}</code>, <code>{`{{${ov}.metadata.pages}}`}</code> or loop over <code>{`{{${ov}_rows}}`}</code>. To summarise or classify it, add a <strong>Run Agent</strong> step with <code>{`{{${ov}.text}}`}</code> in its prompt.
      </Hint>
    </>
  )
}

/* ── Compare ───────────────────────────────────────────────────────── */

function ComparePanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const mode = config.mode ?? "auto"
  const textMode = !["sheet", "json"].includes(mode)
  return (
    <>
      <FileSource {...props} field="original" label="Original" hint={false} />
      <FileSource {...props} field="revised" label="Revised" />
      <Hint>Each side can also be text, a list of rows or a JSON value from an earlier step.</Hint>
      <Label>Compare</Label>
      <Select label="Compare mode" value={mode} onChange={(v) => onUpdate("mode", v)} options={[["auto", "Detect (documents: words, sheets: rows, JSON: paths)"], ["lines", "Lines"], ["words", "Words"], ["characters", "Characters"], ["sentences", "Sentences"], ["sheet", "Spreadsheet rows (cell by cell)"], ["json", "JSON (deep, with paths)"]]} />
      {(mode === "sheet" || mode === "auto") && (
        <Section title="Spreadsheet options">
          <Label>Key columns</Label>
          <VariableInput value={config.key_columns ?? ""} onChange={(v) => onUpdate("key_columns", v)} placeholder="id (comma separated; empty = row order)" extraVariables={extraVariables} />
          <Label>Only these columns</Label>
          <VariableInput value={config.compare_columns ?? ""} onChange={(v) => onUpdate("compare_columns", v)} placeholder="All columns" extraVariables={extraVariables} />
          <Label>Ignore columns</Label>
          <VariableInput value={config.ignore_columns ?? ""} onChange={(v) => onUpdate("ignore_columns", v)} placeholder="updated_at" extraVariables={extraVariables} />
          <Label>Sheet</Label>
          <VariableInput value={config.sheet ?? ""} onChange={(v) => onUpdate("sheet", v)} placeholder="First sheet" extraVariables={extraVariables} />
          <Label>Number tolerance</Label>
          <Input type="number" step="any" min={0} value={config.numeric_tolerance ?? ""} onChange={(e) => onUpdate("numeric_tolerance", e.target.value)} placeholder="0" size="sm" />
        </Section>
      )}
      {mode === "json" && (
        <>
          <Label>Match list items by</Label>
          <Input value={config.array_key ?? ""} onChange={(e) => onUpdate("array_key", e.target.value)} placeholder="id (empty = position)" size="sm" className="font-mono" />
        </>
      )}
      <div className="space-y-1">
        <Toggle checked={Boolean(config.ignore_whitespace)} onChange={(v) => onUpdate("ignore_whitespace", v)} label="Ignore whitespace" />
        <Toggle checked={Boolean(config.ignore_case)} onChange={(v) => onUpdate("ignore_case", v)} label="Ignore case" />
        <Toggle checked={Boolean(config.ignore_punctuation)} onChange={(v) => onUpdate("ignore_punctuation", v)} label="Ignore punctuation" />
      </div>
      {textMode && (
        <>
          <Label>Redline</Label>
          <Segmented label="Redline" value={config.redline ?? "none"} onChange={(v) => onUpdate("redline", v)} options={[["none", "None"], ["docx", "Word"], ["pdf", "PDF"], ["both", "Both"]]} />
          {(config.redline ?? "none") !== "none" && (
            <Select label="Redline style" value={config.redline_style ?? "formatting"} onChange={(v) => onUpdate("redline_style", v)} options={[["formatting", "Coloured: inserted underlined green, deleted struck red"], ["tracked", "Word tracked changes (accept / reject in Word)"]]} />
          )}
        </>
      )}
      <Label>Report file</Label>
      <Segmented label="Report" value={config.report ?? "none"} onChange={(v) => onUpdate("report", v)} options={[["none", "None"], ["html", "HTML"], ["pdf", "PDF"]]} />
      {((config.redline ?? "none") !== "none" || (config.report ?? "none") !== "none") && <OutputName {...props} placeholder="<revised>-comparison" />}
      <OutputVar config={config} onUpdate={onUpdate} fallback="comparison" />
      <Hint>
        <code>{`{{${config.output_var || "comparison"}_html}}`}</code> is a side-by-side report you can use as an email body; files can be attached to Send Email.
      </Hint>
    </>
  )
}

/* ── Convert ───────────────────────────────────────────────────────── */

function ConvertPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  return (
    <>
      <FileSource {...props} />
      <Label>Convert to</Label>
      <Select label="Target format" value={config.target ?? "pdf"} onChange={(v) => onUpdate("target", v)} options={[["pdf", "PDF"], ["docx", "Word (.docx)"], ["html", "HTML"], ["markdown", "Markdown"], ["text", "Plain text"], ["csv", "CSV"], ["xlsx", "Excel (.xlsx)"], ["json", "JSON"]]} />
      {(config.target ?? "pdf") === "pdf" && (
        <>
          <Label>Engine</Label>
          <Select label="Engine" value={config.engine ?? "auto"} onChange={(v) => onUpdate("engine", v)} options={[["auto", "Automatic"], ["builtin", "Built-in (text, headings, lists, tables)"], ["external", "External converter (exact layout)"]]} />
          <Hint>Automatic uses the external converter for Office files when DOCUMENT_CONVERTER_URL is configured, otherwise the built-in renderer.</Hint>
          <Label>Page size</Label>
          <Segmented label="Page size" value={config.page_size ?? "A4"} onChange={(v) => onUpdate("page_size", v)} options={[["A4", "A4"], ["Letter", "Letter"]]} />
        </>
      )}
      {["csv", "xlsx", "json"].includes(config.target) && (
        <>
          <Label>Sheet</Label>
          <VariableInput value={config.sheet ?? ""} onChange={(v) => onUpdate("sheet", v)} placeholder="First sheet" extraVariables={extraVariables} />
          {config.target === "csv" && (
            <>
              <Label>Delimiter</Label>
              <Select label="Delimiter" value={config.delimiter ?? ","} onChange={(v) => onUpdate("delimiter", v)} options={[[",", "Comma"], [";", "Semicolon"], ["\t", "Tab"], ["|", "Pipe"]]} />
            </>
          )}
        </>
      )}
      <OutputName {...props} placeholder="Same name as the source" />
      <OutputVar config={config} onUpdate={onUpdate} fallback="converted_file" />
    </>
  )
}

/* ── PDF tools ─────────────────────────────────────────────────────── */

function PdfPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const op = config.operation ?? "merge"
  const fields = (Array.isArray(config.fields) ? config.fields : []) as Array<{ name: string; value: string }>
  return (
    <>
      <Label>Operation</Label>
      <Select label="PDF operation" value={op} onChange={(v) => onUpdate("operation", v)} options={[["merge", "Merge PDFs"], ["split", "Split into files"], ["extract_pages", "Extract pages"], ["page_count", "Count pages"], ["watermark", "Watermark / stamp text"], ["rotate", "Rotate pages"], ["fill_form", "Fill form fields"], ["read_form", "Read form fields"]]} />
      {op === "merge" ? (
        <div className="space-y-1">
          <Label>PDFs to merge</Label>
          <VariableInput value={typeof config.sources === "string" ? config.sources : ""} onChange={(v) => onUpdate("sources", v)} placeholder="{{form.attachments}} or [{{a}}, {{b}}]" extraVariables={extraVariables} />
          <Hint>A list of files in order (all files of an Attachments field, or a JSON list of file variables).</Hint>
        </div>
      ) : (
        <FileSource {...props} label="PDF" allowText={false} />
      )}
      {(op === "extract_pages" || op === "watermark" || op === "rotate") && (
        <>
          <Label>Pages</Label>
          <VariableInput value={config.pages ?? ""} onChange={(v) => onUpdate("pages", v)} placeholder={op === "extract_pages" ? "1-3, 5, 8-" : "All pages"} extraVariables={extraVariables} />
        </>
      )}
      {op === "split" && (
        <>
          <Label>Ranges</Label>
          <VariableInput value={config.ranges ?? ""} onChange={(v) => onUpdate("ranges", v)} placeholder="1-3; 4-6 (empty = every N pages)" extraVariables={extraVariables} />
          <Label>Every N pages</Label>
          <Input type="number" min={1} value={config.every_n ?? ""} onChange={(e) => onUpdate("every_n", e.target.value ? Number(e.target.value) : "")} placeholder="1" size="sm" />
        </>
      )}
      {op === "watermark" && (
        <>
          <Label>Text</Label>
          <VariableInput value={config.text ?? ""} onChange={(v) => onUpdate("text", v)} placeholder="CONFIDENTIAL or Approved {{=TODAY()}}" extraVariables={extraVariables} />
          <Label>Position</Label>
          <Select label="Position" value={config.position ?? "center"} onChange={(v) => onUpdate("position", v)} options={[["center", "Diagonal across the page"], ["top", "Top centre"], ["bottom", "Bottom centre"], ["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]]} />
          <div className="grid grid-cols-3 gap-1.5">
            <Input type="number" min={4} value={config.font_size ?? ""} onChange={(e) => onUpdate("font_size", e.target.value)} placeholder="Size" aria-label="Font size" size="sm" />
            <Input type="number" min={0.05} max={1} step={0.05} value={config.opacity ?? ""} onChange={(e) => onUpdate("opacity", e.target.value)} placeholder="Opacity" aria-label="Opacity" size="sm" />
            <Input value={config.color ?? ""} onChange={(e) => onUpdate("color", e.target.value)} placeholder="#999999" aria-label="Colour" size="sm" className="font-mono" />
          </div>
        </>
      )}
      {op === "rotate" && (
        <>
          <Label>Degrees</Label>
          <Segmented label="Degrees" value={String(config.degrees ?? 90)} onChange={(v) => onUpdate("degrees", Number(v))} options={[["90", "90°"], ["180", "180°"], ["270", "270°"]]} />
        </>
      )}
      {op === "fill_form" && (
        <>
          <Label>Fields</Label>
          {fields.map((f, i) => (
            <div key={i} className="flex gap-1.5 items-start">
              <Input value={f.name} onChange={(e) => { const u = [...fields]; u[i] = { ...u[i], name: e.target.value }; onUpdate("fields", u) }} placeholder="Field name" size="sm" className="font-mono flex-1 min-w-0" />
              <VariableInput value={f.value ?? ""} onChange={(v) => { const u = [...fields]; u[i] = { ...u[i], value: v }; onUpdate("fields", u) }} placeholder="{{value}}" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
              <RemoveButton label="Remove field" onClick={() => onUpdate("fields", fields.filter((_, j) => j !== i))} />
            </div>
          ))}
          <AddButton onClick={() => onUpdate("fields", [...fields, { name: "", value: "" }])}>Add field</AddButton>
          <Label>Or all values at once</Label>
          <VariableInput value={config.field_values ?? ""} onChange={(v) => onUpdate("field_values", v)} placeholder="{{applicant}} (an object: field name → value)" extraVariables={extraVariables} />
          <Toggle checked={Boolean(config.flatten)} onChange={(v) => onUpdate("flatten", v)} label="Flatten (make the form read-only)" />
          <Toggle checked={Boolean(config.strict)} onChange={(v) => onUpdate("strict", v)} label="Fail when a field does not exist" />
          <Hint>Use Read form fields first to see the names. Checkboxes take true / false, radio groups and dropdowns an option.</Hint>
        </>
      )}
      {!["page_count", "read_form"].includes(op) && <OutputName {...props} placeholder={op === "merge" ? "merged" : "<source>-…"} />}
      <OutputVar config={config} onUpdate={onUpdate} fallback={op === "page_count" ? "page_count" : op === "read_form" ? "form" : op === "split" ? "pdf_files" : "pdf_file"} />
    </>
  )
}

/* ── Extract ───────────────────────────────────────────────────────── */

function useTables() {
  return useQuery({
    queryKey: ["doc-extract-tables", "columns"],
    queryFn: async () => ((await serverRead("automations.tableOptions", { columns: true })).data ?? []) as Array<{ id: string; name: string; columns?: Array<{ key: string; label?: string }> }>,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

function ExtractPanel(props: PanelProps) {
  const { config, onUpdate, onBatchUpdate, extraVariables } = props
  const patterns = (Array.isArray(config.patterns) ? config.patterns : []) as Array<{ name: string; pattern: string; group?: string; all?: boolean }>
  const mapping = (Array.isArray(config.column_mapping) ? config.column_mapping : []) as Array<{ column: string; field: string }>
  const tables = useTables()
  const table = (tables.data ?? []).find((t) => t.id === config.table_id)
  const columns = Array.isArray(table?.columns) ? table!.columns : []
  return (
    <>
      <FileSource {...props} />
      <Toggle checked={config.extract_tables !== false} onChange={(v) => onUpdate("extract_tables", v)} label="Tables (Word, PDF, HTML, Markdown; spreadsheet sheets)" />
      <Label>Rows from</Label>
      <Input value={config.table_index ?? ""} onChange={(e) => onUpdate("table_index", e.target.value)} placeholder="First table (or 2, or all)" size="sm" />
      <Label>Key values (regular expressions)</Label>
      {patterns.map((p, i) => (
        <Card key={i} variant="inset" padding="sm" className="space-y-1.5">
          <div className="flex gap-1.5">
            <Input value={p.name} onChange={(e) => { const u = [...patterns]; u[i] = { ...u[i], name: e.target.value.replace(/[^\w]/g, "_") }; onUpdate("patterns", u) }} placeholder="invoice_number" aria-label="Value name" size="sm" className="font-mono w-1/3" />
            <Input value={p.pattern} onChange={(e) => { const u = [...patterns]; u[i] = { ...u[i], pattern: e.target.value }; onUpdate("patterns", u) }} placeholder="Invoice\s*#?\s*(\w+)" aria-label="Pattern" size="sm" className="font-mono flex-1 min-w-0" />
            <RemoveButton label="Remove pattern" onClick={() => onUpdate("patterns", patterns.filter((_, j) => j !== i))} />
          </div>
          <Toggle checked={Boolean(p.all)} onChange={(v) => { const u = [...patterns]; u[i] = { ...u[i], all: v }; onUpdate("patterns", u) }} label="Every match (a list)" />
        </Card>
      ))}
      <AddButton onClick={() => onUpdate("patterns", [...patterns, { name: "", pattern: "" }])}>Add pattern</AddButton>
      <Hint>The first capture group is returned (or the whole match). Patterns match within one line.</Hint>
      <Label>Find</Label>
      <Chips label="Finders" value={Array.isArray(config.finders) ? config.finders : []} onChange={(v) => onUpdate("finders", v)} options={[["emails", "Emails"], ["urls", "URLs"], ["phones", "Phone numbers"], ["dates", "Dates"], ["amounts", "Amounts"], ["percentages", "Percentages"]]} />
      {Array.isArray(config.finders) && config.finders.includes("dates") && (
        <Select label="Date order" value={config.date_order ?? "DMY"} onChange={(v) => onUpdate("date_order", v)} options={[["DMY", "Day first (31/12/2026)"], ["MDY", "Month first (12/31/2026)"]]} />
      )}
      <Card variant="inset" padding="sm" className="space-y-2">
        <Toggle checked={Boolean(config.to_table)} onChange={(v) => onUpdate("to_table", v)} label="Insert the rows into a data table" />
        {config.to_table && (
          <>
            <AutocompleteSelect
              value={config.table_id ?? ""}
              onChange={(id) => onBatchUpdate({ table_id: id, table_name: (tables.data ?? []).find((t) => t.id === id)?.name ?? "" })}
              options={(tables.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
              placeholder={tables.isLoading ? "Loading tables…" : "Choose a data table"}
            />
            <Label>Column mapping</Label>
            {mapping.map((m, i) => (
              <div key={i} className="flex gap-1.5 items-center">
                <UiSelect size="sm" wrapperClassName="flex-1 min-w-0" aria-label="Table column" value={m.column} onChange={(e) => { const u = [...mapping]; u[i] = { ...u[i], column: e.target.value }; onUpdate("column_mapping", u) }}>
                  <option value="">Column…</option>
                  {columns.map((c) => <option key={c.key} value={c.key}>{c.label ?? c.key}</option>)}
                </UiSelect>
                <span className="text-xs text-fg-muted" aria-hidden="true">←</span>
                <Input value={m.field} onChange={(e) => { const u = [...mapping]; u[i] = { ...u[i], field: e.target.value }; onUpdate("column_mapping", u) }} placeholder="Source header" aria-label="Source header" size="sm" className="flex-1 min-w-0" />
                <RemoveButton label="Remove mapping" onClick={() => onUpdate("column_mapping", mapping.filter((_, j) => j !== i))} />
              </div>
            ))}
            <AddButton onClick={() => onUpdate("column_mapping", [...mapping, { column: "", field: "" }])}>Map a column</AddButton>
            <Hint>Without a mapping, headers that match a column&apos;s key or label (ignoring case and spaces) are used. At most 5,000 rows per run; each insert fires the table&apos;s row-created workflows.</Hint>
          </>
        )}
      </Card>
      <Section title="Spreadsheet and PDF options">
        <Label>Sheet</Label>
        <VariableInput value={config.sheet ?? ""} onChange={(v) => onUpdate("sheet", v)} placeholder="All sheets" extraVariables={extraVariables} />
        <Label>Pages</Label>
        <VariableInput value={config.pages ?? ""} onChange={(v) => onUpdate("pages", v)} placeholder="All pages" extraVariables={extraVariables} />
        <OcrOptions {...props} />
      </Section>
      <OutputVar config={config} onUpdate={onUpdate} fallback="extracted" />
    </>
  )
}

/* ── Redact / detect sensitive information ──────────────────────────── */

const STYLE_OPTIONS: Array<[string, string]> = [["block", "█████"], ["label", "[SSN]"], ["partial", "███-1120"], ["hash", "Hash"], ["text", "Custom"]]

function useAgents() {
  return useQuery({
    queryKey: ["agents-for-config"],
    queryFn: async () => ((await serverRead("automations.agentOptions")).data ?? []) as Array<{ id: string; name: string; is_active: boolean }>,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

function InfoTypePicker({ config, onUpdate, onBatchUpdate }: PanelProps) {
  const raw = (Array.isArray(config.info_types) ? config.info_types : []) as string[]
  const regions = (Array.isArray(config.regions) ? config.regions : []) as string[]
  const selected = new Set(resolveInfoTypes(raw, regions))
  const visible = PATTERN_INFO_TYPES.filter((t) => inRegions(t, regions))
  const setTypes = (ids: string[]) => onUpdate("info_types", PATTERN_INFO_TYPES.map((t) => t.id).filter((id) => ids.includes(id)))
  const toggle = (id: string, on: boolean) => setTypes(on ? [...selected, id] : [...selected].filter((x) => x !== id))
  const quick = raw.includes("@high") ? "high" : raw.includes("*") ? "all" : ""
  return (
    <div className="space-y-1.5">
      <Label>Information types</Label>
      <div className="flex flex-wrap gap-1">
        <button type="button" aria-pressed={quick === "high"} onClick={() => onBatchUpdate({ info_types: ["@high"], min_confidence: "high" })}
          className={chipClass(quick === "high")}>
          All high-confidence types
        </button>
        <button type="button" aria-pressed={quick === "all"} onClick={() => onUpdate("info_types", ["*"])}
          className={chipClass(quick === "all")}>
          Every type
        </button>
        {selected.size > 0 && <Button type="button" variant="ghost" size="sm" className="h-auto py-0.5" onClick={() => onUpdate("info_types", [])}>Clear ({selected.size})</Button>}
      </div>
      <Label>Regions</Label>
      <Chips label="Regions" value={regions} onChange={(v) => onUpdate("regions", v)} options={INFO_REGIONS.filter((r) => r.id !== "global").map((r) => [r.id, r.label])} />
      <Hint>No region chosen: every region. Global types (cards, IBANs, emails, dates of birth, keys…) always apply.</Hint>
      {INFO_CATEGORIES.map((cat) => {
        const types = visible.filter((t) => t.category === cat.id)
        if (!types.length) return null
        const on = types.filter((t) => selected.has(t.id)).length
        return (
          <details key={cat.id} className="rounded-lg border border-border px-2 py-1.5" open={cat.id === "identity" && on > 0}>
            <summary className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-fg">
              <span className="flex-1">{cat.label}</span>
              <span className="text-2xs font-normal text-fg-muted num">{on}/{types.length}</span>
            </summary>
            <div className="space-y-1 pt-1.5">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg">
                <Checkbox checked={on === types.length} ref={(el) => { if (el) el.indeterminate = on > 0 && on < types.length }}
                  onChange={(e) => setTypes(e.target.checked ? [...selected, ...types.map((t) => t.id)] : [...selected].filter((id) => !types.some((t) => t.id === id)))} />
                All {cat.label.toLowerCase()}
              </label>
              {types.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-start gap-2 text-xs text-fg" title={`${t.format}. ${t.validation}.`}>
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
      <Label>Minimum confidence</Label>
      <Segmented label="Minimum confidence" value={config.min_confidence ?? "medium"} onChange={(v) => onUpdate("min_confidence", v)} options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} />
      <Hint>High: a check digit passed or a context word (&quot;SSN&quot;, &quot;DOB&quot;, &quot;IRD&quot;) is next to it. Low adds bare numbers that only pass a checksum — more matches, more false positives.</Hint>
    </div>
  )
}

function RedactPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const patterns = (Array.isArray(config.patterns) ? config.patterns : []) as Array<{ pattern: string }>
  const detect = config.mode === "detect_only"
  const ov = config.output_var || (detect ? "detected" : "redacted")
  const types = resolveInfoTypes(Array.isArray(config.info_types) ? config.info_types : [], Array.isArray(config.regions) ? config.regions : [])
  const styles = (config.styles && typeof config.styles === "object" ? config.styles : {}) as Record<string, string>
  const agents = useAgents()
  return (
    <>
      <FileSource {...props} />
      <Label>Action</Label>
      <Segmented label="Action" value={detect ? "detect_only" : "redact"} onChange={(v) => onUpdate("mode", v)} options={[["redact", "Redact a copy"], ["detect_only", "Detect only (no changes)"]]} />
      <InfoTypePicker {...props} />
      {Array.isArray(config.presets) && config.presets.length > 0 && (
        <>
          <Label>Presets</Label>
          <Chips label="Presets" value={config.presets} onChange={(v) => onUpdate("presets", v)} options={[["email", "Emails"], ["phone", "Phone numbers"], ["credit_card", "Card numbers"], ["iban", "IBANs"], ["ssn", "US SSNs"], ["ip_address", "IP addresses"], ["url", "URLs"], ["date", "Dates"]]} />
          <Hint>The original presets keep working; the information types above cover them with checks and confidence.</Hint>
        </>
      )}
      <Label>Words and phrases</Label>
      <VariableInput value={config.terms ?? ""} onChange={(v) => onUpdate("terms", v)} placeholder="Project Falcon, {{customer.name}}" extraVariables={extraVariables} />
      <Label>Patterns</Label>
      {patterns.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={p.pattern} onChange={(e) => { const u = [...patterns]; u[i] = { pattern: e.target.value }; onUpdate("patterns", u) }} placeholder="ACC-\d{6}" aria-label="Pattern" size="sm" className="font-mono flex-1 min-w-0" />
          <RemoveButton label="Remove pattern" onClick={() => onUpdate("patterns", patterns.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onUpdate("patterns", [...patterns, { pattern: "" }])}>Add pattern</AddButton>
      <Section title="AI: names and addresses (optional)">
        <Toggle checked={Boolean(config.ai_detection)} onChange={(v) => onUpdate("ai_detection", v)} label="Use AI to find names of people and addresses" />
        {config.ai_detection && (
          <>
            <Label>Agent (its model is used)</Label>
            <Select label="Agent" value={config.ai_agent_id ?? ""} onChange={(v) => onUpdate("ai_agent_id", v)} options={[["", agents.isLoading ? "Loading…" : "Choose an agent"], ...(agents.data ?? []).filter((a) => a.is_active !== false).map((a) => [a.id, a.name] as [string, string])]} />
          </>
        )}
        <Hint>Probabilistic: the model&apos;s judgement, not a pattern, so check the findings. The first 40,000 characters are sent to the agent&apos;s model provider. Off by default.</Hint>
      </Section>
      {!detect && (
        <>
          <Label>Replace with</Label>
          <Segmented label="Replacement" value={config.replacement ?? "block"} onChange={(v) => onUpdate("replacement", v)} options={STYLE_OPTIONS} />
          {config.replacement === "text" && <Input value={config.replacement_text ?? ""} onChange={(e) => onUpdate("replacement_text", e.target.value)} placeholder="[REDACTED]" aria-label="Replacement text" size="sm" />}
          {config.replacement === "hash" && <Hint>A short keyed hash per value (<code>[SSN:3f9a0c21b7]</code>): the same value gets the same token across this workspace&apos;s documents, so you can still match records.</Hint>}
          {types.length > 0 && (
            <Section title={`Style per type${Object.keys(styles).length ? ` (${Object.keys(styles).length})` : ""}`}>
              {types.map((id) => (
                <div key={id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-fg">{INFO_TYPE_BY_ID[id]?.label ?? id}</span>
                  <UiSelect aria-label={`Style for ${INFO_TYPE_BY_ID[id]?.label ?? id}`} value={styles[id] ?? ""} onChange={(e) => { const next = { ...styles }; if (e.target.value) next[id] = e.target.value; else delete next[id]; onUpdate("styles", next) }} size="sm" wrapperClassName="w-32 shrink-0">
                    <option value="">Default</option>
                    <option value="block">Mask █</option>
                    <option value="label">[{INFO_TYPE_BY_ID[id]?.token ?? id.toUpperCase()}]</option>
                    <option value="partial">Keep last 4</option>
                    <option value="hash">Hash</option>
                  </UiSelect>
                </div>
              ))}
            </Section>
          )}
        </>
      )}
      <Toggle checked={Boolean(config.include_values)} onChange={(v) => onUpdate("include_values", v)} label="Include the values in the findings variable" />
      <Hint>Off: each finding&apos;s <code>text</code> is masked (•••-••-••••). The run history and Save &amp; Test always show masked findings and counts, never the values.</Hint>
      <OcrOptions {...props} />
      {!detect && (
        <>
          <Label>Redacted copy</Label>
          <Select label="Output format" value={config.output ?? "same"} onChange={(v) => onUpdate("output", v)} options={[["same", "Same format (Word, PowerPoint, Excel, text formats)"], ["pdf", "PDF"], ["html", "HTML"], ["text", "Plain text"]]} />
          <Hint>Word, PowerPoint and Excel copies keep their formatting. PDFs are rebuilt from the redacted text, so nothing redacted can be recovered from them, but their layout is not kept.</Hint>
          <Toggle checked={config.clear_author !== false} onChange={(v) => onUpdate("clear_author", v)} label="Clear the author in the file properties" />
          <OutputName {...props} placeholder="<source>-redacted" />
        </>
      )}
      <OutputVar config={config} onUpdate={onUpdate} fallback={detect ? "detected" : "redacted"} />
      <Hint>
        Loop over <code>{`{{${ov}_findings}}`}</code> (type, confidence, page / sheet / slide, masked context) or branch on <code>{`{{${ov}.counts_by_type.us_ssn}}`}</code>{detect ? "" : <>; the copy is <code>{`{{${ov}_file}}`}</code></>}.
      </Hint>
    </>
  )
}

/* ── Inspect ───────────────────────────────────────────────────────── */

function InspectPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const op = config.operation ?? "all"
  return (
    <>
      <FileSource {...props} />
      <Label>Inspect</Label>
      <Select label="Inspect" value={op} onChange={(v) => onUpdate("operation", v)} options={[["all", "Everything (type, checksum, counts)"], ["detect", "File type (from the content)"], ["checksum", "Checksum"], ["stats", "Word and character counts, reading time"], ["search", "Search with context"]]} />
      {(op === "all" || op === "checksum") && (
        <>
          <Label>Algorithms</Label>
          <Chips label="Checksum algorithms" value={Array.isArray(config.algorithms) ? config.algorithms : ["sha256"]} onChange={(v) => onUpdate("algorithms", v)} options={[["sha256", "SHA-256"], ["sha512", "SHA-512"], ["sha1", "SHA-1"], ["md5", "MD5"]]} />
        </>
      )}
      {(op === "search" || op === "all") && (
        <>
          <Label>Search for</Label>
          <VariableInput value={config.query ?? ""} onChange={(v) => onUpdate("query", v)} placeholder="termination" extraVariables={extraVariables} />
          <div className="grid grid-cols-2 gap-1">
            <Toggle checked={Boolean(config.whole_word)} onChange={(v) => onUpdate("whole_word", v)} label="Whole words" />
            <Toggle checked={Boolean(config.case_sensitive)} onChange={(v) => onUpdate("case_sensitive", v)} label="Match case" />
            <Toggle checked={Boolean(config.regex)} onChange={(v) => onUpdate("regex", v)} label="Regular expression" />
          </div>
          <Label>Context characters</Label>
          <Input type="number" min={0} max={500} value={config.context_chars ?? ""} onChange={(e) => onUpdate("context_chars", e.target.value)} placeholder="60" size="sm" />
        </>
      )}
      <OutputVar config={config} onUpdate={onUpdate} fallback="inspection" />
    </>
  )
}

const PANELS: Record<string, (p: PanelProps) => React.ReactElement> = {
  doc_read: ReadPanel,
  doc_compare: ComparePanel,
  doc_convert: ConvertPanel,
  doc_pdf: PdfPanel,
  doc_extract: ExtractPanel,
  doc_redact: RedactPanel,
  doc_inspect: InspectPanel,
}

export function isDocumentActionPanel(type: string): boolean {
  return type in PANELS
}

export function DocumentActionConfig(props: PanelProps) {
  const Panel = PANELS[props.type]
  if (!Panel) return null
  return (
    <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
      <Panel {...props} />
    </div>
  )
}
