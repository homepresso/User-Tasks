"use client"

import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/format/date"
import { serverRead } from "@/lib/server-read"
import { normalizeTaskFields, valueFields } from "@/lib/task-field-schema"
import { listStagingKeys } from "@/lib/forms/form-rules"
import { formatFieldValue } from "@/components/forms/form-renderer"
import { lookupDisplayValue } from "@/components/forms/lookup-field"
import { AttachmentList } from "@/components/forms/attachments-field"
import { DataTableValueView } from "@/components/forms/data-table-field"
import { ListValueView } from "@/components/forms/list-field"
import { lookupItemKey } from "@/lib/forms/lookup"
import { isSectionIncluded, layoutSections, sectionFieldKeys } from "@/lib/forms/sections"

/* eslint-disable @typescript-eslint/no-explicit-any -- submission rows */

/** "View submission": my submission's values, read-only. */
export function SubmissionDialog({ submission, onClose }: { submission: { id: string; form_id: string; form_name: string } | null; onClose: () => void }) {
  const open = Boolean(submission)
  const { data, isLoading, error } = useQuery({
    queryKey: ["home", "submission", submission?.id],
    enabled: open,
    queryFn: async () => {
      const [sub, form] = await Promise.all([
        serverRead("forms.submission", { id: submission!.id }),
        serverRead("forms.submittable", { id: submission!.form_id }),
      ])
      if (sub.error) throw new Error(sub.error.message)
      return { sub: sub.data as any, form: form.data as any }
    },
  })
  // Inputs that only stage a List's rows (cleared by an "Add row to list" rule) are left out.
  const staging = listStagingKeys(data?.form?.layout)
  const fields = valueFields(normalizeTaskFields(data?.form?.fields ?? [])).filter((f) => !staging.has(f.key))
  const values = (data?.sub?.values ?? {}) as Record<string, unknown>
  const layout = data?.form?.layout
  const sections = layoutSections(layout)
  const sectionByField = new Map(sections.flatMap((s) => sectionFieldKeys(layout, s.key).map((k) => [k, s] as const)))
  const shownFields = fields.filter((f) => {
    const section = sectionByField.get(f.key)
    return !section || isSectionIncluded(section, values)
  })
  const extraKeys = !fields.length ? Object.keys(values).filter((k) => !k.startsWith("_")) : []

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent size="md" title={submission?.form_name ?? "Submission"} aria-describedby={undefined} data-testid="home-submission">
        <DialogBody className="text-ui">
          {isLoading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading"><Skeleton className="h-2.5 w-1/2" /><Skeleton className="h-2.5 w-2/3" /></div>
          ) : error ? <p role="alert" className="text-danger">{(error as Error).message}</p>
            : (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]">
                <dt className="text-fg-muted">Submitted</dt>
                <dd>{data?.sub?.created_at ? formatDateTime(data.sub.created_at) : "—"}</dd>
                {shownFields.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="text-fg-muted">{f.label}</dt>
                    <dd className="break-words">{f.type === "data_table" ? <DataTableValueView field={f} value={values[f.key]} /> : f.type === "list" ? <ListValueView field={f} value={values[f.key]} narrow /> : f.type === "attachments" ? <AttachmentList value={values[f.key]} /> : f.type === "lookup" ? lookupDisplayValue(f, values[f.key], values[lookupItemKey(f.key)], values[`${f.key}_label`]) : formatFieldValue(f, values[f.key])}</dd>
                  </div>
                ))}
                {extraKeys.map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-fg-muted">{k}</dt>
                    <dd className="break-words">{typeof values[k] === "object" ? JSON.stringify(values[k]) : String(values[k] ?? "")}</dd>
                  </div>
                ))}
              </dl>
            )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
