'use client'

/**
 * /embed/forms: "Choose a form" for a host whose form setting is still empty
 * (an add-in part, an SPFx web part, any page builder). Lists the forms the
 * signed-in person can open, searchable; picking one shows the value to put
 * in the host's setting (the form id) with a Copy button, and tells the host
 * page `{ type: 'usertasks:form-picked', form_id, name }` so a host that can
 * write its own setting (an SPFx property pane) does it for them.
 */

import { useMemo, useState } from 'react'
import { filterAvailableForms, type AvailableForm } from '@/lib/forms/available-forms'
import { postToHost } from '@/lib/embed/host-messages'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/input'

export const FORM_PICKED_MESSAGE_TYPE = 'usertasks:form-picked'

export function EmbedFormPicker({ forms, pasteHint }: { forms: AvailableForm[]; pasteHint: string | null }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<AvailableForm | null>(null)
  const [copied, setCopied] = useState(false)
  const shown = useMemo(() => filterAvailableForms(forms, q), [forms, q])

  const pick = (form: AvailableForm) => {
    setPicked(form); setCopied(false)
    postToHost({ type: FORM_PICKED_MESSAGE_TYPE, form_id: form.id, name: form.name })
  }
  const copy = async () => {
    if (!picked) return
    try { await navigator.clipboard.writeText(picked.id); setCopied(true) } catch {
      const el = document.getElementById('ut-picked-id') as HTMLInputElement | null
      el?.select()
    }
  }

  return (
    <div className="ut-embed-fade flex flex-col gap-3 p-1 text-sm" data-embed-form-picker>
      <style>{'@keyframes ut-embed-fade{from{opacity:0}to{opacity:1}}.ut-embed-fade{animation:ut-embed-fade .18s ease-out both}'}</style>
      <div>
        <h2 className="text-base font-semibold text-fg">Choose a form</h2>
        <p className="text-fg-muted">Pick the UserTasks form this part shows.</p>
      </div>
      {picked && (
        <div className="rounded-md border border-border bg-subtle p-3" role="status">
          <div className="font-medium text-fg">{picked.name}</div>
          <p className="mt-1 text-fg-muted">{pasteHint ?? 'Copy this value into the form setting, then save.'}</p>
          <div className="mt-2 flex gap-2">
            <input id="ut-picked-id" readOnly value={picked.id} className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2 py-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Form id" />
            <Button size="sm" onClick={() => { void copy() }}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
        </div>
      )}
      {forms.length > 6 && <div className="max-w-sm"><SearchInput size="sm" value={q} onValueChange={setQ} placeholder="Search forms" aria-label="Search forms" /></div>}
      <ul className="divide-y divide-border border-y border-border">
        {shown.length === 0 && <li className="py-6 text-center text-fg-muted">{forms.length ? `No forms match “${q}”.` : 'There are no forms you can open yet.'}</li>}
        {shown.map((form) => (
          <li key={form.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-fg">{form.name}</div>
              {form.description && <div className="truncate text-xs text-fg-muted">{form.description}</div>}
            </div>
            <Button size="sm" variant={picked?.id === form.id ? 'primary' : 'secondary'} onClick={() => pick(form)}>{picked?.id === form.id ? 'Chosen' : 'Choose'}</Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
