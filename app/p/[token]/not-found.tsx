import { Link2Off } from 'lucide-react'

/** Every unavailable public form link: unknown, rotated, or switched off (nothing says which). */
export default function PublicFormNotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-lg border border-border bg-panel p-8 text-center shadow-elev-1" data-public-form-missing>
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-fg-muted" aria-hidden><Link2Off size={20} /></span>
      <h1 className="text-base font-semibold">This form is not available</h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        The link may have changed or the form is no longer taking responses. Ask whoever shared it for a new link.
      </p>
    </div>
  )
}
