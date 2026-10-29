"use client"

/**
 * Designer settings for the document actions (lib/documents): Read, Compare,
 * Convert, PDF tools, Extract, Redact and Inspect. Config keys match
 * lib/documents/handlers.ts; docs at /docs/workflows/documents.
 */

import { useQuery } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { AutocompleteSelect } from "@/components/ui/autocomplete-select"
import { serverRead } from "@/lib/server-read"
import { VariableInput } from "./variable-input"

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

interface PanelProps {
  type: string
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables?: { name: string; group: string; label?: string }[]
}

const selectStyle = { backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }
const muted = { color: "var(--theme-muted-text)" }

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="block text-xs font-medium">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] leading-snug" style={muted}>{children}</p>
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 text-xs" style={selectStyle}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  )
}

function Segmented({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; label: string }) {
  return (
    <div className="flex flex-wrap gap-0.5" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className="flex-1 min-w-[3rem] text-[10px] font-medium py-1.5 px-1 rounded transition-colors"
          style={{ backgroundColor: value === v ? "var(--theme-primary)" : "var(--theme-surface)", color: value === v ? "var(--theme-on-primary)" : "var(--theme-muted-text)" }}>
          {l}
        </button>
      ))}
    </div>
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
            className="text-[10px] font-medium px-2 py-1 rounded-full border transition-colors"
            style={{ borderColor: on ? "var(--theme-primary)" : "var(--theme-surface-border)", backgroundColor: on ? "var(--theme-primary)" : "transparent", color: on ? "var(--theme-on-primary)" : "var(--theme-muted-text)" }}>
            {l}
          </button>
        )
      })}
    </div>
  )
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
      <Input value={config.output_var ?? ""} onChange={(e) => onUpdate("output_var", e.target.value.replace(/[^\w]/g, ""))} placeholder={fallback} className="!text-xs font-mono" />
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
          <Input value={config.ocr_languages ?? ""} onChange={(e) => onUpdate("ocr_languages", e.target.value)} placeholder="eng (eng+deu for several)" className="!text-xs font-mono" aria-label="OCR languages" />
          <Hint>Each page reports a confidence (0–100). The provider and page limit are instance settings (DOCUMENT_OCR_PROVIDER, DOCUMENT_OCR_MAX_PAGES).</Hint>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border px-2 py-1.5" style={{ borderColor: "var(--theme-surface-border)" }}>
      <summary className="text-xs font-medium cursor-pointer select-none">{title}</summary>
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
        <Input type="number" min={1} value={config.max_rows ?? ""} onChange={(e) => onUpdate("max_rows", e.target.value ? Number(e.target.value) : "")} placeholder="All" className="!text-xs" />
      </Section>
      <Section title="Content options">
        <Toggle checked={config.include_tables !== false} onChange={(v) => onUpdate("include_tables", v)} label="Tables (and tables found in text PDFs)" />
        <Toggle checked={Boolean(config.include_images)} onChange={(v) => onUpdate("include_images", v)} label="List embedded images" />
        <Label>Tracked changes (Word)</Label>
        <Select label="Tracked changes" value={config.tracked_changes ?? "accept"} onChange={(v) => onUpdate("tracked_changes", v)} options={[["accept", "Read as accepted"], ["show", "Show insertions and deletions"]]} />
        <Label>Max characters</Label>
        <Input type="number" min={1000} value={config.max_chars ?? ""} onChange={(e) => onUpdate("max_chars", e.target.value ? Number(e.target.value) : "")} placeholder="2,000,000" className="!text-xs" />
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
          <Input type="number" step="any" min={0} value={config.numeric_tolerance ?? ""} onChange={(e) => onUpdate("numeric_tolerance", e.target.value)} placeholder="0" className="!text-xs" />
        </Section>
      )}
      {mode === "json" && (
        <>
          <Label>Match list items by</Label>
          <Input value={config.array_key ?? ""} onChange={(e) => onUpdate("array_key", e.target.value)} placeholder="id (empty = position)" className="!text-xs font-mono" />
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
          <Input type="number" min={1} value={config.every_n ?? ""} onChange={(e) => onUpdate("every_n", e.target.value ? Number(e.target.value) : "")} placeholder="1" className="!text-xs" />
        </>
      )}
      {op === "watermark" && (
        <>
          <Label>Text</Label>
          <VariableInput value={config.text ?? ""} onChange={(v) => onUpdate("text", v)} placeholder="CONFIDENTIAL or Approved {{=TODAY()}}" extraVariables={extraVariables} />
          <Label>Position</Label>
          <Select label="Position" value={config.position ?? "center"} onChange={(v) => onUpdate("position", v)} options={[["center", "Diagonal across the page"], ["top", "Top centre"], ["bottom", "Bottom centre"], ["top-left", "Top left"], ["top-right", "Top right"], ["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"]]} />
          <div className="grid grid-cols-3 gap-1.5">
            <Input type="number" min={4} value={config.font_size ?? ""} onChange={(e) => onUpdate("font_size", e.target.value)} placeholder="Size" aria-label="Font size" className="!text-xs" />
            <Input type="number" min={0.05} max={1} step={0.05} value={config.opacity ?? ""} onChange={(e) => onUpdate("opacity", e.target.value)} placeholder="Opacity" aria-label="Opacity" className="!text-xs" />
            <Input value={config.color ?? ""} onChange={(e) => onUpdate("color", e.target.value)} placeholder="#999999" aria-label="Colour" className="!text-xs font-mono" />
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
              <Input value={f.name} onChange={(e) => { const u = [...fields]; u[i] = { ...u[i], name: e.target.value }; onUpdate("fields", u) }} placeholder="Field name" className="!text-xs font-mono flex-1 min-w-0" />
              <VariableInput value={f.value ?? ""} onChange={(v) => { const u = [...fields]; u[i] = { ...u[i], value: v }; onUpdate("fields", u) }} placeholder="{{value}}" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
              <button type="button" aria-label="Remove field" onClick={() => onUpdate("fields", fields.filter((_, j) => j !== i))} className="p-1 hover:opacity-70" style={muted}><X size={12} /></button>
            </div>
          ))}
          <button type="button" onClick={() => onUpdate("fields", [...fields, { name: "", value: "" }])} className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: "var(--theme-primary-text)" }}><Plus size={10} /> Add field</button>
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
      <Input value={config.table_index ?? ""} onChange={(e) => onUpdate("table_index", e.target.value)} placeholder="First table (or 2, or all)" className="!text-xs" />
      <Label>Key values (regular expressions)</Label>
      {patterns.map((p, i) => (
        <div key={i} className="space-y-1 rounded-lg p-2" style={{ backgroundColor: "var(--theme-surface)" }}>
          <div className="flex gap-1.5">
            <Input value={p.name} onChange={(e) => { const u = [...patterns]; u[i] = { ...u[i], name: e.target.value.replace(/[^\w]/g, "_") }; onUpdate("patterns", u) }} placeholder="invoice_number" aria-label="Value name" className="!text-xs font-mono w-1/3" />
            <Input value={p.pattern} onChange={(e) => { const u = [...patterns]; u[i] = { ...u[i], pattern: e.target.value }; onUpdate("patterns", u) }} placeholder="Invoice\s*#?\s*(\w+)" aria-label="Pattern" className="!text-xs font-mono flex-1 min-w-0" />
            <button type="button" aria-label="Remove pattern" onClick={() => onUpdate("patterns", patterns.filter((_, j) => j !== i))} className="p-1 hover:opacity-70" style={muted}><X size={12} /></button>
          </div>
          <Toggle checked={Boolean(p.all)} onChange={(v) => { const u = [...patterns]; u[i] = { ...u[i], all: v }; onUpdate("patterns", u) }} label="Every match (a list)" />
        </div>
      ))}
      <button type="button" onClick={() => onUpdate("patterns", [...patterns, { name: "", pattern: "" }])} className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: "var(--theme-primary-text)" }}><Plus size={10} /> Add pattern</button>
      <Hint>The first capture group is returned (or the whole match). Patterns match within one line.</Hint>
      <Label>Find</Label>
      <Chips label="Finders" value={Array.isArray(config.finders) ? config.finders : []} onChange={(v) => onUpdate("finders", v)} options={[["emails", "Emails"], ["urls", "URLs"], ["phones", "Phone numbers"], ["dates", "Dates"], ["amounts", "Amounts"], ["percentages", "Percentages"]]} />
      {Array.isArray(config.finders) && config.finders.includes("dates") && (
        <Select label="Date order" value={config.date_order ?? "DMY"} onChange={(v) => onUpdate("date_order", v)} options={[["DMY", "Day first (31/12/2026)"], ["MDY", "Month first (12/31/2026)"]]} />
      )}
      <div className="rounded-lg border px-2 py-2 space-y-2" style={{ borderColor: "var(--theme-surface-border)" }}>
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
                <select aria-label="Table column" value={m.column} onChange={(e) => { const u = [...mapping]; u[i] = { ...u[i], column: e.target.value }; onUpdate("column_mapping", u) }} className="flex-1 min-w-0 rounded border px-1.5 py-1 text-[11px]" style={selectStyle}>
                  <option value="">Column…</option>
                  {columns.map((c) => <option key={c.key} value={c.key}>{c.label ?? c.key}</option>)}
                </select>
                <span className="text-[10px]" style={muted}>←</span>
                <Input value={m.field} onChange={(e) => { const u = [...mapping]; u[i] = { ...u[i], field: e.target.value }; onUpdate("column_mapping", u) }} placeholder="Source header" aria-label="Source header" className="!text-xs flex-1 min-w-0" />
                <button type="button" aria-label="Remove mapping" onClick={() => onUpdate("column_mapping", mapping.filter((_, j) => j !== i))} className="p-1 hover:opacity-70" style={muted}><X size={12} /></button>
              </div>
            ))}
            <button type="button" onClick={() => onUpdate("column_mapping", [...mapping, { column: "", field: "" }])} className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: "var(--theme-primary-text)" }}><Plus size={10} /> Map a column</button>
            <Hint>Without a mapping, headers that match a column&apos;s key or label (ignoring case and spaces) are used. At most 5,000 rows per run; each insert fires the table&apos;s row-created workflows.</Hint>
          </>
        )}
      </div>
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

