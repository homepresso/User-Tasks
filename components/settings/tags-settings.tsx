'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Merge, Pencil, Plus, Trash2 } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { serverQuery } from '@/lib/server-read'
import { PageHeader } from '@/components/ui/page-header'
import { SearchInput, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Table, THead, TBody, TH, TR, TD, TableEmpty, TableSkeleton } from '@/components/ui/table'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Field } from '@/components/ui/field'
import { TagChip, TagColorPicker } from '@/components/ui/tag-chip'
import { TAG_LIST_QUERY_KEY, TAG_OBJECTS_QUERY_KEY, useInvalidateTagStyles } from '@/hooks/use-tag-styles'
import { deleteTagStyle, removeTag, renameTag, setTagStyle, updateTagSettings } from '@/app/actions/tags'
import { cleanTagName, tagKey, TAG_DESCRIPTION_MAX, TAG_NAME_MAX, type TagColorToken } from '@/lib/tags/palette'
import type { TagObjectType, TagSummary } from '@/lib/services/tags'
import { formatCount } from '@/lib/format/number'
import { cn } from '@/lib/utils'

/**
 * Settings → Tags, the central place for the workspace's tags: every tag in
 * the registry or on any object the viewer can see, searchable and
 * sortable, with colour, description, total and per-type counts (counts
 * only include objects the viewer may see — RLS). Selecting a tag opens
 * where it is used: the objects grouped by type, each linked, paged.
 *
 * People with tags.manage also: set colour and description, rename (on
 * every object), merge into another tag, remove from every object, create
 * a tag ahead of use, act on several tags at once (colour, delete unused
 * styles), and set the workspace's tag settings. Everyone else reads.
 */

type Notice = { tone: 'success' | 'error'; message: string }
type SortKey = 'name' | 'total' | 'description' | TagObjectType
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

export function sortTags(tags: readonly TagSummary[], sort: Sort): TagSummary[] {
  const value = (t: TagSummary): string | number =>
    sort.key === 'name' ? t.key : sort.key === 'description' ? (t.description ?? '').toLowerCase() : sort.key === 'total' ? t.total : (t.usage[sort.key] ?? 0)
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...tags].sort((a, b) => {
    const va = value(a), vb = value(b)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return cmp * dir || a.key.localeCompare(b.key)
  })
}

