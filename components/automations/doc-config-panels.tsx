"use client"

import { useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { VariableInput } from "./variable-input"
import { Plus, Search, Loader2 } from "lucide-react"
import { serverRead } from "@/lib/server-read"

interface DocConfigProps {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}

// ─── Shared: Template Source ───
function TemplateSource({ config, onUpdate }: DocConfigProps) {
  return (
    <>
      <label className="block text-xs font-medium">Template Source</label>
      <select value={config.source_mode ?? "url"} onChange={e => onUpdate("source_mode", e.target.value)}
        className="w-full rounded-lg border px-2 py-1.5 text-xs"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
        <option value="url">File URL</option>
        <option value="ref">File Reference (from API / workflow)</option>
        <option value="table">Data Table (query by ID)</option>
      </select>

      {config.source_mode === 'table' ? (
        <TableRowPicker config={config} onUpdate={onUpdate} />
      ) : (
        <>
          <label className="block text-xs font-medium">
            {config.source_mode === 'ref' ? 'File Variable' : 'Template URL'}
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
      <label className="block text-xs font-medium">Output Filename</label>
      <VariableInput
        value={config.output_filename ?? ''}
        onChange={v => onUpdate("output_filename", v)}
        placeholder={defaultName}
      />
      <label className="block text-xs font-medium">Output Variable</label>
      <Input value={config.output_var ?? ''} onChange={e => onUpdate("output_var", e.target.value)}
        placeholder="doc_file" className="!text-xs font-mono" />
    </>
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
      <label className="block text-xs font-medium">Find & Replace</label>
      <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
        Type the exact text to find in the document e.g. [TITLE], {'{{CompanyName}}'}, %placeholder% — it is matched as written (not resolved). Replace accepts expressions.
      </p>
      {pairs.map((p, i) => (
        <div key={i} className="flex gap-1.5">
          <Input value={p.find} onChange={e => update(i, 'find', e.target.value)} placeholder="Find placeholder" className="!text-xs font-mono flex-1 min-w-0" />
          <VariableInput value={p.replace} onChange={v => update(i, 'replace', v)} placeholder="Replace with" />
          <button onClick={() => onUpdate("replacements", pairs.filter((_, j) => j !== i))}
            className="text-xs px-1 shrink-0 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
        </div>
      ))}
      <button onClick={() => onUpdate("replacements", [...pairs, { find: '', replace: '' }])}
        className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: 'var(--theme-primary-text)' }}>
        <Plus size={10} /> Add pair
      </button>
    </>
  )
}

// ─── Shared: Table data entries ───
function TableEntries({ config, onUpdate }: DocConfigProps) {
  const tables = (config.tables ?? [{ placeholder: '', data_var: '' }]) as { placeholder: string; data_var: string }[]
  return (
    <>
      <label className="block text-xs font-medium">Tables</label>
      <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
        Use {'{{#placeholder}}...{{/placeholder}}'} loop tags in your template for tables.
      </p>
      {tables.map((t, i) => (
        <div key={i} className="flex gap-1.5">
          <VariableInput value={t.placeholder} onChange={v => { const u = [...tables]; u[i] = { ...u[i], placeholder: v }; onUpdate("tables", u) }} placeholder="Placeholder tag" />
          <VariableInput value={t.data_var} onChange={v => { const u = [...tables]; u[i] = { ...u[i], data_var: v }; onUpdate("tables", u) }} placeholder="{{json_array}}" />
          <button onClick={() => onUpdate("tables", tables.filter((_, j) => j !== i))}
            className="text-xs px-1 shrink-0 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
        </div>
      ))}
      <button onClick={() => onUpdate("tables", [...tables, { placeholder: '', data_var: '' }])}
        className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: 'var(--theme-primary-text)' }}>
        <Plus size={10} /> Add table
      </button>
    </>
  )
}

