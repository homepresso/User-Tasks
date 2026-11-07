'use client'

import { useState, useEffect, useRef } from 'react'
import { Trash2, Copy, Check, FileText, Upload, ExternalLink, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Avatar } from '@/components/ui/avatar'
import { Tag } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody, DialogFooter } from '@/components/ui/dialog'
import { updateRow, deleteRow } from '@/app/actions/data-store'
import { uploadDataTableFile } from '@/app/actions/uploads'
import { useQueryClient } from '@tanstack/react-query'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
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

/** Upload a file into the table's storage folder; returns the stored cell value. */
export async function uploadRowFile(tableId: string, file: File) {
  // Stored server-side (data.manage_rows) in task-files/data-tables/<table>/.
  const body = new FormData()
  body.set('file', file)
  body.set('table_id', tableId)
  const uploaded = await uploadDataTableFile(body)
  if (!uploaded.ok) throw new Error(uploaded.error)
  const { name, url, size, path, ref } = uploaded.data
  return { name, url, size, path, ...(ref ? { ref } : {}) }
}

/**
 * RowDetailDrawer: a Sheet (lg) for inspecting and editing one row.
 *
 * Shows the row ID (copy), who created / last updated it, every field as a
 * type-aware Field, and the row's retention policy. Edits are buffered until
 * Save; closing with unsaved changes asks first.
 */
