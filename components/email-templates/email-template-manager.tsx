'use client'

import { useConfirm } from '@/components/ui/use-confirm'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Mail, Pencil, Plus, Trash2 } from 'lucide-react'
import { listEmailTemplates, deleteEmailTemplate } from '@/app/actions/email-templates'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { PageHeader } from '@/components/ui/page-header'
import { Table, THead, TBody, TR, TH, TD, TDActions, TableSkeleton } from '@/components/ui/table'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/list-controls'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { pluralWord } from '@/lib/format/plural'
import { getPublicConfig } from '@/lib/config/public'
import { usePermissions } from '@/lib/permissions-context'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'
import { TagFilterMenu, TagsActionButton, TagsCell, useTagFilter } from '@/components/ui/list-tags'
import { ObjectTagsDialog } from '@/components/ui/object-tags-dialog'
import { EmailTemplateEditor } from './email-template-editor'
import { EmailPreviewFrame } from './email-preview-frame'
import { renderEmailTemplate } from '@/lib/email-editor/render'
import { sampleValues, templateVariables } from '@/lib/email-editor/variables'
import { extractPreheader } from '@/lib/email-editor/preview'

type Row = Awaited<ReturnType<typeof listEmailTemplates>>[number]

export function EmailTemplateManager() {
  const [confirm, confirmDialog] = useConfirm()
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const { data = [], isLoading } = useQuery({ queryKey: ['email-templates'], queryFn: listEmailTemplates })
  const [editing, setEditing] = useState<Row | null | undefined>(undefined)
  const tagFilter = useTagFilter(data, (r: Row) => r.tags)
  const [tagsTarget, setTagsTarget] = useState<null | { id: string; name: string; tags: string[] }>(null)
  // ?open=<id> (header search box) opens that template once the list loads (until it is closed).
  const searchParams = useSearchParams()
  const linkId = searchParams.get('open')
  const [closedLink, setClosedLink] = useState<string | null>(null)
  const linkedRow = linkId && linkId !== closedLink ? data.find((r) => r.id === linkId) : undefined
  const current = editing !== undefined ? editing : linkedRow
  const closeEditor = () => { setEditing(undefined); if (linkId) setClosedLink(linkId) }
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  // A page at a time (the shared pager).
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const shown = data.filter(tagFilter.matches)
  const safePage = Math.min(page, Math.max(1, Math.ceil(shown.length / pageSize)))
  const pageRows = shown.slice((safePage - 1) * pageSize, safePage * pageSize)

  const header = (actions?: ReactNode) => (
    <PageHeader
      className="mb-2"
      title="Email templates"
      description="Reusable subjects and bodies for the Send email workflow node."
      actions={actions}
    />
  )

  return (
    <div className="space-y-4">
      {confirmDialog}
      {header(
        <>
          {can('workflows.create') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['email-templates'] })} />}
          <Button size="sm" leadingIcon={<Plus />} onClick={() => setEditing(null)}>New email template</Button>
        </>,
      )}
      {!isLoading && data.length === 0 ? (
        <EmptyState icon={Mail} title="No email templates yet" description="Create reusable HTML content for workflow emails and user-task notifications." action={{ label: 'New email template', onClick: () => setEditing(null) }} />
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-2">
          <TagFilterMenu tags={tagFilter.allTags} selected={tagFilter.selected} onChange={tagFilter.setSelected} />
          {tagFilter.active && <span className="num text-xs text-fg-muted">{shown.length} of {data.length}</span>}
        </div>
        <Table label="Email templates">
          <THead>
            <tr>
              <TH col="title">Template</TH>
              <TH col="text" className="w-56" data-tags-column>Tags</TH>
              <TH col="date" className="w-32">Updated</TH>
              <TH col="actions"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {isLoading ? <TableSkeleton columns={4} /> : pageRows.map((row: Row) => (
              <TR key={row.id}>
                <TD className="max-w-0 py-2">
                  <div className="flex items-center gap-3">
                    <Mail size={16} className="shrink-0 text-fg-muted" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-medium text-fg" title={row.name}>{row.name}</p>
                        {row.is_default && <Badge tone="brand">Default</Badge>}
                      </div>
                      <p className="truncate text-xs text-fg-muted" title={row.subject}>{row.subject}</p>
                    </div>
                  </div>
                </TD>
                <TD className="max-w-56"><TagsCell tags={row.tags} selected={tagFilter.selected} onToggle={tagFilter.toggle} /></TD>
                <TD className="whitespace-nowrap text-xs text-fg-muted">
                  <Tooltip content={formatAbsolute(row.updated_at)}><span className="num">{formatRelative(row.updated_at)}</span></Tooltip>
                </TD>
                <TDActions>
                  <IconButton size="sm" label="Preview" icon={<Eye />} onClick={() => setPreview({ subject: row.subject, html: row.html_body })} />
                  <IconButton size="sm" label="Edit" icon={<Pencil />} onClick={() => setEditing(row)} />
                  <TagsActionButton onClick={() => setTagsTarget({ id: row.id, name: row.name, tags: row.tags ?? [] })} />
                  <ExportAssetButton ids={[row.id]} name={row.name} iconOnly variant="ghost" size="icon" className="size-7 text-fg-muted" />
                  {!row.is_default && <IconButton size="sm" variant="danger-ghost" label="Delete" icon={<Trash2 />} onClick={async () => { if (!(await confirm({ title: `Delete “${row.name}”?`, description: 'This can’t be undone.', confirmLabel: 'Delete template', destructive: true }))) return; await deleteEmailTemplate(row.id); queryClient.invalidateQueries({ queryKey: ['email-templates'] }) }} />}
                </TDActions>
              </TR>
            ))}
          </TBody>
        </Table>
        </>
      )}
      {tagsTarget && (
        <ObjectTagsDialog open onOpenChange={(open) => { if (!open) setTagsTarget(null) }} type="email_templates" id={tagsTarget.id} name={tagsTarget.name}
          tags={tagsTarget.tags} invalidate={[['email-templates']]} />
      )}
      <Pagination page={safePage} pageSize={pageSize} total={shown.length} onPageChange={setPage} onPageSizeChange={setPageSize} pageSizeOptions={[25, 50, 100]} showPageNumbers noun={pluralWord(data.length, 'template')} />
      {preview && <EmailPreview subject={preview.subject} html={preview.html} onClose={() => setPreview(null)} />}
      {current !== undefined && (
        <EmailTemplateEditor
          key={current?.id ?? 'new'}
          template={current}
          onClose={closeEditor}
          onSaved={() => { void queryClient.invalidateQueries({ queryKey: ['email-templates'] }) }}
        />
      )}
    </div>
  )
}

function EmailPreview({ subject, html, onClose }: { subject: string; html: string; onClose: () => void }) {
  const appUrl = getPublicConfig().appUrl.trim().replace(/\/+$/, '') || window.location.origin
  const variables = sampleValues(templateVariables({ subject, html_body: html }), {}, appUrl)
  const rendered = renderEmailTemplate({ subject, html_body: html }, { variables })
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="xl" title="Email preview" description={rendered.subject || 'No subject'} className="h-[85vh]">
        <EmailPreviewFrame className="mt-4 min-h-0 flex-1 border-t border-border-subtle" html={rendered.html} subject={rendered.subject} preheader={extractPreheader(rendered.html)} />
      </DialogContent>
    </Dialog>
  )
}
