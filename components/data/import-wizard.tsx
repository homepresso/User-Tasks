'use client'

/**
 * Import CSV / TSV / .xlsx into a data table (Import on a table's page) or
 * create a table from a file (Create from file on /data).
 *
 *   1. Upload — the file is read in the browser (lib/data-import: CSV here,
 *      .xlsx with ExcelJS loaded on demand): encoding, delimiter, sheet.
 *   2. Columns — headers auto-matched to columns; change, skip or create a
 *      column (Create from file: name and type per inferred column).
 *   3. Options — insert / upsert on a key / replace (typed confirmation),
 *      day/month order, trim, empty cells, workflow triggers.
 *   4. Check — every row validated with the code the server runs; error
 *      rows can be downloaded (formula-guarded CSV).
 *   5. Import — the `data.import` background job writes in batches
 *      (progress here and in the Jobs panel) and reports inserted / updated
 *      / skipped / failed. The server re-reads and re-validates the file.
 */

import { useMemo, useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Download, FileSpreadsheet, FileUp, Upload } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox, Radio } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Badge } from '@/components/ui/badge'
import { ProgressBar } from '@/components/ui/progress-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { useJobs } from '@/components/jobs/jobs-provider'
import { createTableFromFileAction } from '@/app/actions/data-import'
import { DATA_IMPORT_LIMITS, formatFromName, formatLimitBytes, ImportFileError, parseTextFile, type ImportDelimiter, type ImportEncoding, type ParsedImportFile } from '@/lib/data-import/parse'
import {
  autoMatchHeaders, checkUpsertKeys, DETECTED_LABELS, detectDateOrder, errorRowsTable, inferColumns, isImportableColumn, validateRows,
  type DateOrder, type EmptyCells, type ImportableColumnType, type ImportMapping, type ImportTargetColumn, type InferredColumn, type ValidationResult,
} from '@/lib/data-import/rows'
import { toCsv } from '@/lib/org/csv'
import type { UserJobView } from '@/lib/user-jobs/types'
import { cn } from '@/lib/utils'

type Step = 'upload' | 'columns' | 'options' | 'check' | 'import'
type Mode = 'insert' | 'upsert' | 'replace'

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'upload', label: 'Upload' },
  { id: 'columns', label: 'Columns' },
  { id: 'options', label: 'Options' },
  { id: 'check', label: 'Check' },
  { id: 'import', label: 'Import' },
]

const TYPE_OPTIONS: Array<{ value: ImportableColumnType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'select', label: 'Choice' },
]

const SKIP = '__skip__'
const NEW = '__new__'
const LIMITS_TEXT = `CSV, TSV or Excel (.xlsx), up to ${formatLimitBytes(DATA_IMPORT_LIMITS.maxBytes)} and ${DATA_IMPORT_LIMITS.maxRows.toLocaleString('en-US')} rows`

export interface ImportWizardTable {
  id: string
  name: string
  columns: Array<{ key?: string; name: string; type: string; required?: boolean; options?: string[] }>
}

interface ColumnPlan {
  header: string
  /** Existing column key, SKIP, or NEW. */
  target: string
  /** New column (or Create from file). */
  name: string
  type: ImportableColumnType
  options?: string[]
  inferred: InferredColumn
}

