/**
 * Notices of an embedded designer page before the designer can show
 * (lib/embed/designer-route.tsx): not a member, not allowed, or a page that
 * opens in UserTasks — with the way back to the host page. Signed out uses
 * the shared components/embed/embed-sign-in.tsx. Server components.
 */

export function EmbedNotice({ title, body, backHref, backLabel, openHref }: { title: string; body: string; backHref?: string | null; backLabel?: string | null; openHref?: string | null }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center" data-embed-notice="">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-sm text-fg-muted">{body}</p>
      <div className="flex gap-2">
        {openHref && <a className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg" href={openHref} target="_blank" rel="noopener">Open in UserTasks</a>}
        {backHref && <a className="rounded-md border border-border px-4 py-2 text-sm" href={backHref} target="_top">{backLabel ?? 'Back'}</a>}
      </div>
    </main>
  )
}
