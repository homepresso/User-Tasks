'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CountBadge, Tag } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip } from '@/components/ui/tooltip'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { serverRead } from '@/lib/server-read'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'

/**
 * Pieces of the Forms library (components/forms/forms-library.tsx): the
 * toolbar's filter buttons and the details sheet of one form (where it is
 * used, the workflows it starts).
 */

export interface FormListItem {
  id: string; name: string; description: string | null; tags: string[]; version: number
  field_count: number; theme_source: string; usage_count: number; updated_at: string
  form_page_of?: { workflow_id: string; workflow_name: string | null } | null
  available_in_menu?: boolean
  /** Friendly link name (/form/<system_name>). */
  system_name?: string | null
  /** Unpublished edits (a working draft; lib/services/form-design-drafts). */
  has_draft?: boolean
  draft_updated_at?: string | null
}

export interface FormDetail {
  id: string; name: string; description: string | null; tags: string[]; version: number
  fields: unknown[]; layout: unknown; theme: unknown; updated_at: string
  usages: Array<{ workflow_id: string; workflow_name: string; node_id: string; node_label: string; node_type?: string; where: 'draft' | 'published'; pinned_version: number | null }>
  buttons?: unknown[] | null
}

/** The workflows a form starts: "Form submitted" triggers on it and its buttons' "Start workflow" actions. */
export function formStarts(form: FormDetail): Array<{ workflow_id: string; workflow_name: string; via: string }> {
  const out: Array<{ workflow_id: string; workflow_name: string; via: string }> = []
  const seen = new Set<string>()
  for (const u of form.usages) {
    if (u.node_type !== 'form_submitted' || seen.has(`${u.workflow_id}-t`)) continue
    seen.add(`${u.workflow_id}-t`)
    out.push({ workflow_id: u.workflow_id, workflow_name: u.workflow_name, via: 'Form submitted trigger' })
  }
  for (const b of normalizeFormButtons(form.buttons ?? null)) {
    for (const a of b.actions ?? []) {
      if (a.type !== 'start_workflow' || !a.workflow_id || seen.has(`${a.workflow_id}-${b.id}`)) continue
      seen.add(`${a.workflow_id}-${b.id}`)
      out.push({ workflow_id: a.workflow_id, workflow_name: a.workflow_name ?? 'Workflow', via: a.start_form_page ? `form page of its start form (“${b.label}” button)` : `“${b.label}” button` })
    }
  }
  return out
}

/** Labels of a form's theme source. */
export const THEME_SOURCE_LABELS: Record<string, string> = { workspace: 'Workspace', custom: 'Custom', saved: 'Saved theme' }

/**
 * A toolbar filter button with a menu: several values (checkboxes) or one
 * (radio). The trigger shows the label and how many values are chosen.
 */
