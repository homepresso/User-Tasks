'use client'

import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { getObjectPermissions } from '@/app/actions/object-permissions'
import { availabilityHint, availabilityStatus } from '@/lib/forms/available-forms'

/** The form's grants (the same query the Access list uses, so adding / removing a grant updates both). */
function useFormGrants(formId: string | null | undefined) {
  return useQuery({
    queryKey: ['object-permissions', 'form', formId],
    queryFn: () => getObjectPermissions('form', formId!),
    enabled: Boolean(formId),
  })
}

/** "Shown to 2 people and 1 team (3 grants)" under the Available forms checkbox (existing forms with grants). */
export function FormAvailabilityStatus({ formId }: { formId: string | null | undefined }) {
  const { data: grants } = useFormGrants(formId)
  const status = grants ? availabilityStatus(grants) : null
  if (!status) return null
  return <span className="mt-0.5 block font-medium" data-available-status>{status}.</span>
}

/**
 * The note when Available forms and the grants disagree (lib/forms/available-forms.ts
 * availabilityHint): grants but not ticked → "Turn on" (saves at once); ticked but no grants.
 */
export function FormAvailabilityHint({ formId, available, onTurnOn, busy }: {
  formId: string | null | undefined
  available: boolean
  onTurnOn: () => void
  busy?: boolean
}) {
  const { data: grants } = useFormGrants(formId)
  if (!grants) return null
  const hint = availabilityHint({ available, grants })
  if (!hint) return null
  return (
    <div role="status" className={cn('flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-fg', hint.tone === 'warning' ? 'border-warning' : 'border-border')} data-available-hint={hint.action ? 'turn-on' : 'no-grants'}>
      <span className="min-w-0 flex-1">{hint.text}</span>
      {hint.action === 'turn_on' && (
        <button type="button" onClick={onTurnOn} disabled={busy}
          className="shrink-0 rounded border px-2 py-0.5 text-2xs font-medium disabled:opacity-50 border-primary text-primary-text"
          aria-label="Turn on Available forms" data-available-turn-on>
          {busy ? 'Turning on…' : 'Turn on'}
        </button>
      )}
    </div>
  )
}
