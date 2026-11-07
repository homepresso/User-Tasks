'use client'
import { cn } from '@/lib/utils'

/**
 * "Allow for anonymous" on a server step (call an API, change tables, start
 * a workflow): on a public form link (anonymous forms) the step is skipped
 * unless this is ticked. Ticked: anyone with the link can make it run.
 */
export function AnonymousStepToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className={cn('rounded border px-1.5 py-1', checked ? 'border-danger' : 'border-border')} data-anonymous-step>
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid="anonymous-step" />
        Allow for anonymous
      </label>
      <p className={cn('mt-0.5 text-2xs', checked ? 'text-danger' : 'text-fg-muted')}>
        {checked
          ? 'Anyone with the form’s public link can run this step — with the integration’s credentials / the workflow’s authority.'
          : 'Public form links skip this step (visitors who aren’t signed in).'}
      </p>
    </div>
  )
}