export function FilterMenu({ label, options, selected, onChange, multiple = false, testId }: {
  label: string
  options: Array<{ value: string; label: string }>
  selected: string[]
  onChange: (selected: string[]) => void
  multiple?: boolean
  testId?: string
}) {
  const active = selected.length > 0
  const summary = !active ? null : multiple ? null : options.find((o) => o.value === selected[0])?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className={active ? 'border-border-strong' : undefined} trailingIcon={<ChevronDown />} data-filter={testId} aria-label={active ? `${label}: ${summary ?? `${selected.length} selected`}` : label}>
          {label}{summary ? <span className="font-normal text-fg-muted">: {summary}</span> : null}
          {multiple && active && <CountBadge count={selected.length} tone="brand" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[220px]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {multiple ? options.map((o) => (
          <DropdownMenuCheckboxItem key={o.value} checked={selected.includes(o.value)} onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => onChange(on ? [...selected, o.value] : selected.filter((v) => v !== o.value))}>
            {o.label}
          </DropdownMenuCheckboxItem>
        )) : (
          <DropdownMenuRadioGroup value={selected[0] ?? ''} onValueChange={(v) => onChange(v ? [v] : [])}>
            <DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem>
            {options.map((o) => <DropdownMenuRadioItem key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        )}
        {multiple && active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>Clear {label.toLowerCase()}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A relative date with the absolute one on hover. */
export function RelativeDate({ value }: { value: string }) {
  return <Tooltip content={formatAbsolute(value)}><time dateTime={value} className="whitespace-nowrap">{formatRelative(value)}</time></Tooltip>
}

/**
 * One form's details (the row's sheet): description, tags, where it is used
 * and the workflows that submitting it starts.
 */
export function FormDetailsSheet({ form, onClose }: { form: FormListItem | null; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ['form', form?.id],
    enabled: Boolean(form),
    queryFn: async () => (await serverRead('forms.get', { id: form!.id })).data as FormDetail | null,
  })
  const starts = detail ? formStarts(detail) : []
  return (
    <Sheet open={Boolean(form)} onOpenChange={(open) => { if (!open) onClose() }}>
      {form && (
        <SheetContent title={form.name} description={form.description ?? undefined} data-testid="form-details-sheet">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-ui">
              <dt className="text-fg-muted">Version</dt><dd><Tag mono>v{form.version}</Tag></dd>
              <dt className="text-fg-muted">Fields</dt><dd className="num">{plural(form.field_count, 'field')}</dd>
              <dt className="text-fg-muted">Theme</dt><dd>{THEME_SOURCE_LABELS[form.theme_source] ?? 'Custom'}</dd>
              <dt className="text-fg-muted">Updated</dt><dd><RelativeDate value={form.updated_at} /></dd>
              {form.available_in_menu && (<><dt className="text-fg-muted">Forms menu</dt><dd data-form-available>Shown to the people with access</dd></>)}
              {form.form_page_of && (
                <>
                  <dt className="text-fg-muted">Form page</dt>
                  <dd data-form-page-of={form.form_page_of.workflow_id}>
                    Starts <Link href={`/automations/${form.form_page_of.workflow_id}`} className="font-medium text-primary-text hover:underline">{form.form_page_of.workflow_name ?? 'its workflow'}</Link>
                  </dd>
                </>
              )}
              {form.tags.length > 0 && (<><dt className="text-fg-muted">Tags</dt><dd className="flex flex-wrap gap-1">{form.tags.map((t) => <Tag key={t}>{t}</Tag>)}</dd></>)}
            </dl>

            {starts.length > 0 && (
              <section data-testid="form-starts">
                <h3 className="mb-1.5 text-ui font-semibold">Submitting this form starts</h3>
                <ul className="space-y-1 text-ui">
                  {starts.map((st) => (
                    <li key={`${st.workflow_id}-${st.via}`}>
                      <Link href={`/automations/${st.workflow_id}`} className="font-medium text-primary-text hover:underline">{st.workflow_name}</Link>
                      <span className="text-fg-muted"> · {st.via}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section data-testid="form-usages">
              <h3 className="mb-1.5 text-ui font-semibold">Where it&apos;s used</h3>
              {isLoading || !detail ? (
                <div className="space-y-2" aria-busy="true"><Skeleton className="h-2.5 w-3/5" /><Skeleton className="h-2.5 w-2/5" /></div>
              ) : detail.usages.length === 0 ? (
                <p className="text-ui text-fg-muted">Not used by any workflow yet. Link it from a User Task or task trigger: Form → Use a saved form.</p>
              ) : (
                <ul className="space-y-1 text-ui">
                  {detail.usages.map((u, i) => (
                    <li key={i}>
                      <Link href={`/automations/${u.workflow_id}`} className="font-medium text-primary-text hover:underline">{u.workflow_name}</Link>
                      <span className="text-fg-muted"> › {u.node_label} · {u.where === 'published' ? `published, pinned to v${u.pinned_version ?? '?'}` : 'draft, follows the latest version'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </SheetContent>
      )}
    </Sheet>
  )
}