export function TagsSettings() {
  const { can } = usePermissions()
  const canManage = can('tags.manage')
  const invalidate = useInvalidateTagStyles()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'total', dir: 'desc' })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [editing, setEditing] = useState<TagSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const [detail, setDetail] = useState<TagSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkColor, setBulkColor] = useState(false)
  const [confirmUnused, setConfirmUnused] = useState(false)
  const [busy, setBusy] = useState(false)
  const { data, isPending, isError, error } = useQuery({
    queryKey: [...TAG_LIST_QUERY_KEY],
    queryFn: () => serverQuery('tags.list', {}),
    staleTime: 30_000,
  })
  const query = tagKey(q)
  // One count column per object type that carries any tag (14 types would not fit); the detail panel lists every type.
  const allTypes = data?.object_types ?? []
  const usedTypes = allTypes.filter((t) => (data?.tags ?? []).some((tag) => (tag.usage[t.type] ?? 0) > 0))
  const types = usedTypes.length ? usedTypes : allTypes.slice(0, 3)
  const tags = useMemo(() => sortTags((data?.tags ?? []).filter((t) => !query || t.key.includes(query) || (t.description ?? '').toLowerCase().includes(query)), sort), [data, query, sort])
  const selectedTags = (data?.tags ?? []).filter((t) => selected.has(t.key))
  const unusedStyled = selectedTags.filter((t) => t.styled && t.total === 0)

  async function saveSettings(input: { auto_color?: boolean; allow_new?: boolean }, message: string) {
    setBusy(true)
    const result = await updateTagSettings(input)
    setBusy(false)
    if (!result.ok) { setNotice({ tone: 'error', message: result.error }); return }
    setNotice({ tone: 'success', message })
    await invalidate()
  }

  async function bulkSetColor(color: TagColorToken | null) {
    setBusy(true)
    let failed = 0
    for (const t of selectedTags) { const r = await setTagStyle(t.name, { color: color ?? 'auto' }); if (!r.ok) failed++ }
    setBusy(false)
    setBulkColor(false)
    setNotice(failed ? { tone: 'error', message: `${failed} of ${selectedTags.length} tags could not be changed.` } : { tone: 'success', message: `Changed the colour of ${selectedTags.length} tags.` })
    setSelected(new Set())
    await invalidate()
  }

  async function deleteUnused() {
    setBusy(true)
    for (const t of unusedStyled) await deleteTagStyle(t.name)
    setBusy(false)
    setConfirmUnused(false)
    setNotice({ tone: 'success', message: `Deleted ${unusedStyled.length} unused tag${unusedStyled.length === 1 ? '' : 's'}.` })
    setSelected(new Set())
    await invalidate()
  }

  function header(key: SortKey, label: string, numeric = false) {
    const active = sort.key === key
    return (
      <TH numeric={numeric} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={cn('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg')}
          onClick={() => setSort(active ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'description' ? 'asc' : 'desc' })}>
          {label}
          {active && (sort.dir === 'asc' ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />)}
        </button>
      </TH>
    )
  }

  const allVisibleSelected = tags.length > 0 && tags.every((t) => selected.has(t.key))
  const columns = 4 + types.length + (canManage ? 1 : 0)
  return (
    <div className="space-y-5" data-tags-settings>
      <PageHeader title="Tags"
        description="Every tag in the workspace in one place: give tags a colour and a description, see where each is used, rename, merge or remove them. Colours show wherever a tag appears."
        actions={canManage ? <Button leadingIcon={<Plus />} onClick={() => setCreating(true)} data-tag-new>New tag</Button> : undefined} />

      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Automatic colours</p>
            <p className="text-xs text-fg-muted">Tags without a colour get one from their name, so the same tag always looks the same. Off: they show in grey.</p>
          </div>
          <Switch checked={data?.settings.auto_color ?? true} disabled={!canManage || busy || !data}
            onCheckedChange={(next) => void saveSettings({ auto_color: next }, next ? 'Automatic tag colours are on.' : 'Uncoloured tags now show in grey.')} aria-label="Automatic tag colours" data-tags-auto-color />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Anyone can add new tags</p>
            <p className="text-xs text-fg-muted">On: anyone who can edit an object can add a tag that doesn&apos;t exist yet. Off: only people who manage tags can; everyone else picks existing tags.</p>
          </div>
          <Switch checked={data?.settings.allow_new ?? true} disabled={!canManage || busy || !data}
            onCheckedChange={(next) => void saveSettings({ allow_new: next }, next ? 'Anyone who can edit an object can add new tags.' : 'Only tag managers can add new tags now.')} aria-label="Anyone can add new tags" data-tags-allow-new />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onValueChange={setQ} placeholder="Search tags or descriptions" aria-label="Search tags" wrapperClassName="min-w-[220px] max-w-sm flex-1" />
        {data && <span className="text-xs text-fg-muted">{formatCount(tags.length)} of {formatCount(data.tags.length)} tags</span>}
        {canManage && selected.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-2" role="toolbar" aria-label="Selected tags" data-tags-bulk>
            <span className="num text-xs text-fg-muted">{selected.size} selected</span>
            <Button size="sm" variant="secondary" onClick={() => setBulkColor(true)} disabled={busy}>Colour…</Button>
            <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />} disabled={busy || !unusedStyled.length} onClick={() => setConfirmUnused(true)}
              title={unusedStyled.length ? undefined : 'None of the selected tags is an unused style'}>Delete unused ({unusedStyled.length})</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
      </div>

      {isError ? (
        <InlineNotice tone="error" message={(error as Error).message} />
      ) : (
        <Table label="Tags" stickyFirstColumn>
          <THead>
            <tr>
              {canManage && (
                <TH className="w-10">
                  <Checkbox aria-label="Select all shown tags" checked={allVisibleSelected}
                    onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(tags.map((t) => t.key)))} />
                </TH>
              )}
              {header('name', 'Tag')}
              {header('description', 'Description')}
              {types.map((t) => <Fragment key={t.type}>{header(t.type, t.label, true)}</Fragment>)}
              {header('total', 'Total', true)}
              <TH col="actions"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {isPending ? (
              <TableSkeleton columns={columns} />
            ) : !tags.length ? (
              <TableEmpty colSpan={columns} size="sm" variant={q ? 'no-results' : 'first-run'}
                title={q ? `No tags match “${q}”` : 'No tags yet'}
                description={q ? 'Try another search.' : 'Tags you add to tasks, workflows, forms, data tables, reports, business rules, apps and the rest show here.'} />
            ) : tags.map((tag) => (
              <TR key={tag.key} interactive selected={selected.has(tag.key)} onClick={() => setDetail(tag)} data-tag-row={tag.key}>
                {canManage && (
                  <TD onClick={(e) => e.stopPropagation()}>
                    <Checkbox aria-label={`Select ${tag.name}`} checked={selected.has(tag.key)}
                      onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(tag.key)) n.delete(tag.key); else n.add(tag.key); return n })} />
                  </TD>
                )}
                <TD className="max-w-0">
                  <span className="inline-flex items-center gap-2">
                    <TagChip name={tag.name} size="md" color={tag.color} description={null} />
                    {!tag.chosen_color && <span className="text-2xs text-fg-subtle">auto</span>}
                    {tag.styled && tag.total === 0 && <span className="text-2xs text-fg-subtle">unused</span>}
                  </span>
                </TD>
                <TD className="max-w-0 text-xs text-fg-muted"><span className="line-clamp-2">{tag.description ?? '—'}</span></TD>
                {types.map((t) => <TD key={t.type} numeric className="text-fg-muted">{tag.usage[t.type] ? formatCount(tag.usage[t.type]!) : '—'}</TD>)}
                <TD numeric className="font-medium">{formatCount(tag.total)}</TD>
                <TD col="actions" className="px-1" onClick={(e) => e.stopPropagation()}>
                  {canManage && <IconButton size="sm" label={`Edit ${tag.name}`} icon={<Pencil />} onClick={() => setEditing(tag)} />}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {detail && (
        <TagDetailSheet tag={detail} types={allTypes} canManage={canManage} allTags={data?.tags ?? []}
          onClose={() => setDetail(null)} onEdit={() => { setEditing(detail); setDetail(null) }}
          onChanged={async (message) => { setDetail(null); setNotice({ tone: 'success', message }); await invalidate() }} />
      )}
      {editing && (
        <TagEditDialog tag={editing} autoColor={data?.settings.auto_color ?? true} onClose={() => setEditing(null)}
          onSaved={async (message) => { setEditing(null); setNotice({ tone: 'success', message }); await invalidate() }} />
      )}
      {creating && (
        <TagEditDialog tag={null} existing={data?.tags ?? []} autoColor={data?.settings.auto_color ?? true} onClose={() => setCreating(false)}
          onSaved={async (message) => { setCreating(false); setNotice({ tone: 'success', message }); await invalidate() }} />
      )}
      {bulkColor && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setBulkColor(false) }}>
          <DialogContent size="sm" title={`Colour for ${selected.size} tags`}>
            <DialogBody><TagColorPicker name="tags" value={null} disabled={busy} autoColor={data?.settings.auto_color ?? true} onChange={(c) => void bulkSetColor(c)} /></DialogBody>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog open={confirmUnused} onOpenChange={setConfirmUnused} destructive busy={busy}
        title={`Delete ${unusedStyled.length} unused tag${unusedStyled.length === 1 ? '' : 's'}?`}
        description="Their colours and descriptions are removed. They aren't on any object you can see."
        confirmLabel="Delete" onConfirm={deleteUnused} />
    </div>
  )
}

