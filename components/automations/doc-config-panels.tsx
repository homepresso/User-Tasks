"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Card } from "@/components/ui/card"
import { VariableInput } from "./variable-input"
import { Plus, Search, Loader2, X } from "lucide-react"
import { serverRead } from "@/lib/server-read"
import { formatDate, formatDay, formatTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"

interface DocConfigProps {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}

const labelClass = "block text-xs font-medium text-fg"
const hintClass = "text-xs text-fg-muted"

/** One option of a mode switch: neutral track, the selected option lifted. */
function modeOptionClass(selected: boolean) {
  return cn(
    "rounded-[calc(var(--ds-radius-sm)-2px)] px-2 py-1 text-xs font-medium transition-colors",
    selected ? "bg-panel text-fg shadow-elev-1" : "text-fg-muted hover:text-fg",
  )
}

// ─── Shared: Template Source ───
function TemplateSource({ config, onUpdate }: DocConfigProps) {
  return (
    <>
      <label className={labelClass}>Template source</label>
      <Select size="sm" value={config.source_mode ?? "url"} onChange={e => onUpdate("source_mode", e.target.value)}>
        <option value="url">File URL</option>
        <option value="ref">File reference (from API / workflow)</option>
        <option value="table">Data table (query by ID)</option>
      </Select>

      {config.source_mode === 'table' ? (
        <TableRowPicker config={config} onUpdate={onUpdate} />
      ) : (
        <>
          <label className={labelClass}>
            {config.source_mode === 'ref' ? 'File variable' : 'Template URL'}
          </label>
          <VariableInput
            value={config.template_url ?? ''}
            onChange={v => onUpdate("template_url", v)}
            placeholder={config.source_mode === 'ref' ? '{{api_file}}' : 'https://...'}
          />
        </>
      )}
    </>
  )
}

// ─── Shared: Output ───
function OutputConfig({ config, onUpdate, defaultName }: DocConfigProps & { defaultName: string }) {
  return (
    <>
      <label className={labelClass}>Output filename</label>
      <VariableInput
        value={config.output_filename ?? ''}
        onChange={v => onUpdate("output_filename", v)}
        placeholder={defaultName}
      />
      <label className={labelClass}>Output variable</label>
      <Input size="sm" value={config.output_var ?? ''} onChange={e => onUpdate("output_var", e.target.value)}
        placeholder="doc_file" className="font-mono" />
    </>
  )
}

/** "Add …" text action under a repeated list. */
function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="link" size="sm" leadingIcon={<Plus />} onClick={onClick}>
      {children}
    </Button>
  )
}