// ─── Shared: List entries ───
function ListEntries({ config, onUpdate }: DocConfigProps) {
  const lists = (config.lists ?? [{ placeholder: '', items_var: '', delimiter: 'linebreak' }]) as { placeholder: string; items_var: string; delimiter: string }[]
  return (
    <>
      <label className="block text-xs font-medium">Lists</label>
      {lists.map((l, i) => (
        <div key={i} className="space-y-1 rounded-lg p-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
          <div className="flex gap-1.5">
            <VariableInput value={l.placeholder} onChange={v => { const u = [...lists]; u[i] = { ...u[i], placeholder: v }; onUpdate("lists", u) }} placeholder="Placeholder" />
            <VariableInput value={l.items_var} onChange={v => { const u = [...lists]; u[i] = { ...u[i], items_var: v }; onUpdate("lists", u) }} placeholder="{{items}}" />
            <button onClick={() => onUpdate("lists", lists.filter((_, j) => j !== i))}
              className="text-xs px-1 shrink-0 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
          </div>
          <select value={l.delimiter ?? 'linebreak'} onChange={e => { const u = [...lists]; u[i] = { ...u[i], delimiter: e.target.value }; onUpdate("lists", u) }}
            className="w-full rounded border px-2 py-1 text-[10px]" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
            <option value="linebreak">Line break separated</option>
            <option value="comma">Comma separated</option>
            <option value="semicolon">Semicolon separated</option>
          </select>
        </div>
      ))}
      <button onClick={() => onUpdate("lists", [...lists, { placeholder: '', items_var: '', delimiter: 'linebreak' }])}
        className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: 'var(--theme-primary-text)' }}>
        <Plus size={10} /> Add list
      </button>
    </>
  )
}

