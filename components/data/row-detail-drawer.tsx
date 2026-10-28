'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Save, Trash2, User as UserIcon, Clock, Hash, Copy, Check,
  FileText, Upload, ExternalLink, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateRow, deleteRow } from '@/app/actions/data-store'
import { uploadDataTableFile } from '@/app/actions/uploads'
import { useQueryClient } from '@tanstack/react-query'
import { formatRelativeDate, getInitials, cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import type { DataColumn } from './lookup-config'
import { columnKey, normalizeRowData } from '@/lib/data-table-cells'
import { useLookupOptions } from './use-lookup-options'
import { RetentionPolicyAssignment } from '@/components/governance/retention-policy-assignment'
import { getRetentionStatus } from '@/lib/retention-policies'

interface RowDetail {
  id: string
  table_id: string
  tenant_id: string
  data: Record<string, any>
  retention_policy_id?: string | null
  retention_applied_at?: string | null
  retention_policy?: {
    id: string
    name: string
    description?: string | null
    policy_mode: 'review' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
    duration_value?: number | null
    duration_unit?: 'days' | 'months' | 'years' | null
    exact_date?: string | null
    applies_to?: string[] | null
  } | null
  created_at: string
  updated_at?: string | null
  created_by?: string | null
  updated_by?: string | null
  creator?: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null
  updater?: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null
}

interface RowDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: RowDetail | null
  columns: DataColumn[]
  tableId: string
}

/**
 * RowDetailDrawer — slide-in side panel for inspecting and editing a
 * single row of a data table. Portalled to document.body so it escapes
 * the dashboard shell's overflow clipping and always floats above the
 * content below.
 *
 * Shows:
 *   - Row ID with copy-to-clipboard
 *   - Metadata block: created by / at, updated by / at (relative + tooltip)
 *   - Every field as a labeled input (type-aware: text, number, date,
 *     boolean, select, longtext, file) with direct inline editing
 *   - Save / Delete actions at the bottom
 *
 * Edits are buffered locally until the user clicks Save — so they can
 * back out by closing the drawer without persisting changes.
 */