const DETAIL_PAGE = 10

/** Where a tag is used: its objects grouped by type, each linked, paged per group. */
function TagDetailSheet({ tag, types, canManage, allTags, onClose, onEdit, onChanged }: {
  tag: TagSummary
  types: Array<{ type: TagObjectType; label: string }>
  canManage: boolean
  allTags: readonly TagSummary[]
  onClose: () => void
  onEdit: () => void
  onChanged: (message: string) => void | Promise<void>
}) {
  const [merging, setMerging] = useState(false)
  const [mergeInto, setMergeInto] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const used = types.filter((t) => (tag.usage[t.type] ?? 0) > 0)

  async function merge() {
    const target = allTags.find((t) => t.key === mergeInto)
    if (!target) return
    setBusy(true)
    const result = await renameTag(tag.name, target.name)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await onChanged(`Merged “${tag.name}” into “${target.name}” on ${formatCount(result.data.total)} object${result.data.total === 1 ? '' : 's'}.`)
  }

  async function remove() {
    setBusy(true)
    const result = await removeTag(tag.name)
    setBusy(false)
    if (!result.ok) { setError(result.error); setConfirmRemove(false); return }
    await onChanged(`Removed “${tag.name}” from ${formatCount(result.data.total)} object${result.data.total === 1 ? '' : 's'}.`)
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent size="lg" title={<span className="inline-flex items-center gap-2">Tag <TagChip name={tag.name} size="md" color={tag.color} description={null} /></span>}
        description={tag.description ?? `Used on ${formatCount(tag.total)} object${tag.total === 1 ? '' : 's'} you can see.`}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-6" data-tag-detail={tag.key}>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" leadingIcon={<Pencil />} onClick={onEdit}>Colour, description, name</Button>
              <Button size="sm" variant="secondary" leadingIcon={<Merge />} onClick={() => setMerging((v) => !v)} data-tag-merge>Merge into…</Button>
              <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />} onClick={() => setConfirmRemove(true)} disabled={busy} data-tag-remove-all>Remove from all objects</Button>
            </div>
          )}
          {merging && (
            <Card padding="md" className="flex flex-wrap items-end gap-2">
              <Field label="Merge into" description="Every object with this tag gets the other one instead.">
                <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} placeholder="Choose a tag"
                  options={allTags.filter((t) => t.key !== tag.key).map((t) => ({ value: t.key, label: `${t.name} (${t.total})` }))} />
              </Field>
              <Button size="sm" onClick={() => void merge()} loading={busy} disabled={!mergeInto}>Merge</Button>
            </Card>
          )}
          {error && <InlineNotice tone="error" message={error} />}
          {!used.length ? (
            <p className="text-sm text-fg-muted">This tag isn&apos;t on any object you can see{tag.styled ? ' — it only has a colour or description so far.' : '.'}</p>
          ) : used.map((t) => <TagObjectGroup key={t.type} tag={tag} type={t.type} label={t.label} count={tag.usage[t.type] ?? 0} />)}
        </div>
        <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} destructive busy={busy}
          title={`Remove “${tag.name}” from every object?`}
          description={`It is taken off every task, workflow, form, integration, reference, agent and activity in this workspace (${formatCount(tag.total)} you can see, and any you can't), and its colour and description are deleted. This is recorded in the audit log.`}
          confirmLabel="Remove tag" onConfirm={remove} />
      </SheetContent>
    </Sheet>
  )
}

