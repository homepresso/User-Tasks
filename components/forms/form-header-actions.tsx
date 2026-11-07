"use client"

import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Save } from "lucide-react"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import { deleteFormDraft, saveFormDraft } from "@/app/actions/forms"
import { FavoriteStar } from "@/components/home/favorite-star"
import { draftBytes, draftPrompt, formActions, FORM_DRAFT_MAX_BYTES } from "@/lib/forms/form-actions"
import type { FormDraft } from "@/lib/services/form-drafts"
import { cn } from '@/lib/utils'

/**
 * The icons in a form's top-right corner (lib/forms/form-actions.ts): the
 * favourite heart and Save draft, plus the "Resume your draft?" prompt.
 * Used on /f/<id> and in the Run dialog of a workflow that starts from a
 * form. Both icons follow the designer's settings (on by default) and need
 * forms.submit (a signed-in person who can fill the form in).
 */

export const formDraftKey = (formId: string) => ["form-draft", formId] as const
export const FORM_DRAFTS_LIST_KEY = ["home", "form-drafts"] as const

/** Values worth keeping: what the person typed, not the form's own context entries. */
function ownValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !k.startsWith("__")))
}

/** The person's saved draft of a form and the save / discard operations. */
export function useFormDraft(formId: string | null, layout: unknown) {
  const { can } = usePermissions()
  const enabled = Boolean(formId) && can("forms.submit") && formActions(layout).draft
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: formDraftKey(formId ?? ""),
    queryFn: async () => (await serverQuery("forms.draft", { id: formId! })) as FormDraft | null,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // Never restored from the session cache: a reload always asks the server.
    meta: { persist: false },
  })
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle")
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function save(values: Record<string, unknown>, params: Record<string, unknown> | null = null): Promise<boolean> {
    if (!formId || state === "saving") return false
    setError(null)
    const own = ownValues(values)
    delete own.submission  // the reserved run variable (lib/forms/submission-meta.ts) is never part of a draft
    if (draftBytes(own, params) > FORM_DRAFT_MAX_BYTES) { setError("This draft is too large to save."); return false }
    setState("saving")
    const result = await saveFormDraft(formId, { values: own, params })
    if (!result.ok) { setState("idle"); setError(result.error); return false }
    setState("saved")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState("idle"), 2500)
    void queryClient.invalidateQueries({ queryKey: FORM_DRAFTS_LIST_KEY })
    // The draft just saved is not offered back on this visit.
    queryClient.setQueryData(formDraftKey(formId), null)
    return true
  }

  async function discard(): Promise<void> {
    if (!formId) return
    queryClient.setQueryData(formDraftKey(formId), null)
    await deleteFormDraft(formId)
    void queryClient.invalidateQueries({ queryKey: FORM_DRAFTS_LIST_KEY })
  }

  /** After a submission (the server deleted the draft): forget it here too. */
  function submitted(): void {
    if (!formId) return
    queryClient.setQueryData(formDraftKey(formId), null)
    void queryClient.invalidateQueries({ queryKey: FORM_DRAFTS_LIST_KEY })
  }

  return { enabled, draft: enabled ? query.data ?? null : null, state, error, save, discard, submitted }
}

export type FormDraftState = ReturnType<typeof useFormDraft>

/**
 * Heart + Save draft. `inHeader`: on the title's row in the form header's
 * top-right corner (FormHeaderBlock's `actions`, never over the header image
 * or title); otherwise right-aligned on a row of their own above the form.
 * 40px tap targets on phones.
 */
export function FormHeaderActions({ form, drafts, onSave, inHeader = false }: {
  form: { id: string; name: string; description?: string | null; layout: unknown }
  drafts: FormDraftState
  onSave: () => void
  inHeader?: boolean
}) {
  const { can } = usePermissions()
  const show = formActions(form.layout)
  const heart = show.favorite && can("forms.submit")
  if (!heart && !drafts.enabled) return null
  return (
    <div className={cn('flex items-center justify-end gap-1', inHeader ? 'max-w-[45vw] flex-wrap sm:max-w-xs' : 'mb-1 flex-wrap')} data-form-actions>
      {drafts.error && <span className={cn('mr-1 text-xs text-(--status-blocked)', inHeader && 'basis-full text-right')} role="alert">{drafts.error}</span>}
      <span className="sr-only" role="status" aria-live="polite">{drafts.state === "saved" ? "Draft saved" : ""}</span>
      {heart && (
        <FavoriteStar formId={form.id} name={form.name} description={form.description ?? null} icon="heart" size={18}
          className="h-10 min-w-10 rounded-md sm:h-9 sm:min-w-9" />
      )}
      {drafts.enabled && (
        <Tooltip content={drafts.state === "saved" ? "Saved — your answers are kept until you submit" : "Save as draft"}>
          <button type="button" onClick={onSave} disabled={drafts.state === "saving"}
            aria-label={drafts.state === "saved" ? "Draft saved" : "Save as draft"}
            className={cn('inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle hover:text-fg disabled:opacity-60 sm:h-9 sm:min-w-9', drafts.state === "saved" ? 'text-success' : 'text-fg-muted')}
            data-save-draft={drafts.state}>
            {drafts.state === "saving" ? <Loader2 size={18} className="animate-spin" aria-hidden /> : drafts.state === "saved" ? <Check size={18} aria-hidden /> : <Save size={18} aria-hidden />}
            {drafts.state === "saved" && <span>Saved</span>}
          </button>
        </Tooltip>
      )}
    </div>
  )
}

/** "Resume your draft from <date>?" — Resume / Start fresh. */
export function DraftResumePrompt({ draft, onResume, onFresh }: { draft: FormDraft; onResume: () => void; onFresh: () => void }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-primary-wash px-3 py-2 text-sm text-fg" role="status" data-draft-prompt>
      <Save className="shrink-0 text-primary-text" size={16} aria-hidden />
      <span className="flex-1">{draftPrompt(draft.updated_at)}</span>
      <Button type="button" size="sm" variant="secondary" onClick={onFresh} data-draft-fresh>Start fresh</Button>
      <Button type="button" size="sm" onClick={onResume} data-draft-resume>Resume</Button>
    </div>
  )
}
