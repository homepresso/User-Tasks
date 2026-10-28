'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, Printer, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useJobs } from '@/components/jobs/jobs-provider'

interface ExportProps {
  data: any[]
  columns: { key: string; label: string }[]
  filename?: string
}

function getValue(row: any, key: string) {
  return key.split('.').reduce((o, k) => o?.[k], row)
}

function exportCSV(data: any[], columns: { key: string; label: string }[], filename: string) {
  const header = columns.map(c => `"${c.label}"`).join(',')
  const rows = data.map(row =>
    columns.map(c => {
      const v = getValue(row, c.key)
      return v == null ? '' : `"${String(v).replace(/"/g, '""')}"`
    }).join(',')
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Excel is built on the server as a background job (`report.export`): the
 * rows on screen are the job's input; the popup offers the .xlsx when ready.
 */
function excelJobInput(data: any[], columns: { key: string; label: string }[]) {
  return JSON.stringify({
    columns: columns.map(c => c.label),
    rows: data.map(row => columns.map(c => getValue(row, c.key) ?? '')),
  })
}

function exportPDF() {
  window.print()
}

export function ReportExportButton({ data, columns, filename = 'report' }: ExportProps) {
  const jobs = useJobs()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCSV() {
    try {
      setError(null)
      exportCSV(data, columns, filename)
      setOpen(false)
    } catch (e: any) {
      // Surface export failures to the user instead of silently swallowing
      // them. CSV errors are rare but happen (encoding issues, huge datasets
      // blowing through the Blob size limit).
      setError(`CSV export failed: ${e?.message ?? 'unknown error'}`)
    }
  }

  async function handleExcel() {
    try {
      setError(null)
      setOpen(false)
      await jobs.start('report.export', { filename }, { effect: 'download', input: { text: excelJobInput(data, columns) }, pendingMessage: 'Preparing your Excel file…' })
    } catch (e: any) {
      // Show the real reason (server error, too large, signed out) so users
      // can report it.
      setError(`Excel export failed: ${e?.message ?? 'unknown error'}`)
    }
  }

  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen(!open)} className="gap-1.5">
        <Download size={14} /> Export <ChevronDown size={12} />
      </Button>
      {error && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border px-3 py-2 text-xs shadow-lg"
          style={{
            backgroundColor: 'var(--status-error-bg)',
            borderColor: 'var(--status-error)',
            color: 'var(--status-error)',
          }}
        >
          {error}
          <button
            className="block mt-1 underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border shadow-lg py-1"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
          >
            <button
              className="w-full px-3 py-2 text-left text-xs hover:bg-[var(--theme-surface)] flex items-center gap-2"
              style={{ color: 'var(--theme-card-text)' }}
              onClick={handleCSV}
            >
              <FileText size={13} /> Download CSV
            </button>
            <button
              className="w-full px-3 py-2 text-left text-xs hover:bg-[var(--theme-surface)] flex items-center gap-2"
              style={{ color: 'var(--theme-card-text)' }}
              onClick={handleExcel}
            >
              <FileSpreadsheet size={13} /> Download Excel
            </button>
            <button
              className="w-full px-3 py-2 text-left text-xs hover:bg-[var(--theme-surface)] flex items-center gap-2"
              style={{ color: 'var(--theme-card-text)' }}
              onClick={() => { exportPDF(); setOpen(false) }}
            >
              <Printer size={13} /> Print / PDF
            </button>
          </div>
        </>
      )}
    </div>
  )
}
