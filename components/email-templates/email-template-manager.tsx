'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Mail, Pencil, Plus, Trash2, X } from 'lucide-react'
import { listEmailTemplates, saveEmailTemplate, deleteEmailTemplate } from '@/app/actions/email-templates'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { PageHeader } from '@/components/ui/page-header'
import { Table, THead, TBody, TR, TH, TD, TDActions, TableSkeleton } from '@/components/ui/table'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/list-controls'
import { InlineNotice } from '@/components/ui/inline-notice'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { pluralWord } from '@/lib/format/plural'
import { getPublicConfig } from '@/lib/config/public'
import { usePermissions } from '@/lib/permissions-context'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { SubmitButton } from '@/components/ui/submit-button'

type Row = Awaited<ReturnType<typeof listEmailTemplates>>[number]

export function EmailTemplateManager() {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const { data = [], isLoading } = useQuery({ queryKey: ['email-templates'], queryFn: listEmailTemplates })
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)
  // ?open=<id> (header search box) opens that template once the list loads.
  const searchParams = useSearchParams()
  const openedLink = useRef<string | null>(null)
  useEffect(() => {
    const id = searchParams.get('open')
    if (!id || openedLink.current === id) return
    const row = data.find((r) => r.id === id)
    if (!row) return
    openedLink.current = id
    setEditing(row)
  }, [data, searchParams])
  const [notice, setNotice] = useState<string | null>(null)
  // Synchronous guard: React 19 renders state set inside a form action only
  // when it ends, so `busy` alone can't stop a second submit.
  const { pending: busy, run } = useSubmitGuard()
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  // A page at a time (the shared pager).
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const safePage = Math.min(page, Math.max(1, Math.ceil(data.length / pageSize)))
  const pageRows = data.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function submit(formData: FormData) {
    await run(() => saveTemplate(formData))
  }

  async function saveTemplate(formData: FormData) {
    setNotice(null)
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
  }

  const header = (actions?: ReactNode) => (
    <PageHeader
      className="mb-2"
      title="Email templates"
      description="Reusable subjects and bodies for the Send email workflow node."
      actions={actions}
    />
  )

  if (editing !== undefined) {
    return (
      <div className="space-y-4">
        {header()}
        <Card padding="none">
          <form id="email-template-editor" action={submit}>
            <CardHeader
              title={`${editing ? 'Edit' : 'New'} email template`}
              actions={<IconButton size="sm" label="Close editor" icon={<X />} onClick={() => setEditing(undefined)} />}
            />
            <CardBody className="space-y-4 pt-0">
              {notice && <InlineNotice tone="error" message={notice} onDismiss={() => setNotice(null)} />}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name"><Input name="name" required maxLength={120} defaultValue={editing?.name ?? ''} /></Field>
                <Field label="Description"><Input name="description" defaultValue={editing?.description ?? ''} /></Field>
              </div>
              <Field label="Subject"><Input name="subject" required maxLength={500} defaultValue={editing?.subject ?? ''} placeholder="Task {{task.title}} requires attention" /></Field>
              <Field label="HTML body"><Textarea name="html_body" required rows={12} defaultValue={editing?.html_body ?? ''} className="bg-subtle font-mono text-xs" placeholder={'<h1>Hello {{assignee_name}}</h1>\n<p>Your task is ready.</p>'} /></Field>
              <Field label="Plain text / notification body"><Textarea name="text_body" rows={5} defaultValue={editing?.text_body ?? ''} className="bg-subtle text-xs" placeholder="Optional. Generated from HTML when left blank." /></Field>
              <p className="text-xs text-fg-muted">Use the same {'{{variable}}'} expressions available in workflows. Unsafe script, iframe, object, embed, and form markup is removed when saved.</p>
            </CardBody>
            <CardFooter className="justify-end">
              <Button type="button" variant="secondary" leadingIcon={<Eye />} onClick={() => { const form = document.getElementById('email-template-editor') as HTMLFormElement; const values = new FormData(form); setPreview({ subject: String(values.get('subject') ?? ''), html: String(values.get('html_body') ?? '') }) }}>Preview</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancel</Button>
              <SubmitButton pending={busy} pendingLabel="Saving…">Save template</SubmitButton>
            </CardFooter>
            {preview && <EmailPreview subject={preview.subject} html={preview.html} onClose={() => setPreview(null)} />}
          </form>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {header(
        <>
          {can('workflows.create') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['email-templates'] })} />}
          <Button size="sm" leadingIcon={<Plus />} onClick={() => setEditing(null)}>New email template</Button>
        </>,
      )}
      {!isLoading && data.length === 0 ? (
        <EmptyState icon={Mail} title="No email templates yet" description="Create reusable HTML content for workflow emails and user-task notifications." action={{ label: 'New email template', onClick: () => setEditing(null) }} />
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Template</TH>
              <TH className="w-32">Updated</TH>
              <TH className="w-px"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {isLoading ? <TableSkeleton columns={3} /> : pageRows.map((row: Row) => (
              <TR key={row.id}>
                <TD className="max-w-0 py-2">
                  <div className="flex items-center gap-3">
                    <Mail size={16} className="shrink-0 text-fg-muted" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-medium text-fg">{row.name}</p>
                        {row.is_default && <Badge tone="brand">Default</Badge>}
                      </div>
                      <p className="truncate text-xs text-fg-muted">{row.subject}</p>
                    </div>
                  </div>
                </TD>
                <TD className="text-xs text-fg-muted">
                  <Tooltip content={formatAbsolute(row.updated_at)}><span className="num">{formatRelative(row.updated_at)}</span></Tooltip>
                </TD>
                <TDActions>
                  <IconButton size="sm" label="Preview" icon={<Eye />} onClick={() => setPreview({ subject: row.subject, html: row.html_body })} />
                  <IconButton size="sm" label="Edit" icon={<Pencil />} onClick={() => setEditing(row)} />
                  <ExportAssetButton ids={[row.id]} name={row.name} iconOnly variant="ghost" size="icon" className="size-7 text-fg-muted" />
                  {!row.is_default && <IconButton size="sm" variant="danger-ghost" label="Delete" icon={<Trash2 />} onClick={async () => { if (!confirm(`Delete ${row.name}?`)) return; await deleteEmailTemplate(row.id); queryClient.invalidateQueries({ queryKey: ['email-templates'] }) }} />}
                </TDActions>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={safePage} pageSize={pageSize} total={data.length} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[25, 50, 100]} showPageNumbers noun={pluralWord(data.length, 'template')} />
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
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="xl" title="Email preview" description={subject || 'No subject'} className="h-[85vh]">
        {/* The body previews the email itself, so it keeps the email's own (white) canvas. */}
        <div className="mt-4 min-h-0 flex-1 border-t border-border-subtle">
          <iframe title="Email template preview" sandbox="" srcDoc={sample} className="h-full w-full" style={{ backgroundColor: 'white' }} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
