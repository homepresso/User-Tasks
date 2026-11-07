import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'

/**
 * The loading state of a form page (/f/<id>, /form/<name>, /p/<token>,
 * /fill/<id>): a skeleton of the form card — header, a few fields, the
 * button bar — with a spinner pill over it, shaped like the real card so
 * nothing jumps when the form arrives. Drawn with the design tokens, so it
 * takes the workspace theme where one is set (the member pages) and the
 * UserTasks colours elsewhere.
 *
 * Server-safe (no hooks): used as a route `loading.tsx` / Suspense fallback
 * and by StandaloneForm while the form loads. It fades in after a short
 * delay (`.form-loading` in app/globals.css) so quick loads don't flash;
 * no motion under prefers-reduced-motion.
 *
 * `compact` (embedded in another site): just the spinner and a line of text
 * on a transparent background — the host page sizes the frame from it, and
 * EmbedFrame posts the new height once the form is in.
 */
export function FormLoading({ compact = false, label = 'Loading form', className }: { compact?: boolean; label?: string; className?: string }) {
  if (compact) {
    return (
      <div role="status" aria-live="polite" className={cn('form-loading flex items-center justify-center gap-2.5 py-10 text-sm text-fg-muted', className)} data-form-loading="compact">
        <Spinner size="sm" decorative className="text-primary-text" />
        <span>{label}…</span>
      </div>
    )
  }
  const bar = 'ds-skeleton block'
  return (
    <div role="status" aria-live="polite" className={cn('form-loading relative mx-auto w-full max-w-3xl', className)} data-form-loading="card">
      <span className="sr-only">{label}…</span>
      <div aria-hidden="true" className="overflow-hidden rounded-lg border border-border bg-panel shadow-elev-1">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className={cn(bar, 'h-4 w-2/5 rounded')} />
          <span className={cn(bar, 'ml-auto size-6 rounded-md')} />
        </div>
        <div className="space-y-5 p-5 sm:p-7">
          {[28, 36, 22].map((w, i) => (
            <div key={i} className="space-y-2">
              <span className={cn(bar, 'h-2.5 rounded')} style={{ width: `${w}%` }} />
              <span className={cn(bar, 'h-10 w-full rounded-md opacity-70')} />
            </div>
          ))}
          <div className="space-y-2">
            <span className={cn(bar, 'h-2.5 w-1/5 rounded')} />
            <span className={cn(bar, 'h-24 w-full rounded-md opacity-70')} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <span className={cn(bar, 'h-10 w-24 rounded-md')} />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3.5 py-1.5 text-xs font-medium text-fg-muted shadow-elev-2">
          <Spinner size="sm" decorative className="text-primary-text" />
          {label}…
        </span>
      </div>
    </div>
  )
}