function TagObjectGroup({ tag, type, label, count }: { tag: TagSummary; type: TagObjectType; label: string; count: number }) {
  const [offset, setOffset] = useState(0)
  const { data, isPending, isError, error } = useQuery({
    queryKey: [...TAG_OBJECTS_QUERY_KEY, tag.key, type, offset],
    queryFn: () => serverQuery('tags.objects', { name: tag.name, type, limit: DETAIL_PAGE, offset }),
    placeholderData: (prev) => prev,
  })
  const total = data?.total ?? count
  return (
    <section aria-label={label} data-tag-objects={type}>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-fg">{label} <span className="num text-xs font-normal text-fg-muted">{formatCount(total)}</span></h3>
      {isError ? <InlineNotice tone="error" message={(error as Error).message} /> : isPending && !data ? (
        <p className="text-xs text-fg-muted">Loading…</p>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle">
          {(data?.items ?? []).map((item) => (
            <li key={item.id}><Link href={item.href} className="block truncate px-3 py-2 text-ui text-fg hover:bg-subtle hover:underline">{item.name}</Link></li>
          ))}
        </ul>
      )}
      {total > DETAIL_PAGE && (
        <div className="mt-1 flex items-center justify-end gap-2 text-xs text-fg-muted">
          <span className="num">{offset + 1}–{Math.min(offset + DETAIL_PAGE, total)} of {formatCount(total)}</span>
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - DETAIL_PAGE))}>Previous</Button>
          <Button size="sm" variant="ghost" disabled={offset + DETAIL_PAGE >= total} onClick={() => setOffset(offset + DETAIL_PAGE)}>Next</Button>
        </div>
      )}
    </section>
  )
}