interface LoadedFile {
  file: File
  bytes: Uint8Array
  parsed: ParsedImportFile
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** gzip in the browser (CSV shrinks ~5–10×, so large files stay under hosted request limits); .xlsx is already compressed. */
async function uploadPayload(bytes: Uint8Array, format: string): Promise<string> {
  let body = bytes
  if (format !== 'xlsx' && typeof CompressionStream !== 'undefined') {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
    body = new Uint8Array(await new Response(stream).arrayBuffer())
  }
  let binary = ''
  for (let i = 0; i < body.length; i += 0x8000) binary += String.fromCharCode(...body.subarray(i, i + 0x8000))
  return btoa(binary)
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function defaultDateOrder(): DateOrder {
  if (typeof navigator === 'undefined') return 'mdy'
  return /^en-(US|PH)|^es-US/i.test(navigator.language) ? 'mdy' : 'dmy'
}

const ORDER_LABEL: Record<DateOrder, string> = { dmy: 'day/month/year', mdy: 'month/day/year', ymd: 'year-month-day' }

export function ImportWizard({ open, onOpenChange, table, createName }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Import into this table; omit for Create from file. */
  table?: ImportWizardTable
  /** Create from file: a suggested table name. */
  createName?: string
}) {
  const creating = !table
  const router = useRouter()
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const inputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [delimiter, setDelimiter] = useState<ImportDelimiter | 'auto'>('auto')
  const [encoding, setEncoding] = useState<ImportEncoding | 'auto'>('auto')
  const [sheet, setSheet] = useState<string | null>(null)
  const [tableName, setTableName] = useState(createName ?? '')

  const [plans, setPlans] = useState<ColumnPlan[]>([])
  const [mode, setMode] = useState<Mode>('insert')
  const [keyColumn, setKeyColumn] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [dateChoice, setDateChoice] = useState<DateOrder | 'auto'>('auto')
  const [trim, setTrim] = useState(true)
  const [emptyCells, setEmptyCells] = useState<EmptyCells>('empty')
  const [fireTriggers, setFireTriggers] = useState(true)

  const [job, setJob] = useState<UserJobView | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [createdTableId, setCreatedTableId] = useState<string | null>(null)

  const existingColumns: ImportTargetColumn[] = useMemo(() => (table?.columns ?? [])
    .filter((col) => col && (col.key || col.name))
    .map((col) => ({ key: String(col.key || col.name), name: col.name, type: col.type, required: col.required, options: col.options })), [table])
  const importable = useMemo(() => existingColumns.filter(isImportableColumn), [existingColumns])

  function reset() {
    setStep('upload'); setLoaded(null); setReadError(null); setPlans([]); setMode('insert'); setKeyColumn(''); setConfirmText('')
    setDateChoice('auto'); setTrim(true); setEmptyCells('empty'); setFireTriggers(true); setJob(null); setImportError(null)
    setImporting(false); setCreatedTableId(null); setDelimiter('auto'); setEncoding('auto'); setSheet(null); setTableName(createName ?? '')
  }

  function close(next: boolean) {
    onOpenChange(next)
    if (!next) {
      if (job && job.status === 'succeeded') void queryClient.invalidateQueries({ queryKey: ['custom-table-rows'] })
      setTimeout(reset, 200)
    }
  }

  // ── Reading ──
  async function parse(file: File, bytes: Uint8Array, opts: { delimiter?: ImportDelimiter | 'auto'; encoding?: ImportEncoding | 'auto'; sheet?: string | null } = {}) {
    const format = formatFromName(file.name)
    if (!format) throw new ImportFileError('Choose a .csv, .tsv or .xlsx file. (Older .xls workbooks: save as .xlsx first.)')
    if (format === 'xlsx') {
      const { parseXlsx } = await import('@/lib/data-import/xlsx')
      return parseXlsx(bytes, { sheet: opts.sheet ?? null })
    }
    return parseTextFile(bytes, { fileName: file.name, delimiter: opts.delimiter ?? 'auto', encoding: opts.encoding ?? 'auto' })
  }

  function plansFor(parsed: ParsedImportFile): ColumnPlan[] {
    const inferred = inferColumns(parsed.headers, parsed.rows, detectDateOrder(parsed.rows.flat(), defaultDateOrder()).order)
    const auto = creating ? {} as ImportMapping : autoMatchHeaders(parsed.headers, existingColumns)
    return inferred.map((col) => ({
      header: col.header,
      target: creating ? (col.detected === 'empty' ? SKIP : NEW) : auto[col.header] ?? SKIP,
      name: col.name,
      type: col.type,
      options: col.options,
      inferred: col,
    }))
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setReadError(null)
    setReading(true)
    try {
      if (file.size > DATA_IMPORT_LIMITS.maxBytes) throw new ImportFileError(`The file is ${formatLimitBytes(file.size)}; the limit is ${formatLimitBytes(DATA_IMPORT_LIMITS.maxBytes)}. Split it into smaller files.`)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = await parse(file, bytes)
      setLoaded({ file, bytes, parsed })
      setSheet(parsed.sheet ?? null)
      setDelimiter('auto'); setEncoding('auto')
      setPlans(plansFor(parsed))
      if (creating && !tableName.trim()) setTableName(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 100))
    } catch (error) {
      setLoaded(null)
      setReadError(error instanceof Error ? error.message : 'The file could not be read')
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function reparse(next: { delimiter?: ImportDelimiter | 'auto'; encoding?: ImportEncoding | 'auto'; sheet?: string | null }) {
    if (!loaded) return
    setReadError(null)
    try {
      const parsed = await parse(loaded.file, loaded.bytes, { delimiter: next.delimiter ?? delimiter, encoding: next.encoding ?? encoding, sheet: next.sheet ?? sheet })
      setLoaded({ ...loaded, parsed })
      setPlans(plansFor(parsed))
    } catch (error) {
      setReadError(error instanceof Error ? error.message : 'The file could not be read')
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    void onFile(event.dataTransfer.files?.[0])
  }

  // ── Derived: columns, mapping, validation ──
  const parsed = loaded?.parsed ?? null

  /** Columns the rows are validated against: existing + new (keys as the server will assign them). */
  const { columns, mapping, newColumns } = useMemo(() => {
    const keys = new Set<string>(['id', 'date_created', ...existingColumns.map((c) => c.key)])
    const fresh: Array<ImportTargetColumn & { header: string }> = []
    const map: ImportMapping = {}
    for (const plan of plans) {
      if (plan.target === SKIP) { map[plan.header] = null; continue }
      if (plan.target !== NEW) { map[plan.header] = plan.target; continue }
      const base = plan.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'column'
      let key = base
      for (let n = 2; keys.has(key); n++) key = `${base}_${n}`
      keys.add(key)
      fresh.push({ header: plan.header, key, name: plan.name.trim() || plan.header, type: plan.type, ...(plan.type === 'select' ? { options: plan.options ?? [] } : {}) })
      map[plan.header] = key
    }
    return { columns: [...existingColumns, ...fresh], mapping: map, newColumns: fresh }
  }, [plans, existingColumns])

  const mappedCount = Object.values(mapping).filter(Boolean).length
  const detectedOrder = useMemo(() => {
    if (!parsed) return null
    const dateIdx = parsed.headers.map((h, i) => ({ h, i })).filter(({ h }) => columns.find((c) => c.key === mapping[h])?.type === 'date')
    return detectDateOrder(dateIdx.flatMap(({ i }) => parsed.rows.map((r) => r[i])), defaultDateOrder())
  }, [parsed, columns, mapping])
  const dateOrder: DateOrder = dateChoice === 'auto' ? detectedOrder?.order ?? defaultDateOrder() : dateChoice
  const hasDateColumns = parsed ? parsed.headers.some((h) => columns.find((c) => c.key === mapping[h])?.type === 'date') : false

  const keyCandidates = useMemo(() => columns.filter((c) => Object.values(mapping).includes(c.key)), [columns, mapping])

  const validation: ValidationResult | null = useMemo(() => {
    if (!parsed || step === 'upload' || step === 'columns') return null
    let result = validateRows(parsed.headers, parsed.rows, columns, mapping, { trim, date_order: dateOrder, empty_cells: emptyCells })
    const key = mode === 'upsert' ? columns.find((c) => c.key === keyColumn) : undefined
    if (key) {
      const header = Object.entries(mapping).find(([, k]) => k === key.key)?.[0]
      if (header) result = checkUpsertKeys(result, key, header)
    }
    return result
  }, [parsed, step, columns, mapping, trim, dateOrder, emptyCells, mode, keyColumn])

  const preview = useMemo(() => {
    if (!parsed) return []
    const sample = validateRows(parsed.headers, parsed.rows.slice(0, 5), columns, mapping, { trim, date_order: dateOrder, empty_cells: 'empty' })
    return parsed.rows.slice(0, 5).map((cells, i) => ({ cells, data: sample.valid.find((v) => v.index === i)?.data ?? null }))
  }, [parsed, columns, mapping, trim, dateOrder])
  const previewColumns = columns.filter((c) => Object.values(mapping).includes(c.key))

  // ── Navigation guards ──
  const replaceConfirmed = mode !== 'replace' || confirmText.trim().toLowerCase() === (table?.name ?? '').trim().toLowerCase()
  const canNext: Record<Step, boolean> = {
    upload: Boolean(parsed) && (!creating || tableName.trim().length > 0),
    columns: mappedCount > 0 && newColumns.every((c) => c.name.trim()),
    options: (mode !== 'upsert' || Boolean(keyColumn)) && replaceConfirmed,
    check: Boolean(validation && validation.valid.length),
    import: false,
  }
  const index = STEPS.findIndex((s) => s.id === step)
  const go = (to: Step) => setStep(to)

  function downloadErrors() {
    if (!parsed || !validation) return
    const t = errorRowsTable(parsed.headers, parsed.rows, validation.errors)
    download(toCsv(t.headers, t.rows), `${(loaded?.file.name ?? 'import').replace(/\.[^.]+$/, '')}-errors.csv`)
  }

  // ── Import ──
  async function runImport() {
    if (!loaded || !parsed || !validation) return
    setImporting(true)
    setImportError(null)
    setStep('import')
    try {
      let targetId = table?.id ?? createdTableId
      let targetName = table?.name ?? tableName.trim()
      let jobMapping: ImportMapping = mapping
      let jobNewColumns = newColumns.filter((c) => !existingColumns.some((e) => e.key === c.key)).map((c) => ({ header: c.header, name: c.name, type: c.type as ImportableColumnType, ...(c.options ? { options: c.options } : {}) }))
      if (creating && !targetId) {
        // The table, with the inferred columns, first; then the rows.
        const created = await createTableFromFileAction({ name: tableName.trim(), columns: newColumns.map((c) => ({ key: c.key, name: c.name, type: c.type, ...(c.options ? { options: c.options } : {}) })) })
        if (!created.ok) throw new Error(created.error)
        if ('exists' in created.data) throw new Error(`A table named “${created.data.name}” already exists: choose another name.`)
        targetId = created.data.id
        targetName = created.data.name
        setCreatedTableId(targetId)
      }
      if (creating) {
        jobNewColumns = []
        jobMapping = mapping
      }
      const started = await jobs.start('data.import', {
        table_id: targetId,
        table_name: targetName,
        file_name: loaded.file.name,
        sheet: parsed.sheet ?? null,
        delimiter: parsed.delimiter ?? null,
        encoding: parsed.encoding ?? null,
        mapping: jobMapping,
        new_columns: jobNewColumns.length ? jobNewColumns : null,
        mode: creating ? 'insert' : mode,
        key_column: mode === 'upsert' ? keyColumn : null,
        confirm_replace: mode === 'replace' ? confirmText.trim() : null,
        date_order: dateOrder,
        trim,
        empty_cells: emptyCells,
        skip_invalid: validation.invalidRows.length > 0,
        fire_triggers: fireTriggers,
      }, {
        effect: 'change',
        quiet: true,
        input: { base64: await uploadPayload(loaded.bytes, parsed.format) },
      })
      if (!started) throw new Error('The import could not be started')
      setJob(started)
      const finished = started.status === 'queued' || started.status === 'running' ? await waitWithProgress(started.id) : started
      setJob(finished)
      if (finished.status === 'succeeded') {
        void queryClient.invalidateQueries({ queryKey: ['custom-table-rows', targetId] })
        void queryClient.invalidateQueries({ queryKey: ['custom-table', targetId] })
        void queryClient.invalidateQueries({ queryKey: ['custom-tables'] })
      } else if (finished.status === 'failed') setImportError(finished.error ?? 'The import failed')
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The import failed')
    } finally {
      setImporting(false)
    }
  }

  async function waitWithProgress(jobId: string): Promise<UserJobView> {
    const { getJobAction } = await import('@/app/actions/user-jobs')
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      const result = await getJobAction(jobId)
      if (!result.ok) throw new Error(result.error)
      setJob(result.data)
      if (result.data.status !== 'queued' && result.data.status !== 'running') return result.data
    }
  }

  const counts = (job?.result?.counts ?? {}) as Record<string, number>
  const doneTableId = table?.id ?? createdTableId
  const fileSize = loaded ? formatLimitBytes(loaded.file.size) : ''

  // ── Render ──
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        size="xl"
        title={creating ? 'Create a table from a file' : `Import into ${table?.name}`}
        description={LIMITS_TEXT}
        data-testid="import-wizard"
      >
        <ol className="flex shrink-0 gap-1 overflow-x-auto px-6 pt-3 text-xs max-sm:px-4" aria-label="Import steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1', i === index ? 'bg-primary-wash font-medium text-primary-text' : i < index ? 'text-fg' : 'text-fg-muted')} aria-current={i === index ? 'step' : undefined}>
              <span className={cn('grid size-4 place-items-center rounded-full text-2xs num', i <= index ? 'bg-primary text-primary-fg' : 'bg-muted text-fg-muted')}>{i + 1}</span>
              <span className={cn(i !== index && 'max-sm:sr-only')}>{s.label}</span>
            </li>
          ))}
        </ol>

        <DialogBody className="space-y-4" data-testid={`import-step-${step}`}>
          {step === 'upload' && (
            <>
              <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" data-testid="import-file" onChange={(e) => void onFile(e.target.files?.[0])} />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={cn('flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors', dragging ? 'border-primary bg-primary-wash' : 'border-border hover:border-border-strong hover:bg-muted/40')}
              >
                <FileUp className="size-6 text-fg-muted" aria-hidden="true" />
                <span className="text-sm font-medium text-fg">{reading ? 'Reading the file…' : loaded ? 'Choose another file' : 'Drop a file here, or click to choose'}</span>
                <span className="text-xs text-fg-muted">{LIMITS_TEXT}. The first row must be the column headers.</span>
              </button>
              {readError && <InlineNotice tone="danger" message={readError} />}
              {loaded && parsed && (
                <div className="space-y-3 rounded-lg border border-border-subtle bg-panel p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileSpreadsheet className="size-4 text-fg-muted" aria-hidden="true" />
                    <span className="font-medium text-fg">{loaded.file.name}</span>
                    <Badge>{fileSize}</Badge>
                    <Badge tone="info">{plural(parsed.rows.length, 'row')}</Badge>
                    <Badge>{plural(parsed.headers.length, 'column')}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {parsed.format === 'xlsx' ? (
                      <Field label="Sheet">
                        <Select value={sheet ?? ''} onChange={(e) => { setSheet(e.target.value); void reparse({ sheet: e.target.value }) }} options={(parsed.sheets ?? []).map((s) => ({ value: s, label: s }))} data-testid="import-sheet" />
                      </Field>
                    ) : (
                      <>
                        <Field label="Delimiter" description={delimiter === 'auto' ? `Detected: ${parsed.delimiter === '\t' ? 'tab' : parsed.delimiter === ';' ? 'semicolon' : 'comma'}` : undefined}>
                          <Select value={delimiter} onChange={(e) => { const v = e.target.value as ImportDelimiter | 'auto'; setDelimiter(v); void reparse({ delimiter: v }) }} options={[{ value: 'auto', label: 'Detect' }, { value: ',', label: 'Comma (,)' }, { value: ';', label: 'Semicolon (;)' }, { value: '\t', label: 'Tab' }]} />
                        </Field>
                        <Field label="Encoding" description={encoding === 'auto' ? `Detected: ${parsed.encoding === 'windows-1252' ? 'Windows-1252' : parsed.encoding?.toUpperCase()}` : undefined}>
                          <Select value={encoding} onChange={(e) => { const v = e.target.value as ImportEncoding | 'auto'; setEncoding(v); void reparse({ encoding: v }) }} options={[{ value: 'auto', label: 'Detect' }, { value: 'utf-8', label: 'UTF-8' }, { value: 'windows-1252', label: 'Windows-1252 (Western)' }, { value: 'utf-16le', label: 'UTF-16 LE' }, { value: 'utf-16be', label: 'UTF-16 BE' }]} />
                        </Field>
                      </>
                    )}
                  </div>
                  {creating && (
                    <Field label="Table name">
                      <Input value={tableName} onChange={(e) => setTableName(e.target.value)} maxLength={200} data-testid="import-table-name" />
                    </Field>
                  )}
                </div>
              )}
            </>
          )}

          {step === 'columns' && parsed && (
            <>
              <p className="text-ui text-fg-muted">
                {creating
                  ? 'Each file column becomes a table column. The types are inferred from the values; change a name or type, or leave a column out.'
                  : `Matched ${plural(mappedCount, 'column')} by name. Change a match, skip a column, or create a new one.`}
              </p>
              {/* A list (not a table): on a phone each file column stacks, with its control in view. */}
              <div role="list" aria-label="Column mapping" className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_8rem_minmax(18rem,1.6fr)] gap-3 bg-muted/40 px-3 py-2 text-xs font-medium text-fg-muted sm:grid" aria-hidden="true">
                  <span>File column</span><span>Sample</span><span>Detected</span><span>{creating ? 'Table column' : 'Import into'}</span>
                </div>
                {plans.map((plan, i) => {
                  const samples = parsed.rows.map((r) => r[i]).filter((v) => v && v.trim()).slice(0, 2)
                  const update = (patch: Partial<ColumnPlan>) => setPlans((all) => all.map((p, j) => (j === i ? { ...p, ...patch } : p)))
                  return (
                    <div role="listitem" key={plan.header} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_8rem_minmax(18rem,1.6fr)]" data-testid="import-mapping-row">
                      <span className="min-w-0 truncate font-medium text-fg" title={plan.header}>{plan.header}</span>
                      <span className="col-span-2 row-start-2 min-w-0 truncate text-xs text-fg-muted sm:col-span-1 sm:row-start-auto sm:text-ui" title={samples.join(' · ')}>{samples.join(' · ') || '—'}</span>
                      <span className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"><Badge tone={plan.inferred.detected === 'empty' ? 'neutral' : 'info'}>{DETECTED_LABELS[plan.inferred.detected]}</Badge></span>
                      <div className="col-span-2 min-w-0 sm:col-span-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {creating ? (
                            <Checkbox checked={plan.target !== SKIP} onChange={(e) => update({ target: e.target.checked ? NEW : SKIP })} aria-label={`Include ${plan.header}`} />
                          ) : (
                            <Select
                              size="sm"
                              wrapperClassName="w-full sm:w-48"
                              value={plan.target}
                              aria-label={`Import ${plan.header} into`}
                              onChange={(e) => update({ target: e.target.value })}
                            >
                              <option value={SKIP}>Skip</option>
                              {importable.map((col) => (
                                <option key={col.key} value={col.key} disabled={plans.some((p, j) => j !== i && p.target === col.key)}>{col.name}</option>
                              ))}
                              <option value={NEW}>+ New column…</option>
                            </Select>
                          )}
                          {plan.target === NEW && (
                            <>
                              <Input size="sm" className="w-auto min-w-0 flex-1 basis-32" value={plan.name} onChange={(e) => update({ name: e.target.value })} aria-label={`Name for ${plan.header}`} />
                              <Select size="sm" wrapperClassName="w-28 flex-none" value={plan.type} onChange={(e) => update({ type: e.target.value as ImportableColumnType })} options={TYPE_OPTIONS} aria-label={`Type for ${plan.header}`} />
                            </>
                          )}
                        </div>
                        {plan.target === NEW && plan.type === 'select' && (
                          <p className="mt-1 line-clamp-2 text-xs text-fg-muted" title={(plan.options ?? []).join(', ')}>Choices: {(plan.options ?? plan.inferred.options ?? []).join(', ') || 'any value'}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {previewColumns.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-fg">Preview: the first rows as they will be stored</h3>
                  <Table label="Sample rows" minWidth={`${Math.max(480, previewColumns.length * 120)}px`}>
                    <THead>
                      <TR>
                        <TH className="w-12">Row</TH>
                        {previewColumns.map((col) => <TH key={col.key}>{col.name}</TH>)}
                      </TR>
                    </THead>
                    <TBody>
                      {preview.map((row, i) => (
                        <TR key={i}>
                          <TD className="num text-fg-muted">{i + 2}</TD>
                          {previewColumns.map((col) => {
                            const value = row.data ? row.data[col.key] : undefined
                            return <TD key={col.key} className={cn('max-w-48 truncate', !row.data && 'text-danger')}>{row.data ? cellText(value) : 'error'}</TD>
                          })}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </section>
              )}
            </>
          )}

          {step === 'options' && parsed && (
            <div className="space-y-5">
              {!creating && (
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-fg">How to import</h3>
                  <SegmentedControl<Mode>
                    aria-label="Import mode"
                    value={mode}
                    onValueChange={setMode}
                    options={[{ value: 'insert', text: 'Add rows' }, { value: 'upsert', text: 'Update or add' }, { value: 'replace', text: 'Replace all rows' }]}
                  />
                  <p className="text-ui text-fg-muted">
                    {mode === 'insert' && 'Every row in the file is added as a new row.'}
                    {mode === 'upsert' && 'Rows whose key matches an existing row update it (cells not in the file are kept); the rest are added.'}
                    {mode === 'replace' && 'Every existing row of this table is deleted, then the file is imported. This is recorded in the audit log.'}
                  </p>
                  {mode === 'upsert' && (
                    <Field label="Key column" description="Its value identifies a row (e.g. an order number or email address).">
                      <Select value={keyColumn} onChange={(e) => setKeyColumn(e.target.value)} placeholder="Choose a column" options={keyCandidates.map((c) => ({ value: c.key, label: c.name }))} data-testid="import-key-column" />
                    </Field>
                  )}
                  {mode === 'replace' && (
                    <InlineNotice tone="danger" title="This deletes every existing row">
                      <Field label={<>Type <strong>{table?.name}</strong> to confirm</>}>
                        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" data-testid="import-confirm-replace" />
                      </Field>
                    </InlineNotice>
                  )}
                </section>
              )}
              <section className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Dates"
                  description={!hasDateColumns ? 'No date columns are mapped.' : detectedOrder?.ambiguous && dateChoice === 'auto' ? `Every date could be read either way: using ${ORDER_LABEL[dateOrder]}. Check the preview.` : dateChoice === 'auto' ? `Detected ${ORDER_LABEL[dateOrder]}.` : undefined}
                >
                  <Select value={dateChoice} onChange={(e) => setDateChoice(e.target.value as DateOrder | 'auto')} disabled={!hasDateColumns} options={[{ value: 'auto', label: `Detect (${ORDER_LABEL[detectedOrder?.order ?? dateOrder]})` }, { value: 'dmy', label: 'Day/month/year (31/03/2026)' }, { value: 'mdy', label: 'Month/day/year (03/31/2026)' }, { value: 'ymd', label: 'Year-month-day (2026-03-31)' }]} data-testid="import-date-order" />
                </Field>
                <div className="flex flex-col gap-2" role="radiogroup" aria-label="Empty cells">
                  <span className="block text-ui font-medium text-fg">Empty cells</span>
                  <Radio name="empty-cells" checked={emptyCells === 'empty'} onChange={() => setEmptyCells('empty')} label="Store as empty" description={mode === 'upsert' ? 'An empty cell clears the value.' : undefined} />
                  <Radio name="empty-cells" checked={emptyCells === 'ignore'} onChange={() => setEmptyCells('ignore')} label="Leave the column unchanged" description={mode === 'upsert' ? 'Existing values are kept.' : undefined} />
                </div>
              </section>
              <section className="space-y-2">
                <Checkbox checked={trim} onChange={(e) => setTrim(e.target.checked)} label="Trim spaces at the start and end of each cell" />
                <Checkbox checked={fireTriggers} onChange={(e) => setFireTriggers(e.target.checked)} label="Run workflows triggered by new and changed rows" description="On: each imported row starts the table's row workflows, as when rows are added one by one. Off: rows are written without starting workflows." />
              </section>
            </div>
          )}

          {step === 'check' && parsed && validation && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2" data-testid="import-check-summary">
                <Badge tone="success">{plural(validation.valid.length, 'row')} ready</Badge>
                {validation.invalidRows.length > 0 && <Badge tone="danger">{plural(validation.invalidRows.length, 'row')} with errors</Badge>}
                {mode === 'upsert' && <Badge tone="info">matched on {columns.find((c) => c.key === keyColumn)?.name}</Badge>}
                {mode === 'replace' && <Badge tone="warning">replaces all rows</Badge>}
              </div>
              {validation.invalidRows.length === 0 ? (
                <InlineNotice tone="success" message={`Every row is valid. ${mode === 'upsert' ? 'Rows are matched to existing ones when the import runs.' : ''}`} />
              ) : (
                <>
                  <InlineNotice tone="warning" title={`${plural(validation.invalidRows.length, 'row')} cannot be imported`} actions={<Button size="sm" variant="secondary" leadingIcon={<Download />} onClick={downloadErrors} data-testid="import-download-errors">Download error rows</Button>}>
                    Import the {plural(validation.valid.length, 'valid row')} only, or cancel, fix the file and start again. Row numbers count the header as row 1.
                  </InlineNotice>
                  <Table label="Row errors" minWidth="560px">
                    <THead>
                      <TR><TH className="w-16">Row</TH><TH>Column</TH><TH>Value</TH><TH>Problem</TH></TR>
                    </THead>
                    <TBody>
                      {validation.errors.slice(0, 100).map((e, i) => (
                        <TR key={`${e.row}-${e.column}-${i}`}>
                          <TD className="num">{e.row}</TD>
                          <TD>{e.column}</TD>
                          <TD className="max-w-40 truncate font-mono text-xs" title={e.value}>{e.value || '—'}</TD>
                          <TD className="text-fg-muted">{e.reason}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  {validation.errors.length > 100 && <p className="text-xs text-fg-muted">First 100 of {validation.errors.length.toLocaleString('en-US')} problems shown; the download has them all.</p>}
                </>
              )}
            </div>
          )}

          {step === 'import' && (
            <div className="space-y-4" data-testid="import-progress">
              {importError ? (
                <InlineNotice tone="danger" title="The import did not finish" message={importError} />
              ) : job?.status === 'succeeded' ? (
                <>
                  <InlineNotice tone="success" title="Import finished" message={job.result?.summary ?? undefined} />
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="import-summary">
                    {(['inserted', 'updated', 'skipped', 'failed'] as const).map((k) => (
                      <div key={k} className="rounded-lg border border-border-subtle bg-panel p-3">
                        <dt className="text-xs capitalize text-fg-muted">{k}</dt>
                        <dd className={cn('text-xl font-semibold num', k === 'failed' && counts[k] ? 'text-danger' : 'text-fg')}>{(counts[k] ?? 0).toLocaleString('en-US')}</dd>
                      </div>
                    ))}
                  </dl>
                  {counts.deleted ? <p className="text-ui text-fg-muted">{plural(counts.deleted, 'existing row')} deleted first.</p> : null}
                  {job.downloadable && job.download_url && (
                    <Button variant="secondary" leadingIcon={<Download />} onClick={() => { window.location.href = job.download_url! }}>Download the error report</Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-fg">{importing && !job ? (creating && !createdTableId ? 'Creating the table…' : 'Uploading…') : job?.message ?? 'Importing…'}</p>
                  <ProgressBar value={job?.progress ?? 2} label="Import progress" />
                  <p className="text-xs text-fg-muted">The import runs in the background: you can close this window, and the Jobs panel shows when it is done.</p>
                </>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter className="justify-between">
          <div>
            {index > 0 && step !== 'import' && (
              <Button variant="ghost" leadingIcon={<ArrowLeft />} onClick={() => go(STEPS[index - 1].id)}>Back</Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {step === 'import' ? (
              <>
                {job?.status === 'succeeded' && doneTableId && creating && (
                  <Button onClick={() => { close(false); router.push(`/data/${doneTableId}`) }}>Open the table</Button>
                )}
                <Button variant={job?.status === 'succeeded' && creating ? 'secondary' : 'primary'} onClick={() => close(false)}>{importing ? 'Close (keeps running)' : 'Done'}</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
                {step === 'check' ? (
                  <Button leadingIcon={<Upload />} disabled={!canNext.check} onClick={() => void runImport()} data-testid="import-run">
                    {validation && validation.invalidRows.length ? `Import ${plural(validation.valid.length, 'valid row')}` : `Import ${plural(validation?.valid.length ?? 0, 'row')}`}
                  </Button>
                ) : (
                  <Button trailingIcon={<ArrowRight />} disabled={!canNext[step]} onClick={() => go(STEPS[index + 1].id)} data-testid="import-next">Next</Button>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