// ─── Shared: Find/Replace pairs ───
function FindReplacePairs({ config, onUpdate }: DocConfigProps) {
  const pairs = (config.replacements ?? [{ find: '', replace: '' }]) as { find: string; replace: string }[]
  function update(idx: number, field: 'find' | 'replace', value: string) {
    const updated = [...pairs]; updated[idx] = { ...updated[idx], [field]: value }
    onUpdate("replacements", updated)
  }
  return (
    <>
      <label className={labelClass}>Find &amp; replace</label>
      <p className={hintClass}>
        Type the exact text to find in the document e.g. [TITLE], {'{{CompanyName}}'}, %placeholder% — it is matched as written (not resolved). Replace accepts expressions.
      </p>
      {pairs.map((p, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <Input size="sm" value={p.find} onChange={e => update(i, 'find', e.target.value)} placeholder="Find placeholder" className="font-mono flex-1 min-w-0" />
          <VariableInput value={p.replace} onChange={v => update(i, 'replace', v)} placeholder="Replace with" />
          <IconButton size="sm" label="Remove pair" icon={<X />} onClick={() => onUpdate("replacements", pairs.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onUpdate("replacements", [...pairs, { find: '', replace: '' }])}>Add pair</AddButton>
    </>
  )
}

// ─── Shared: Table data entries ───
function TableEntries({ config, onUpdate }: DocConfigProps) {
  const tables = (config.tables ?? [{ placeholder: '', data_var: '' }]) as { placeholder: string; data_var: string }[]
  return (
    <>
      <label className={labelClass}>Tables</label>
      <p className={hintClass}>
        Use {'{{#placeholder}}...{{/placeholder}}'} loop tags in your template for tables.
      </p>
      {tables.map((t, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <VariableInput value={t.placeholder} onChange={v => { const u = [...tables]; u[i] = { ...u[i], placeholder: v }; onUpdate("tables", u) }} placeholder="Placeholder tag" />
          <VariableInput value={t.data_var} onChange={v => { const u = [...tables]; u[i] = { ...u[i], data_var: v }; onUpdate("tables", u) }} placeholder="{{json_array}}" />
          <IconButton size="sm" label="Remove table" icon={<X />} onClick={() => onUpdate("tables", tables.filter((_, j) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onUpdate("tables", [...tables, { placeholder: '', data_var: '' }])}>Add table</AddButton>
    </>
  )
}

// ─── Shared: List entries ───
function ListEntries({ config, onUpdate }: DocConfigProps) {
  const lists = (config.lists ?? [{ placeholder: '', items_var: '', delimiter: 'linebreak' }]) as { placeholder: string; items_var: string; delimiter: string }[]
  return (
    <>
      <label className={labelClass}>Lists</label>
      {lists.map((l, i) => (
        <Card key={i} variant="inset" padding="sm" className="space-y-1.5">
          <div className="flex items-start gap-1.5">
            <VariableInput value={l.placeholder} onChange={v => { const u = [...lists]; u[i] = { ...u[i], placeholder: v }; onUpdate("lists", u) }} placeholder="Placeholder" />
            <VariableInput value={l.items_var} onChange={v => { const u = [...lists]; u[i] = { ...u[i], items_var: v }; onUpdate("lists", u) }} placeholder="{{items}}" />
            <IconButton size="sm" label="Remove list" icon={<X />} onClick={() => onUpdate("lists", lists.filter((_, j) => j !== i))} />
          </div>
          <Select size="sm" value={l.delimiter ?? 'linebreak'} onChange={e => { const u = [...lists]; u[i] = { ...u[i], delimiter: e.target.value }; onUpdate("lists", u) }}>
            <option value="linebreak">Line break separated</option>
            <option value="comma">Comma separated</option>
            <option value="semicolon">Semicolon separated</option>
          </Select>
        </Card>
      ))}
      <AddButton onClick={() => onUpdate("lists", [...lists, { placeholder: '', items_var: '', delimiter: 'linebreak' }])}>Add list</AddButton>
    </>
  )
}

// ─── Shared: Image entries ───
function ImageEntries({ config, onUpdate }: DocConfigProps) {
  const images = (config.images ?? [{ placeholder: '', image_url: '' }]) as { placeholder: string; image_url: string; width_px?: number; height_px?: number }[]
  return (
    <>
      <label className={labelClass}>Images</label>
      {images.map((img, i) => (
        <Card key={i} variant="inset" padding="sm" className="space-y-1.5">
          <div className="flex items-start gap-1.5">
            <VariableInput value={img.placeholder} onChange={v => { const u = [...images]; u[i] = { ...u[i], placeholder: v }; onUpdate("images", u) }} placeholder="Placeholder" />
            <VariableInput value={img.image_url} onChange={v => { const u = [...images]; u[i] = { ...u[i], image_url: v }; onUpdate("images", u) }} placeholder="{{image_url}}" />
            <IconButton size="sm" label="Remove image" icon={<X />} onClick={() => onUpdate("images", images.filter((_, j) => j !== i))} />
          </div>
          <div className="flex gap-1.5">
            <Input size="sm" type="number" value={img.width_px ?? ''} onChange={e => { const u = [...images]; u[i] = { ...u[i], width_px: Number(e.target.value) || undefined }; onUpdate("images", u) }}
              placeholder="Width (px)" className="flex-1" />
            <Input size="sm" type="number" value={img.height_px ?? ''} onChange={e => { const u = [...images]; u[i] = { ...u[i], height_px: Number(e.target.value) || undefined }; onUpdate("images", u) }}
              placeholder="Height (px)" className="flex-1" />
          </div>
        </Card>
      ))}
      <AddButton onClick={() => onUpdate("images", [...images, { placeholder: '', image_url: '' }])}>Add image</AddButton>
    </>
  )
}

// ─── Shared: Find & Replace Section (tabbed: Pairs | JSON Body) ───
function FindReplaceSection({ config, onUpdate }: DocConfigProps) {
  const inputMode = config.fr_input_mode ?? 'pairs'
  const [jsonError, setJsonError] = useState<string | null>(null)
  const raw = config.json_body ?? ''

  function validateJson(v: string) {
    onUpdate("json_body", v)
    if (!v.trim()) { setJsonError(null); return }
    try { JSON.parse(v); setJsonError(null) } catch (e: any) { setJsonError(e.message) }
  }

  return (
    <>
      <label className={labelClass}>Replacements</label>
      <div className="flex gap-0.5 rounded-md bg-muted p-0.5">
        <button type="button" onClick={() => onUpdate("fr_input_mode", "pairs")} aria-pressed={inputMode === 'pairs'}
          className={cn("flex-1", modeOptionClass(inputMode === 'pairs'))}>
          Find &amp; replace pairs
        </button>
        <button type="button" onClick={() => onUpdate("fr_input_mode", "json")} aria-pressed={inputMode === 'json'}
          className={cn("flex-1", modeOptionClass(inputMode === 'json'))}>
          JSON body
        </button>
      </div>

      {inputMode === 'pairs' ? (
        <FindReplacePairs config={config} onUpdate={onUpdate} />
      ) : (
        <>
          <p className={hintClass}>
            Keys are the find placeholders, values are the replacements.
          </p>
          <Textarea
            value={typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}
            onChange={e => validateJson(e.target.value)}
            placeholder={'{\n  "[TITLE]": "My Document",\n  "[DATE]": "2026-03-30"\n}'}
            rows={6}
            spellCheck={false}
            aria-invalid={jsonError ? true : undefined}
            className="text-xs font-mono"
          />
          {jsonError && <p className="text-xs text-danger">Invalid JSON: {jsonError}</p>}
        </>
      )}
    </>
  )
}

// ─── Shared: Table Row Search/Picker ───
function TableRowPicker({ config, onUpdate }: DocConfigProps) {
  const [tables, setTables] = useState<{ id: string; name: string; columns: any[] }[] | null>(null)
  const [rows, setRows] = useState<{ id: string; data: Record<string, any>; created_at: string }[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!tables) {
      serverRead('automations.tableOptions', { columns: true }).then(({ data }) => {
        setTables((data ?? []) as any)
      })
    }
  }, [tables])

  useEffect(() => {
    void (async () => {
      if (!config.table_id) { setRows([]); return }
      setLoading(true)
      const { data } = await serverRead('automations.tableRows', { tableId: config.table_id, withCreatedAt: true, limit: 500 })
      setRows((data ?? []) as any)
      setLoading(false)
    })()
  }, [config.table_id])

  const selectedTable = tables?.find(t => t.id === config.table_id)
  const fileColumns = selectedTable
    ? ((selectedTable.columns ?? []) as any[]).filter((c: any) => c.type === 'file')
    : []

  const filteredRows = rows.filter(r => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return r.id.toLowerCase().includes(q) ||
      Object.values(r.data).some(v => String(v ?? '').toLowerCase().includes(q))
  })

  const selectedRow = rows.find(r => r.id === config.table_row_id)

  return (
    <>
      <label className={labelClass}>Table</label>
      <Select size="sm" value={config.table_id ?? ''} onChange={e => { onUpdate("table_id", e.target.value); onUpdate("table_row_id", ''); setOpen(false) }}>
        <option value="">Select table...</option>
        {tables?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </Select>

      {config.table_id && (
        <>
          <label className={labelClass}>Row ID</label>
          <div className="flex items-start gap-1.5">
            <VariableInput
              value={config.table_row_id ?? ''}
              onChange={v => onUpdate("table_row_id", v)}
              placeholder="{{row_id}} or pick below"
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(!open)}>
              {open ? 'Close' : 'Browse'}
            </Button>
          </div>

          {selectedRow && !open && (
            <div className="rounded-md bg-subtle px-2 py-1 text-xs text-fg-muted">
              Selected: <span className="font-mono">{selectedRow.id.slice(0, 8)}</span> — {formatDate(selectedRow.created_at)}{' '}
              {formatTime(selectedRow.created_at)}
            </div>
          )}

          {open && (
            <div className="overflow-hidden rounded-lg border border-border bg-panel">
              <Input
                size="sm"
                leading={<Search />}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by ID, data..."
                className="rounded-none border-0 border-b border-border-subtle hover:border-border-subtle"
              />
              <div className="max-h-48 overflow-y-auto overflow-x-auto">
                {loading ? (
                  <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-fg-muted">
                    <Loader2 size={14} className="animate-spin" /> Loading rows...
                  </div>
                ) : filteredRows.length === 0 ? (
                  <div className="py-3 text-center text-xs text-fg-muted">
                    {search ? 'No matching rows' : 'No rows in table'}
                  </div>
                ) : (
                  <table className="w-full min-w-[420px] text-xs">
                    <thead>
                      <tr className="bg-subtle">
                        <th className="px-2 py-1 text-left font-medium text-fg-muted">ID</th>
                        <th className="px-2 py-1 text-left font-medium text-fg-muted">Created</th>
                        <th className="px-2 py-1 text-left font-medium text-fg-muted">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map(r => (
                        <tr key={r.id}
                          className={cn("cursor-pointer border-t border-border-subtle", config.table_row_id === r.id ? "bg-primary-wash" : "hover:bg-subtle")}
                          onClick={() => { onUpdate("table_row_id", r.id); setOpen(false) }}>
                          <td className="px-2 py-1 font-mono text-fg-muted">{r.id.slice(0, 8)}</td>
                          <td className="px-2 py-1 whitespace-nowrap text-fg-muted num">
                            {formatDay(r.created_at)}{' '}
                            {formatTime(r.created_at)}
                          </td>
                          <td className="px-2 py-1 truncate max-w-[200px] text-fg">
                            {Object.entries(r.data).filter(([k]) => k !== 'id' && k !== 'Date Created').slice(0, 3).map(([k, v]) => (
                              <span key={k} className="mr-1.5">
                                <span className="text-fg-muted">{k}:</span>{' '}
                                {typeof v === 'object' && v?.name ? v.name : String(v ?? '').slice(0, 30)}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {!loading && <div className="border-t border-border-subtle px-2 py-1 text-xs text-fg-muted num">
                {filteredRows.length} of {rows.length} rows
              </div>}
            </div>
          )}

          <label className={labelClass}>File column</label>
          {fileColumns.length > 0 ? (
            <Select size="sm" value={config.table_file_column ?? ''} onChange={e => onUpdate("table_file_column", e.target.value)}>
              <option value="">Select file column...</option>
              {fileColumns.map((c: any) => <option key={c.key ?? c.name} value={c.key ?? c.name}>{c.label ?? c.name ?? c.key}</option>)}
            </Select>
          ) : (
            <VariableInput
              value={config.table_file_column ?? ''}
              onChange={v => onUpdate("table_file_column", v)}
              placeholder="column_name"
            />
          )}
        </>
      )}
    </>
  )
}

// ─── Mode toggle ───
function ModeToggle({ modes, current, onChange }: { modes: { value: string; label: string }[]; current: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-0.5 rounded-md bg-muted p-0.5">
      {modes.map(m => (
        <button key={m.value} type="button" onClick={() => onChange(m.value)} aria-pressed={current === m.value}
          className={cn("flex-1 whitespace-nowrap", modeOptionClass(current === m.value))}>
          {m.label}
        </button>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════
// WORD DOCUMENT CONFIG
// ═══════════════════════════════════════

export function DocWordConfig({ config, onUpdate }: DocConfigProps) {
  const mode = config.mode ?? 'find_replace'
  return (
    <div className="space-y-2" onPointerDown={e => e.stopPropagation()}>
      <ModeToggle current={mode} onChange={v => onUpdate("mode", v)} modes={[
        { value: 'find_replace', label: 'Find & replace' },
        { value: 'create_table', label: 'Tables' },
        { value: 'update_list', label: 'Lists' },
        { value: 'insert_image', label: 'Images' },
      ]} />
      <TemplateSource config={config} onUpdate={onUpdate} />
      {mode === 'find_replace' && <FindReplaceSection config={config} onUpdate={onUpdate} />}
      {mode === 'create_table' && <TableEntries config={config} onUpdate={onUpdate} />}
      {mode === 'update_list' && <ListEntries config={config} onUpdate={onUpdate} />}
      {mode === 'insert_image' && <ImageEntries config={config} onUpdate={onUpdate} />}
      <OutputConfig config={config} onUpdate={onUpdate} defaultName="document.docx" />
    </div>
  )
}

// ═══════════════════════════════════════
// EXCEL CONFIG
// ═══════════════════════════════════════

function CellEntries({ config, onUpdate, valueField }: DocConfigProps & { valueField: 'text' | 'value' }) {
  const cells = (config.cells ?? [{ cell: '', [valueField]: '', sheet: '' }]) as any[]
  return (
    <>
      <label className={labelClass}>{valueField === 'value' ? 'Cell values' : 'Cell text'}</label>
      {cells.map((c: any, i: number) => (
        <div key={i} className="flex items-start gap-1">
          <Input size="sm" value={c.cell ?? ''} onChange={e => { const u = [...cells]; u[i] = { ...u[i], cell: e.target.value }; onUpdate("cells", u) }}
            placeholder="A1" className="font-mono w-14" />
          <VariableInput value={c[valueField] ?? ''} onChange={v => { const u = [...cells]; u[i] = { ...u[i], [valueField]: v }; onUpdate("cells", u) }}
            placeholder={valueField === 'value' ? '{{number}}' : '{{text}}'} />
          <Input size="sm" value={c.sheet ?? ''} onChange={e => { const u = [...cells]; u[i] = { ...u[i], sheet: e.target.value }; onUpdate("cells", u) }}
            placeholder="Sheet" className="font-mono w-16" />
          <IconButton size="sm" label="Remove cell" icon={<X />} onClick={() => onUpdate("cells", cells.filter((_: any, j: number) => j !== i))} />
        </div>
      ))}
      <AddButton onClick={() => onUpdate("cells", [...cells, { cell: '', [valueField]: '', sheet: '' }])}>Add cell</AddButton>
    </>
  )
}

export function DocExcelConfig({ config, onUpdate }: DocConfigProps) {
  const mode = config.mode ?? 'find_replace'
  return (
    <div className="space-y-2" onPointerDown={e => e.stopPropagation()}>
      <ModeToggle current={mode} onChange={v => onUpdate("mode", v)} modes={[
        { value: 'find_replace', label: 'Find & replace' },
        { value: 'update_cell_text', label: 'Cell text' },
        { value: 'update_cell_value', label: 'Cell value' },
        { value: 'insert_data', label: 'Insert data' },
      ]} />
      <TemplateSource config={config} onUpdate={onUpdate} />
      {mode === 'find_replace' && (
        <>
          <FindReplaceSection config={config} onUpdate={onUpdate} />
          <label className={labelClass}>Sheet <span className="font-normal text-fg-muted">(optional)</span></label>
          <Input size="sm" value={config.sheet ?? ''} onChange={e => onUpdate("sheet", e.target.value)}
            placeholder="All sheets" className="font-mono" />
        </>
      )}
      {mode === 'update_cell_text' && <CellEntries config={config} onUpdate={onUpdate} valueField="text" />}
      {mode === 'update_cell_value' && <CellEntries config={config} onUpdate={onUpdate} valueField="value" />}
      {mode === 'insert_data' && (
        <>
          <label className={labelClass}>Data variable (JSON array)</label>
          <VariableInput value={config.data_var ?? ''} onChange={v => onUpdate("data_var", v)} placeholder="{{json_array}}" />
          <label className={labelClass}>Start cell</label>
          <Input size="sm" value={config.placeholder ?? ''} onChange={e => onUpdate("placeholder", e.target.value)}
            placeholder="A1" className="font-mono" />
          <label className={labelClass}>Sheet <span className="font-normal text-fg-muted">(optional)</span></label>
          <Input size="sm" value={config.sheet ?? ''} onChange={e => onUpdate("sheet", e.target.value)}
            placeholder="First sheet" className="font-mono" />
          <Checkbox label="Include headers" checked={config.include_headers !== false}
            onChange={e => onUpdate("include_headers", e.target.checked)} />
        </>
      )}
      <OutputConfig config={config} onUpdate={onUpdate} defaultName="spreadsheet.xlsx" />
    </div>
  )
}

// ═══════════════════════════════════════
// POWERPOINT CONFIG
// ═══════════════════════════════════════

export function DocPowerPointConfig({ config, onUpdate }: DocConfigProps) {
  const mode = config.mode ?? 'find_replace'
  return (
    <div className="space-y-2" onPointerDown={e => e.stopPropagation()}>
      <ModeToggle current={mode} onChange={v => onUpdate("mode", v)} modes={[
        { value: 'find_replace', label: 'Find & replace' },
        { value: 'update_table', label: 'Tables' },
        { value: 'update_list', label: 'Lists' },
        { value: 'insert_image', label: 'Images' },
      ]} />
      <TemplateSource config={config} onUpdate={onUpdate} />
      {mode === 'find_replace' && <FindReplaceSection config={config} onUpdate={onUpdate} />}
      {mode === 'update_table' && <TableEntries config={config} onUpdate={onUpdate} />}
      {mode === 'update_list' && <ListEntries config={config} onUpdate={onUpdate} />}
      {mode === 'insert_image' && <ImageEntries config={config} onUpdate={onUpdate} />}
      <OutputConfig config={config} onUpdate={onUpdate} defaultName="presentation.pptx" />
    </div>
  )
}