export function RowDetailDrawer({ open, onOpenChange, row, columns, tableId }: RowDetailDrawerProps) {
  const [mounted, setMounted] = useState(false)
  const [editData, setEditData] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const getColumnKey = (column: DataColumn, index: number) => `${column.id || 'col'}:${column.name || 'untitled'}:${index}`
  const retentionStatus = getRetentionStatus({
    policy: row?.retention_policy ?? null,
    appliedAt: row?.retention_applied_at ?? null,
    createdAt: row?.created_at ?? null,
  })

  useEffect(() => { setMounted(true) }, [])

  // Reset the local edit buffer whenever the row changes (switching rows
  // without closing the drawer, or closing then reopening).
  useEffect(() => {
    if (row) {
      setEditData(normalizeRowData(row.data, columns))
      setDirty(false)
      setError(null)
    }
  }, [row?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Esc
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (dirty) {
          if (!confirm('Discard unsaved changes?')) return
        }
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dirty, onOpenChange])

  function updateField(name: string, value: any) {
    setEditData(prev => ({ ...prev, [name]: value }))
    setDirty(true)
  }

  async function handleSave() {
    if (!row || !dirty) return
    setSaving(true)
    setError(null)
    try {
      await updateRow(row.id, editData)
      setDirty(false)
      // Invalidate so the parent list refreshes with the new data and
      // the drawer's next open picks up fresh metadata (updated_at, etc).
      queryClient.invalidateQueries({ queryKey: ['custom-table-rows', tableId] })
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!row) return
    if (!confirm('Delete this row permanently?')) return
    setDeleting(true)
    try {
      onOpenChange(false)
      await deleteRow(row.id)
      queryClient.invalidateQueries({ queryKey: ['custom-table-rows', tableId] })
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete')
      onOpenChange(true)
    } finally {
      setDeleting(false)
    }
  }

  async function handleFileUpload(colName: string, file: File) {
    if (!row) return
    setUploading(colName)
    try {
      // Stored server-side (data.manage_rows) in task-files/data-tables/<table>/.
      const body = new FormData()
      body.set('file', file)
      body.set('table_id', tableId)
      const uploaded = await uploadDataTableFile(body)
      if (!uploaded.ok) throw new Error(uploaded.error)
      const { name, url, size, path, ref } = uploaded.data
      const fileData = { name, url, size, path, ...(ref ? { ref } : {}) }
      updateField(colName, fileData)
    } catch (e: any) {
      setError(`Upload failed: ${e.message}`)
    } finally {
      setUploading(null)
    }
  }

  function copyRowId() {
    if (!row) return
    navigator.clipboard.writeText(row.id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 1500)
  }

  function handleClose() {
    if (dirty) {
      if (!confirm('Discard unsaved changes?')) return
    }
    onOpenChange(false)
  }

  if (!open || !mounted || !row) return null

  return createPortal(
    <div className="fixed inset-0 z-[200] flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/40 backdrop-blur-[1px]"
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className="w-full max-w-[560px] h-full flex flex-col shadow-2xl border-l"
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-surface-border)',
          animation: 'drawerSlideIn 0.25s ease-out',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--theme-surface-border)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--theme-primary-light)' }}
            >
              <FileText size={18} style={{ color: 'var(--theme-primary-text)' }} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold truncate" style={{ color: 'var(--theme-card-text)' }}>
                Row Details
              </h2>
              <button
                onClick={copyRowId}
                className="inline-flex items-center gap-1 text-[10px] font-mono hover:opacity-80"
                style={{ color: 'var(--theme-muted-text)' }}
                title="Click to copy"
              >
                <Hash size={9} />
                {row.id.slice(0, 12)}…
                {copiedId ? <Check size={9} /> : <Copy size={9} />}
              </button>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors"
            style={{ color: 'var(--theme-muted-text)' }}
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Metadata strip */}
        <div
          className="px-5 py-3 border-b shrink-0"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
        >
          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <MetaField
              label="Created by"
              icon={<UserIcon size={10} />}
              user={row.creator}
              timestamp={row.created_at}
            />
            <MetaField
              label="Last updated"
              icon={<Clock size={10} />}
              user={row.updater ?? row.creator}
              timestamp={row.updated_at ?? row.created_at}
            />
          </div>
          <div className="mt-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <p className="text-[9px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--theme-muted-text)' }}>
              Row retention
            </p>
            <p className="text-[11px]" style={{ color: 'var(--theme-card-text)' }}>
              {retentionStatus.label}
            </p>
          </div>
        </div>

        {/* Field list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {columns.length === 0 ? (
            <p className="text-center text-xs py-8" style={{ color: 'var(--theme-muted-text)' }}>
              This table has no columns yet.
            </p>
          ) : (
            columns.map((col, index) => (
              <FieldEditor
                key={getColumnKey(col, index)}
                column={col}
                value={editData[columnKey(col)]}
                onChange={(v) => updateField(columnKey(col), v)}
                uploading={uploading === columnKey(col)}
                onUpload={(file) => handleFileUpload(columnKey(col), file)}
              />
            ))
          )}

          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <RetentionPolicyAssignment
              targetType="data_row"
              targetId={row.id}
              currentPolicyId={row.retention_policy_id}
              allowedScope="data_rows"
              compact
            />
            <p className="mt-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              Row-level retention overrides the table default when a policy is assigned here.
            </p>
          </div>
        </div>

        {error && (
          <div
            className="mx-5 mb-3 px-3 py-2 rounded text-xs flex items-center justify-between"
            style={{ backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)' }}
          >
            <span>{error}</span>
            <button onClick={() => setError(null)}><X size={12} /></button>
          </div>
        )}

        {/* Footer actions */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--theme-surface-border)' }}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleting || saving}
            className="!text-red-600 hover:!bg-red-50"
          >
            <Trash2 size={13} className="mr-1" />
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                Unsaved changes
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleClose}>
              Close
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
              <Save size={13} className="mr-1" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* Minimal keyframe for slide-in — inlined to avoid polluting globals.css */}
      <style>{`
        @keyframes drawerSlideIn {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>,
    document.body,
  )
}

/* ─── Metadata chip with avatar + relative timestamp ─── */

function MetaField({
  label, icon, user, timestamp,
}: {
  label: string
  icon: React.ReactNode
  user: { display_name: string | null; email: string | null } | null | undefined
  timestamp: string | null | undefined
}) {
  const name = user?.display_name ?? user?.email ?? 'Unknown'
  return (
    <div>
      <p
        className="text-[9px] uppercase tracking-wider font-semibold flex items-center gap-1 mb-1"
        style={{ color: 'var(--theme-muted-text)' }}
      >
        {icon} {label}
      </p>
      <div className="flex items-center gap-1.5 min-w-0">
        {user && (
          <span
            className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
          >
            {getInitials(name)}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-medium truncate" style={{ color: 'var(--theme-card-text)' }}>
            {user ? name : '—'}
          </p>
          {timestamp && (
            <p
              className="text-[10px]"
              style={{ color: 'var(--theme-muted-text)' }}
              title={new Date(timestamp).toLocaleString()}
            >
              {formatRelativeDate(timestamp)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Type-aware field editor ─── */

function FieldEditor({
  column, value, onChange, uploading, onUpload,
}: {
  column: DataColumn
  value: any
  onChange: (v: any) => void
  uploading: boolean
  onUpload: (file: File) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div>
      <label
        className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5"
        style={{ color: 'var(--theme-muted-text)' }}
      >
        {column.name || 'Untitled'}
        <span
          className="text-[9px] px-1 py-0.5 rounded font-mono normal-case tracking-normal"
          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
        >
          {column.type}
        </span>
      </label>

      {column.type === 'boolean' ? (
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
          />
          <span className="text-xs" style={{ color: 'var(--theme-card-text)' }}>
            {value ? 'True' : 'False'}
          </span>
        </label>
      ) : column.type === 'longtext' ? (
        <textarea
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          placeholder="—"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
            color: 'var(--theme-card-text)',
            // @ts-expect-error — CSS var for ring color
            '--tw-ring-color': 'var(--theme-primary)',
          }}
        />
      ) : column.type === 'select' ? (
        <select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
            color: 'var(--theme-card-text)',
          }}
        >
          <option value="">— Select —</option>
          {(column.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : column.type === 'lookup' ? (
        <LookupFieldEditor column={column} value={value} onChange={onChange} />
      ) : column.type === 'file' ? (
        <FileEditor
          value={value}
          uploading={uploading}
          onUpload={onUpload}
          onClear={() => onChange(null)}
          fileInputRef={fileInputRef}
        />
      ) : (
        <Input
          type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className="!text-sm"
        />
      )}
    </div>
  )
}

function LookupFieldEditor({
  column,
  value,
  onChange,
}: {
  column: DataColumn
  value: any
  onChange: (value: string) => void
}) {
  const { data: options = [], isLoading } = useLookupOptions(column.lookup, true)

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border px-3 py-2 text-sm"
      style={{
        backgroundColor: 'var(--theme-card-bg)',
        borderColor: 'var(--theme-surface-border)',
        color: 'var(--theme-card-text)',
      }}
      disabled={isLoading}
    >
      <option value="">{isLoading ? 'Loading…' : '— Select —'}</option>
      {options.map((option) => (
        <option key={`${column.id}:${option.value}`} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}

function FileEditor({
  value, uploading, onUpload, onClear, fileInputRef,
}: {
  value: any
  uploading: boolean
  onUpload: (file: File) => void
  onClear: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const fileData = value && typeof value === 'object' ? value : null

  if (uploading) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs"
        style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-primary-text)' }}
      >
        <Loader2 size={13} className="animate-spin" /> Uploading…
      </div>
    )
  }

  if (fileData?.url) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg border"
        style={{ borderColor: 'var(--theme-surface-border)' }}
      >
        <FileText size={14} style={{ color: 'var(--theme-primary-text)' }} />
        <a
          href={fileData.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 truncate text-xs hover:underline"
          style={{ color: 'var(--theme-primary-text)' }}
        >
          {fileData.name ?? 'File'}
          <ExternalLink size={10} className="inline ml-1" />
        </a>
        <button
          onClick={onClear}
          className="text-xs hover:opacity-70"
          style={{ color: 'var(--theme-muted-text)' }}
          title="Remove file"
        >
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border hover:opacity-80 w-full justify-center"
        style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-primary-text)' }}
      >
        <Upload size={12} /> Upload file
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          e.target.value = ''
        }}
      />
    </>
  )
}