// ─── Shared: Image entries ───
function ImageEntries({ config, onUpdate }: DocConfigProps) {
  const images = (config.images ?? [{ placeholder: '', image_url: '' }]) as { placeholder: string; image_url: string; width_px?: number; height_px?: number }[]
  return (
    <>
      <label className="block text-xs font-medium">Images</label>
      {images.map((img, i) => (
        <div key={i} className="space-y-1 rounded-lg p-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
          <div className="flex gap-1.5">
            <VariableInput value={img.placeholder} onChange={v => { const u = [...images]; u[i] = { ...u[i], placeholder: v }; onUpdate("images", u) }} placeholder="Placeholder" />
            <VariableInput value={img.image_url} onChange={v => { const u = [...images]; u[i] = { ...u[i], image_url: v }; onUpdate("images", u) }} placeholder="{{image_url}}" />
            <button onClick={() => onUpdate("images", images.filter((_, j) => j !== i))}
              className="text-xs px-1 shrink-0 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
          </div>
          <div className="flex gap-1.5">
            <Input type="number" value={img.width_px ?? ''} onChange={e => { const u = [...images]; u[i] = { ...u[i], width_px: Number(e.target.value) || undefined }; onUpdate("images", u) }}
              placeholder="Width (px)" className="!text-[10px] flex-1" />
            <Input type="number" value={img.height_px ?? ''} onChange={e => { const u = [...images]; u[i] = { ...u[i], height_px: Number(e.target.value) || undefined }; onUpdate("images", u) }}
              placeholder="Height (px)" className="!text-[10px] flex-1" />
          </div>
        </div>
      ))}
      <button onClick={() => onUpdate("images", [...images, { placeholder: '', image_url: '' }])}
        className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: 'var(--theme-primary-text)' }}>
        <Plus size={10} /> Add image
      </button>
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
      <label className="block text-xs font-medium">Replacements</label>
      <div className="flex gap-0.5 rounded-lg p-0.5" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <button type="button" onClick={() => onUpdate("fr_input_mode", "pairs")}
          className="flex-1 text-[10px] font-medium py-1.5 px-2 rounded transition-colors"
          style={{ backgroundColor: inputMode === 'pairs' ? 'var(--theme-card-bg)' : 'transparent', color: inputMode === 'pairs' ? 'var(--theme-card-text)' : 'var(--theme-muted-text)', boxShadow: inputMode === 'pairs' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>
          Find &amp; Replace Pairs
        </button>
        <button type="button" onClick={() => onUpdate("fr_input_mode", "json")}
          className="flex-1 text-[10px] font-medium py-1.5 px-2 rounded transition-colors"
          style={{ backgroundColor: inputMode === 'json' ? 'var(--theme-card-bg)' : 'transparent', color: inputMode === 'json' ? 'var(--theme-card-text)' : 'var(--theme-muted-text)', boxShadow: inputMode === 'json' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none' }}>
          JSON Body
        </button>
      </div>

      {inputMode === 'pairs' ? (
        <FindReplacePairs config={config} onUpdate={onUpdate} />
      ) : (
        <>
          <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
            Keys are the find placeholders, values are the replacements.
          </p>
          <textarea
            value={typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}
            onChange={e => validateJson(e.target.value)}
            placeholder={'{\n  "[TITLE]": "My Document",\n  "[DATE]": "2026-03-30"\n}'}
            rows={6}
            spellCheck={false}
            className="w-full rounded-lg border px-2 py-1.5 text-xs font-mono"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: jsonError ? '#ef4444' : 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          />
          {jsonError && <p className="text-[9px] text-red-500">Invalid JSON: {jsonError}</p>}
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
      <label className="block text-xs font-medium">Table</label>
      <select value={config.table_id ?? ''} onChange={e => { onUpdate("table_id", e.target.value); onUpdate("table_row_id", ''); setOpen(false) }}
        className="w-full rounded-lg border px-2 py-1.5 text-xs"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
        <option value="">Select table...</option>
        {tables?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      {config.table_id && (
        <>
          <label className="block text-xs font-medium">Row ID</label>
          <div className="flex gap-1.5">
            <VariableInput
              value={config.table_row_id ?? ''}
              onChange={v => onUpdate("table_row_id", v)}
              placeholder="{{row_id}} or pick below"
            />
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="shrink-0 rounded-lg border px-2 py-1 text-[10px] hover:opacity-70"
              style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-primary-text)' }}>
              {open ? 'Close' : 'Browse'}
            </button>
          </div>

          {selectedRow && !open && (
            <div className="text-[9px] rounded-lg px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
              Selected: {selectedRow.id.slice(0, 8)} — {new Date(selectedRow.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
              {new Date(selectedRow.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          {open && (
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by ID, data..."
                  className="w-full border-b pl-7 pr-2 py-1.5 text-[10px]"
                  style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
                />
              </div>
              <div className="max-h-48 overflow-y-auto overflow-x-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-4 gap-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    <Loader2 size={12} className="animate-spin" /> Loading rows...
                  </div>
                ) : filteredRows.length === 0 ? (
                  <div className="py-3 text-center text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    {search ? 'No matching rows' : 'No rows in table'}
                  </div>
                ) : (
                  <table className="w-full min-w-[420px] text-[10px]">
                    <thead>
                      <tr style={{ backgroundColor: 'var(--theme-surface)' }}>
                        <th className="px-2 py-1 text-left font-medium" style={{ color: 'var(--theme-muted-text)' }}>ID</th>
                        <th className="px-2 py-1 text-left font-medium" style={{ color: 'var(--theme-muted-text)' }}>Created</th>
                        <th className="px-2 py-1 text-left font-medium" style={{ color: 'var(--theme-muted-text)' }}>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map(r => (
                        <tr key={r.id}
                          className="cursor-pointer hover:opacity-80"
                          style={{ borderTop: '1px solid var(--theme-surface-border)', backgroundColor: config.table_row_id === r.id ? 'var(--theme-primary-light)' : undefined }}
                          onClick={() => { onUpdate("table_row_id", r.id); setOpen(false) }}>
                          <td className="px-2 py-1 font-mono" style={{ color: 'var(--theme-muted-text)' }}>{r.id.slice(0, 8)}</td>
                          <td className="px-2 py-1 whitespace-nowrap" style={{ color: 'var(--theme-muted-text)' }}>
                            {new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{' '}
                            {new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-2 py-1 truncate max-w-[200px]">
                            {Object.entries(r.data).filter(([k]) => k !== 'id' && k !== 'Date Created').slice(0, 3).map(([k, v]) => (
                              <span key={k} className="mr-1.5">
                                <span style={{ color: 'var(--theme-muted-text)' }}>{k}:</span>{' '}
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
              {!loading && <div className="text-[9px] px-2 py-1 border-t" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
                {filteredRows.length} of {rows.length} rows
              </div>}
            </div>
          )}

          <label className="block text-xs font-medium">File Column</label>
          {fileColumns.length > 0 ? (
            <select value={config.table_file_column ?? ''} onChange={e => onUpdate("table_file_column", e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
              <option value="">Select file column...</option>
              {fileColumns.map((c: any) => <option key={c.key ?? c.name} value={c.key ?? c.name}>{c.label ?? c.name ?? c.key}</option>)}
            </select>
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
    <div className="flex gap-0.5 flex-wrap">
      {modes.map(m => (
        <button key={m.value} type="button" onClick={() => onChange(m.value)}
          className="text-[10px] font-medium py-1.5 px-2 rounded transition-colors"
          style={{ backgroundColor: current === m.value ? 'var(--theme-primary)' : 'var(--theme-surface)', color: current === m.value ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
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
        { value: 'find_replace', label: 'Find & Replace' },
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
      <label className="block text-xs font-medium">{valueField === 'value' ? 'Cell Values' : 'Cell Text'}</label>
      {cells.map((c: any, i: number) => (
        <div key={i} className="flex gap-1">
          <Input value={c.cell ?? ''} onChange={e => { const u = [...cells]; u[i] = { ...u[i], cell: e.target.value }; onUpdate("cells", u) }}
            placeholder="A1" className="!text-[10px] font-mono w-14" />
          <VariableInput value={c[valueField] ?? ''} onChange={v => { const u = [...cells]; u[i] = { ...u[i], [valueField]: v }; onUpdate("cells", u) }}
            placeholder={valueField === 'value' ? '{{number}}' : '{{text}}'} />
          <Input value={c.sheet ?? ''} onChange={e => { const u = [...cells]; u[i] = { ...u[i], sheet: e.target.value }; onUpdate("cells", u) }}
            placeholder="Sheet" className="!text-[10px] font-mono w-16" />
          <button onClick={() => onUpdate("cells", cells.filter((_: any, j: number) => j !== i))}
            className="text-xs px-1 shrink-0 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
        </div>
      ))}
      <button onClick={() => onUpdate("cells", [...cells, { cell: '', [valueField]: '', sheet: '' }])}
        className="text-[10px] hover:opacity-70 flex items-center gap-1" style={{ color: 'var(--theme-primary-text)' }}>
        <Plus size={10} /> Add cell
      </button>
    </>
  )
}

export function DocExcelConfig({ config, onUpdate }: DocConfigProps) {
  const mode = config.mode ?? 'find_replace'
  return (
    <div className="space-y-2" onPointerDown={e => e.stopPropagation()}>
      <ModeToggle current={mode} onChange={v => onUpdate("mode", v)} modes={[
        { value: 'find_replace', label: 'Find & Replace' },
        { value: 'update_cell_text', label: 'Cell Text' },
        { value: 'update_cell_value', label: 'Cell Value' },
        { value: 'insert_data', label: 'Insert Data' },
      ]} />
      <TemplateSource config={config} onUpdate={onUpdate} />
      {mode === 'find_replace' && (
        <>
          <FindReplaceSection config={config} onUpdate={onUpdate} />
          <label className="block text-xs font-medium">Sheet (optional)</label>
          <Input value={config.sheet ?? ''} onChange={e => onUpdate("sheet", e.target.value)}
            placeholder="All sheets" className="!text-xs font-mono" />
        </>
      )}
      {mode === 'update_cell_text' && <CellEntries config={config} onUpdate={onUpdate} valueField="text" />}
      {mode === 'update_cell_value' && <CellEntries config={config} onUpdate={onUpdate} valueField="value" />}
      {mode === 'insert_data' && (
        <>
          <label className="block text-xs font-medium">Data Variable (JSON array)</label>
          <VariableInput value={config.data_var ?? ''} onChange={v => onUpdate("data_var", v)} placeholder="{{json_array}}" />
          <label className="block text-xs font-medium">Start Cell</label>
          <Input value={config.placeholder ?? ''} onChange={e => onUpdate("placeholder", e.target.value)}
            placeholder="A1" className="!text-xs font-mono" />
          <label className="block text-xs font-medium">Sheet (optional)</label>
          <Input value={config.sheet ?? ''} onChange={e => onUpdate("sheet", e.target.value)}
            placeholder="First sheet" className="!text-xs font-mono" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={config.include_headers !== false}
              onChange={e => onUpdate("include_headers", e.target.checked)} />
            Include headers
          </label>
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
        { value: 'find_replace', label: 'Find & Replace' },
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
