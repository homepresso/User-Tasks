"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Save } from "lucide-react"
import { serverQuery } from "@/lib/server-read"
import { FORM_DRAFTS_LIST_KEY } from "@/components/forms/form-header-actions"
import type { FormDraftSummary } from "@/lib/services/form-drafts"
import { formAppPath } from "@/lib/forms/form-page-url"
import { usePermissions } from "@/lib/permissions-context"
import { Tooltip } from "@/components/ui/tooltip"
import { formatAbsolute, formatRelative } from "@/lib/format/date"

/** My saved form drafts (newest first); shared by the Drafts widget and the grid (which hides it when empty). */
export function useFormDrafts() {
  const { can } = usePermissions()
  const enabled = can("forms.submit")
  const query = useQuery({
    queryKey: FORM_DRAFTS_LIST_KEY,
    queryFn: async () => ((await serverQuery("home.formDrafts")) ?? []) as FormDraftSummary[],
    enabled,
    staleTime: 0,
    // Never restored from the session cache: a draft saved on a form page shows on the next visit.
    meta: { persist: false },
  })
  return { drafts: query.data ?? [], loading: enabled && query.isPending, enabled }
}

/** Home → Drafts: forms I saved a draft of. Outside edit mode Home hides it while there are none. */
export function DraftsWidget() {
  const { drafts, enabled } = useFormDrafts()
  if (!enabled) return null
  return (
    <section aria-labelledby="home-drafts" className="space-y-2" data-home-drafts>
      <h2 id="home-drafts" className="flex items-center gap-2 text-base font-semibold text-fg"><Save className="size-4 text-fg-muted" aria-hidden /> Drafts</h2>
      {drafts.length === 0 ? (
        <p className="text-ui text-fg-muted" data-home-drafts-empty>No drafts. Use <strong className="font-medium text-fg">Save draft</strong> on a form and it appears here.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {drafts.map((d) => (
            <li key={d.form_id}>
              <Tooltip content={`Saved ${formatAbsolute(d.updated_at)}`}>
                <Link href={formAppPath(d.form_id)} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-panel px-3 text-xs text-fg hover:border-border-strong hover:bg-subtle" data-home-draft={d.form_id}>
                  <span className="font-medium">{d.form_name}</span>
                  <span className="text-fg-muted">{formatRelative(d.updated_at)}</span>
                </Link>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
