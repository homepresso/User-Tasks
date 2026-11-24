/**
 * The UserTasks side menu inside an app (/apps/<slug>…): apps get the room,
 * so the menu folds to its icon rail as soon as an app opens — the builder
 * (?edit=1) too — unless the app's settings turn that off
 * (nav.collapse_shell_menu). The person's own choice (the persisted
 * `sidebarCollapsed` preference) is never touched: leaving the app shows the
 * menu as they left it. Expanding it inside an app is a session-only
 * override for that visit: it is forgotten once they leave the app, so the
 * next visit folds the menu again. Phones keep their drawer (the side menu
 * is desktop-only), and the full-screen / embed views have no side menu.
 *
 * Pure: the store (stores/app-shell-store.ts) and the sidebar use these.
 */

/** A visit's own choice: the menu shown expanded / collapsed while in this app. */
export interface ShellMenuOverride {
  appSlug: string
  collapsed: boolean
}

/** The app an address belongs to: /apps/<slug>[/<page>] → <slug>; anything else (the Apps list included) → null. */
export function appSlugFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null
  const m = /^\/apps\/([^/?#]+)/.exec(pathname)
  if (!m) return null
  let slug: string
  try { slug = decodeURIComponent(m[1]) } catch { return null }
  return slug || null
}

/**
 * The key the dashboard frame gives its content area (`<main key=…>`):
 * every page of one app shares it, so moving between the app's pages keeps
 * the app's header and navigation mounted; any other address is its own.
 */
export function shellContentKey(pathname: string): string {
  const slug = appSlugFromPath(pathname)
  return slug ? `/apps/${slug}` : pathname
}

/** Is the side menu collapsed? */
export function effectiveSidebarCollapsed(input: {
  /** The person's persisted preference (outside apps). */
  preference: boolean
  /** The app on screen (appSlugFromPath), or null. */
  appSlug: string | null
  /** The app's "Collapse the UserTasks menu in this app" (default on; unknown until the app loads = on). */
  autoCollapse?: boolean
  override?: ShellMenuOverride | null
}): boolean {
  const { preference, appSlug, autoCollapse = true, override } = input
  if (!appSlug) return preference
  if (override && override.appSlug === appSlug) return override.collapsed
  return autoCollapse ? true : preference
}

/** The override after the address changed: dropped once the visit to its app ends. */
export function reconcileOverride(override: ShellMenuOverride | null, appSlug: string | null): ShellMenuOverride | null {
  return override && override.appSlug === appSlug ? override : null
}

/**
 * The collapse toggle: outside an app it flips the person's preference;
 * inside one it sets the visit's override (the preference stays as it was).
 */
export function toggleShellMenu(input: { preference: boolean; appSlug: string | null; autoCollapse?: boolean; override?: ShellMenuOverride | null }):
  { preference: boolean; override: ShellMenuOverride | null } {
  const current = effectiveSidebarCollapsed(input)
  if (!input.appSlug) return { preference: !input.preference, override: input.override ?? null }
  return { preference: input.preference, override: { appSlug: input.appSlug, collapsed: !current } }
}

/**
 * The data to keep on screen while another page of the app loads: the previous page's (so the app's header
 * and navigation stay), but only within the same app, mode and preview role — the builder never starts from
 * the published page, nor Preview from the builder's draft.
 */
export function appPageSwitchPlaceholder<T>(previous: T | undefined, previousKey: readonly unknown[] | undefined, current: { appSlug: string; mode: string; asRole: string | null }): T | undefined {
  if (!previous || !previousKey) return undefined
  const [, , slug, , mode, asRole] = previousKey
  return slug === current.appSlug && mode === current.mode && (asRole ?? null) === current.asRole ? previous : undefined
}