/** Edit a tag (colour, description, rename) or, with `tag` null, create one ahead of use (registry only). */
function TagEditDialog({ tag, existing = [], autoColor, onClose, onSaved }: {
  tag: TagSummary | null
  existing?: readonly TagSummary[]
  autoColor: boolean
  onClose: () => void
  onSaved: (message: string) => void | Promise<void>
}) {
  const [color, setColor] = useState<TagColorToken | null>(tag?.chosen_color ?? null)
  const [description, setDescription] = useState(tag?.description ?? '')
  const [name, setName] = useState(tag?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const newName = cleanTagName(name)
  const renaming = tag != null && newName !== tag.name && newName.length > 0
  const duplicate = tag == null && newName ? existing.find((t) => t.key === tagKey(newName)) : undefined
  const preview = newName || tag?.name || 'new tag'

  async function save() {
    setBusy(true)
    setError(null)
    let finalName = tag?.name ?? newName
    let renameNote = ''
    if (renaming && tag) {
      const result = await renameTag(tag.name, newName)
      if (!result.ok) { setBusy(false); setError(result.error); return }
      finalName = result.data.name
      renameNote = `${result.data.merged ? 'Merged into' : 'Renamed to'} “${finalName}” on ${formatCount(result.data.total)} object${result.data.total === 1 ? '' : 's'}. `
    }
    // A new tag is kept in the registry even with no colour or description (keep).
    const styled = await setTagStyle(finalName, { color: color ?? 'auto', description, ...(tag ? {} : { keep: true }) })
    setBusy(false)
    if (!styled.ok) { setError(styled.error); return }
    await onSaved(tag ? `${renameNote}Saved “${finalName}”.` : `Created “${finalName}”. It's ready to pick wherever tags are added.`)
  }

  async function reset() {
    if (!tag) return
    setBusy(true)
    const result = await setTagStyle(tag.name, { color: 'auto', description: '' })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await onSaved(`“${tag.name}” is back to its automatic colour.`)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent size="md" title={tag ? `Tag “${tag.name}”` : 'New tag'} description={tag ? 'The colour and description apply everywhere this tag appears.' : 'Add a tag before anything uses it, so people can pick it.'}>
        <DialogBody className="space-y-4">
          <div className="flex items-center gap-2" aria-live="polite">
            <span className="text-xs text-fg-muted">Preview</span>
            <TagChip name={preview} size="md" color={color ?? undefined} description={null} />
            <TagChip name={preview} size="sm" color={color ?? undefined} description={null} />
            <TagChip name={preview} size="xs" color={color ?? undefined} description={null} />
          </div>
          {!tag && (
            <Field label="Name" error={duplicate ? `“${duplicate.name}” already exists` : undefined}>
              <Input value={name} maxLength={TAG_NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus data-tag-create-name />
            </Field>
          )}
          <Field label="Colour">
            <TagColorPicker name={preview} value={color} onChange={setColor} autoColor={autoColor} disabled={busy} />
          </Field>
          <Field label="Description" description="Shown when you hover over the tag." optional>
            <Textarea value={description} maxLength={TAG_DESCRIPTION_MAX} rows={2} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {tag && (
            <Field label="Name" description={`Renaming changes the tag on every object (${formatCount(tag.total)} you can see). An existing tag's name merges the two.`}>
              <Input value={name} maxLength={TAG_NAME_MAX} onChange={(e) => setName(e.target.value)} data-tag-rename />
            </Field>
          )}
          {error && <InlineNotice tone="error" message={error} />}
        </DialogBody>
        <DialogFooter>
          {tag?.styled && <Button variant="ghost" onClick={() => void reset()} disabled={busy} className="mr-auto">Reset to automatic</Button>}
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!tag && (!newName || Boolean(duplicate))} data-tag-save>
            {tag ? (renaming ? 'Rename and save' : 'Save') : 'Create tag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
