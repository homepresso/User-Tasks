/**
 * One page of an app inside the dashboard shell (/apps/<slug>/<page>).
 * Drawn by the app's layout (app/(dashboard)/apps/[slug]/layout.tsx), which
 * stays mounted across the app's pages; this segment only gives the address a
 * route. Who can open it is the app's audience and editors, and the page's
 * lowest app role (lib/services/apps.ts, checked on every navigation by the
 * view's server read); ?edit=1 opens the builder for its editors.
 */
export default function AppPage() {
  return null
}