export function RowDetailDrawer({ open, onOpenChange, row, columns, tableId }: RowDetailDrawerProps) {
  const [editData, setEditData] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
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

  // Reset the local edit buffer whenever the row changes (switching rows
  // without closing the drawer, or closing then reopening).
  useEffect(() => {
    if (row) {
      setEditData(normalizeRowData(row.data, columns))
      setDirty(false)
      setError(null)
    }
  }, [row?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setDeleting(true)
    try {
      await deleteRow(row.id)
      setConfirmDelete(false)
      onOpenChange(false)
      queryClient.invalidateQueries({ queryKey: ['custom-table-rows', tableId] })
      router.refresh()
    } catch (e: any) {
      setConfirmDelete(false)
      setError(e?.message ?? 'Failed to delete')
    } finally {
      setDeleting(false)
    }
  }

  async function handleFileUpload(colName: string, file: File) {
    if (!row) return
    setUploading(colName)
    try {
      updateField(colName, await uploadRowFile(tableId, file))
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
    if (dirty && !confirm('Discard unsaved changes?')) return
    onOpenChange(false)
  }

  return (
    <Sheet open={open && !!row} onOpenChange={(next) => { if (!next) handleClose() }}>
      {row && (
        <SheetContent
          size="lg"
          title="Row details"
          description={
            <button
              type="button"
              onClick={copyRowId}
              className="inline-flex items-center gap-1 font-mono text-xs text-fg-muted hover:text-fg"
              aria-label={`Copy row ID ${row.id}`}
            >
              {row.id}
              {copiedId ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
          }
        >
          <DialogBody className="space-y-5">
            <Card variant="inset" padding="sm" className="grid grid-cols-2 gap-3">
              <MetaField label="Created by" user={row.creator} timestamp={row.created_at} />
              <MetaField label="Last updated" user={row.updater ?? row.creator} timestamp={row.updated_at ?? row.created_at} />
              <div className="col-span-2 text-xs text-fg-muted">
                Retention: <span className="text-fg">{retentionStatus.label}</span>
              </div>
            </Card>

            {columns.length === 0 ? (
              <p className="py-8 text-center text-ui text-fg-muted">This table has no columns yet.</p>
            ) : (
              columns.map((col, index) => (
                <RowFieldEditor
                  key={getColumnKey(col, index)}
                  column={col}
                  value={editData[columnKey(col)]}
                  onChange={(v) => updateField(columnKey(col), v)}
                  uploading={uploading === columnKey(col)}
                  onUpload={(file) => handleFileUpload(columnKey(col), file)}
                />
              ))
            )}

            <div className="space-y-2 border-t border-border-subtle pt-4">
              <RetentionPolicyAssignment
                targetType="data_row"
                targetId={row.id}
                currentPolicyId={row.retention_policy_id}
                allowedScope="data_rows"
                compact
              />
              <p className="text-xs text-fg-muted">
                Row-level retention overrides the table default when a policy is assigned here.
              </p>
            </div>

            {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
          </DialogBody>

          <DialogFooter className="justify-between">
            <Button
              variant="danger-ghost"
              size="sm"
              leadingIcon={<Trash2 />}
              onClick={() => setConfirmDelete(true)}
              disabled={deleting || saving}
            >
              Delete
            </Button>
            <div className="flex items-center gap-2">
              {dirty && <span className="text-xs text-fg-muted">Unsaved changes</span>}
              <Button variant="secondary" size="sm" onClick={handleClose}>Close</Button>
              <Button size="sm" onClick={handleSave} disabled={!dirty} loading={saving}>Save</Button>
            </div>
          </DialogFooter>
        </SheetContent>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        destructive
        title="Delete this row?"
        description="The row is deleted permanently."
        confirmLabel="Delete row"
        busy={deleting}
        onConfirm={handleDelete}
      />
    </Sheet>
  )
}

/* ─── Metadata: avatar + name + relative timestamp ─── */

function MetaField({
  label, user, timestamp,
}: {
  label: string
  user: { display_name: string | null; email: string | null } | null | undefined
  timestamp: string | null | undefined
}) {
  const name = user?.display_name ?? user?.email ?? 'Unknown'
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-fg-muted">{label}</p>
      <div className="flex min-w-0 items-center gap-2">
        {user && <Avatar name={name} size="sm" />}
        <div className="min-w-0">
          <p className="truncate text-ui font-medium text-fg">{user ? name : '—'}</p>
          {timestamp && (
            <p className="num text-xs text-fg-muted" title={formatAbsolute(timestamp)}>
              {formatRelative(timestamp)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Type-aware field editor (row sheet and add-row sheet) ─── */

export function RowFieldEditor({
  column, value, onChange, uploading, onUpload,
}: {
  column: DataColumn
  value: any
  onChange: (v: any) => void
  uploading: boolean
  onUpload: (file: File) => void
}) {
  const label = (
    <span className="inline-flex items-center gap-2">
      {column.name || 'Untitled'}
      <Tag mono>{column.type}</Tag>
    </span>
  )

  if (column.type === 'boolean') {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-2 text-ui font-medium text-fg">{label}</span>
        <Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} label={value ? 'True' : 'False'} />
      </div>
    )
  }
  if (column.type === 'file') {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="inline-flex items-center gap-2 text-ui font-medium text-fg">{label}</span>
        <FileEditor value={value} uploading={uploading} onUpload={onUpload} onClear={() => onChange(null)} />
      </div>
    )
  }
  return (
    <Field label={label}>
      {column.type === 'longtext' ? (
        <Textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={5} placeholder="—" />
      ) : column.type === 'select' ? (
        <Select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Select…"
          options={(column.options ?? []).map((o) => ({ value: o, label: o }))}
        />
      ) : column.type === 'lookup' ? (
        <LookupFieldEditor column={column} value={value} onChange={onChange} />
      ) : (
        <Input
          type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
        />
      )}
    </Field>
  )
}

function LookupFieldEditor({
  column,
  value,
  onChange,
  ...rest
}: {
  column: DataColumn
  value: any
  onChange: (value: string) => void
}) {
  const { data: options = [], isLoading } = useLookupOptions(column.lookup, true)
  return (
    <Select {...rest} value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={isLoading}>
      <option value="">{isLoading ? 'Loading…' : 'Select…'}</option>
      {options.map((option) => (
        <option key={`${column.id}:${option.value}`} value={option.value}>{option.label}</option>
      ))}
    </Select>
  )
}

function FileEditor({
  value, uploading, onUpload, onClear,
}: {
  value: any
  uploading: boolean
  onUpload: (file: File) => void
  onClear: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileData = value && typeof value === 'object' ? value : null

  if (uploading) {
    return (
      <div className="flex h-[var(--ds-control-h)] items-center gap-2 rounded-md border border-border px-3 text-ui text-fg-muted">
        <Loader2 className="size-4 animate-spin" /> Uploading…
      </div>
    )
  }

  if (fileData?.url) {
    return (
      <div className="flex h-[var(--ds-control-h)] items-center gap-2 rounded-md border border-border pl-3 pr-1">
        <FileText className="size-4 shrink-0 text-fg-muted" />
        <a
          href={fileData.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 flex-1 items-center gap-1 text-ui text-primary-text hover:underline"
        >
          <span className="truncate">{fileData.name ?? 'File'}</span>
          <ExternalLink className="size-3.5 shrink-0" />
        </a>
        <IconButton label="Remove file" icon={<X />} size="sm" onClick={onClear} />
      </div>
    )
  }

  return (
    <>
      <Button variant="secondary" size="sm" leadingIcon={<Upload />} onClick={() => fileInputRef.current?.click()} className="self-start">
        Upload file
      </Button>
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