/* ── Redact ────────────────────────────────────────────────────────── */

function RedactPanel(props: PanelProps) {
  const { config, onUpdate, extraVariables } = props
  const patterns = (Array.isArray(config.patterns) ? config.patterns : []) as Array<{ pattern: string }>
  return (
    <>
      <FileSource {...props} />
      <Label>Remove</Label>
      <Chips label="Presets" value={Array.isArray(config.presets) ? config.presets : []} onChange={(v) => onUpdate("presets", v)} options={[["email", "Emails"], ["phone", "Phone numbers"], ["credit_card", "Card numbers"], ["iban", "IBANs"], ["ssn", "US SSNs"], ["ip_address", "IP addresses"], ["url", "URLs"], ["date", "Dates"]]} />
      <Label>Words and phrases</Label>
      <VariableInput value={config.terms ?? ""} onChange={(v) => onUpdate("terms", v)} placeholder="Project Falcon, {{customer.name}}" extraVariables={extraVariables} />
      <Label>Patterns</Label>
      {patterns.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={p.pattern} onChange={(e) => { const u = [...patterns]; u[i] = { pattern: e.target.value }; onUpdate("patterns", u) }} placeholder="ACC-\d{6}" aria-label="Pattern" className="!text-xs font-mono flex-1 min-w-0" />
          <button type="button" aria-label="Remove pattern" onClick={() => onUpdate("patterns", patterns.filter((_, j) => j !== i))} className="p-1 hover:opacity-70" style={muted}><X size={12} /></button>
        </div>
      ))}
      <button type="button" onClick={() => onUpdate("patterns", [...patterns, { pattern: "" }])} className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: "var(--theme-primary-text)" }}><Plus size={10} /> Add pattern</button>
      <Label>Replace with</Label>
      <Segmented label="Replacement" value={config.replacement ?? "block"} onChange={(v) => onUpdate("replacement", v)} options={[["block", "█████"], ["label", "[EMAIL]"], ["text", "Custom"]]} />
      {config.replacement === "text" && <Input value={config.replacement_text ?? ""} onChange={(e) => onUpdate("replacement_text", e.target.value)} placeholder="[REDACTED]" aria-label="Replacement text" className="!text-xs" />}
      <Label>Redacted copy</Label>
      <Select label="Output format" value={config.output ?? "same"} onChange={(v) => onUpdate("output", v)} options={[["same", "Same format (Word, PowerPoint, Excel, text formats)"], ["pdf", "PDF"], ["html", "HTML"], ["text", "Plain text"]]} />
      <Hint>Word, PowerPoint and Excel copies keep their formatting. PDFs are rebuilt from the redacted text, so nothing redacted can be recovered from them, but their layout is not kept.</Hint>
      <Toggle checked={config.clear_author !== false} onChange={(v) => onUpdate("clear_author", v)} label="Clear the author in the file properties" />
      <OutputName {...props} placeholder="<source>-redacted" />
      <OutputVar config={config} onUpdate={onUpdate} fallback="redacted" />
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
          <Input type="number" min={0} max={500} value={config.context_chars ?? ""} onChange={(e) => onUpdate("context_chars", e.target.value)} placeholder="60" className="!text-xs" />
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
