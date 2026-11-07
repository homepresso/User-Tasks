'use client'

import { useState } from 'react'
import { Download, FileSpreadsheet, FileText, Printer, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { InlineNotice } from '@/components/ui/inline-notice'
import { useJobs } from '@/components/jobs/jobs-provider'
import { getReportValue } from '@/lib/report-sources'

interface ExportProps {
  data: any[]
  columns: { key: string; label: string }[]
  filename?: string
}

function getValue(row: any, key: string) {
  return getReportValue(row, key)
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
  const [error, setError] = useState<string | null>(null)

  function handleCSV() {
    try {
      setError(null)
      exportCSV(data, columns, filename)
    } catch (e: any) {
      // Surface export failures (encoding issues, huge datasets past the Blob limit).
      setError(`CSV export failed: ${e?.message ?? 'unknown error'}`)
    }
  }

  async function handleExcel() {
    try {
      setError(null)
      await jobs.start('report.export', { filename }, { effect: 'download', input: { text: excelJobInput(data, columns) }, pendingMessage: 'Preparing your Excel file…' })
    } catch (e: any) {
      // Show the real reason (server error, too large, signed out) so users can report it.
      setError(`Excel export failed: ${e?.message ?? 'unknown error'}`)
    }
  }

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" leadingIcon={<Download />} trailingIcon={<ChevronDown />}>Export</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<FileText />} onSelect={handleCSV}>Download CSV</DropdownMenuItem>
          <DropdownMenuItem icon={<FileSpreadsheet />} onSelect={() => void handleExcel()}>Download Excel</DropdownMenuItem>
          <DropdownMenuItem icon={<Printer />} onSelect={exportPDF}>Print / PDF</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72">
          <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />
        </div>
      )}
    </div>
  )
}
