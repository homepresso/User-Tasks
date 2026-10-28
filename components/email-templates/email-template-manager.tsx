'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Mail, Pencil, Plus, Trash2, X } from 'lucide-react'
import { listEmailTemplates, saveEmailTemplate, deleteEmailTemplate } from '@/app/actions/email-templates'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { formatRelativeDate } from '@/lib/utils'
import { getPublicConfig } from '@/lib/config/public'
import { usePermissions } from '@/lib/permissions-context'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'

type Row = Awaited<ReturnType<typeof listEmailTemplates>>[number]

export function EmailTemplateManager() {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const { data = [], isLoading } = useQuery({ queryKey: ['email-templates'], queryFn: listEmailTemplates })
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)

  async function submit(formData: FormData) {
    setBusy(true); setNotice(null)
    try {
      await saveEmailTemplate({
        id: editing?.id,
        name: String(formData.get('name') ?? ''),
        description: String(formData.get('description') ?? ''),
        subject: String(formData.get('subject') ?? ''),
        htmlBody: String(formData.get('html_body') ?? ''),
        textBody: String(formData.get('text_body') ?? ''),
      })
      setEditing(undefined)
      await queryClient.invalidateQueries({ queryKey: ['email-templates'] })
    } catch (error: any) { setNotice(error?.message ?? 'Unable to save template') }
    finally { setBusy(false) }
  }

  if (editing !== undefined) {
    return (
      <form id="email-template-editor" action={submit} className="space-y-4 rounded-xl border p-5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <div className="flex items-center justify-between"><h2 className="font-semibold">{editing ? 'Edit' : 'New'} email template</h2><button type="button" onClick={() => setEditing(undefined)}><X size={16} /></button></div>
        {notice && <InlineNotice tone="error" message={notice} onDismiss={() => setNotice(null)} />}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="mb-1 block text-xs font-medium">Name</label><Input name="name" required maxLength={120} defaultValue={editing?.name ?? ''} /></div>
          <div><label className="mb-1 block text-xs font-medium">Description</label><Input name="description" defaultValue={editing?.description ?? ''} /></div>
        </div>
        <div><label className="mb-1 block text-xs font-medium">Subject</label><Input name="subject" required maxLength={500} defaultValue={editing?.subject ?? ''} placeholder="Task {{task.title}} requires attention" /></div>
        <div><label className="mb-1 block text-xs font-medium">HTML body</label><textarea name="html_body" required rows={12} defaultValue={editing?.html_body ?? ''} className="w-full rounded-lg border p-3 font-mono text-xs" style={{ borderColor: 'var(--theme-surface-border)', background: 'var(--theme-surface)' }} placeholder={'<h1>Hello {{assignee_name}}</h1>\n<p>Your task is ready.</p>'} /></div>
        <div><label className="mb-1 block text-xs font-medium">Plain text / notification body</label><textarea name="text_body" rows={5} defaultValue={editing?.text_body ?? ''} className="w-full rounded-lg border p-3 text-xs" style={{ borderColor: 'var(--theme-surface-border)', background: 'var(--theme-surface)' }} placeholder="Optional. Generated from HTML when left blank." /></div>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Use the same {'{{variable}}'} expressions available in workflows. Unsafe script, iframe, object, embed, and form markup is removed when saved.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => { const form = document.getElementById('email-template-editor') as HTMLFormElement; const values = new FormData(form); setPreview({ subject: String(values.get('subject') ?? ''), html: String(values.get('html_body') ?? '') }) }}><Eye size={14} className="mr-1" /> Preview</Button><Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</Button></div>
        {preview && <EmailPreview subject={preview.subject} html={preview.html} onClose={() => setPreview(null)} />}
      </form>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">{can('workflows.create') && <ImportConfigButton size="default" onImported={() => void queryClient.invalidateQueries({ queryKey: ['email-templates'] })} />}<Button onClick={() => setEditing(null)}><Plus size={14} className="mr-1" /> New email template</Button></div>
      {isLoading ? <p className="text-sm">Loading…</p> : data.length === 0 ? <EmptyState icon={Mail} title="No email templates" description="Create reusable HTML content for workflow emails and user-task notifications." /> : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          {data.map((row: Row) => <div key={row.id} className="flex items-center gap-4 border-t px-4 py-3 first:border-t-0" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <Mail size={16} style={{ color: 'var(--theme-primary-text)' }} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{row.name}</p><p className="truncate text-xs" style={{ color: 'var(--theme-muted-text)' }}>{row.subject}</p></div><span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>{formatRelativeDate(row.updated_at)}</span>
            {row.is_default && <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>Default</span>}
            <button onClick={() => setPreview({ subject: row.subject, html: row.html_body })} title="Preview"><Eye size={14} /></button>
            <button onClick={() => setEditing(row)} title="Edit"><Pencil size={14} /></button>
            <ExportAssetButton ids={[row.id]} name={row.name} iconOnly variant="ghost" className="!h-auto !p-0" />
            {!row.is_default && <button onClick={async () => { if (!confirm(`Delete ${row.name}?`)) return; await deleteEmailTemplate(row.id); queryClient.invalidateQueries({ queryKey: ['email-templates'] }) }} title="Delete"><Trash2 size={14} className="text-red-500" /></button>}
          </div>)}
        </div>
      )}
      {preview && <EmailPreview subject={preview.subject} html={preview.html} onClose={() => setPreview(null)} />}
    </div>
  )
}

function EmailPreview({ subject, html, onClose }: { subject: string; html: string; onClose: () => void }) {
  const appUrl = getPublicConfig().appUrl.trim().replace(/\/+$/, '') || window.location.origin
  const sample = html
    .replaceAll('{{user_task_title}}', 'Review the quarterly access request')
    .replaceAll('{{user_task_description_html}}', '<p>Please review the <strong>submitted details</strong> and approve or return the request.</p>')
    .replaceAll('{{user_task_description}}', 'Please review the submitted details and approve or return the request.')
    .replaceAll('{{user_task_id}}', 'task-preview')
    .replaceAll('{{app_url}}', appUrl)
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
    <div className="flex h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <div className="flex items-center gap-3 border-b px-4 py-3 text-[#22333A]"><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase text-slate-500">Email preview</p><p className="truncate text-sm font-medium">{subject || 'No subject'}</p></div><button onClick={onClose} aria-label="Close preview"><X size={18} /></button></div>
      <iframe title="Email template preview" sandbox="" srcDoc={sample} className="h-full w-full bg-white" />
    </div>
  </div>
}
