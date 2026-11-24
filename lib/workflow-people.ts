/**
 * The workspace's people for the USER_NAME(id) / USER_EMAIL(id) expression
 * functions (pure, client-safe; __tests__/workflow-people.test.ts).
 *
 * Expressions are synchronous, so the engine loads the directory before a
 * step that uses these functions runs (once per run, only when needed) and
 * hangs it on the run's variables under a Symbol key: it travels with the
 * scope to evaluateFunction but is never saved with the run's variables
 * (JSON ignores Symbol keys) and can't be read or set by a template. Only
 * people with a membership in the run's own workspace are in it. Outside a
 * workflow (form rules, app expressions) there is no directory and the
 * functions return "".
 */

export const PEOPLE = Symbol.for('usertasks.workflow.people')

export interface PersonEntry { name: string; email: string | null }
export type PeopleDirectory = ReadonlyMap<string, PersonEntry>

/** At most this many people are loaded (a larger workspace resolves the first ones by id order). */
export const PEOPLE_DIRECTORY_CAP = 5000

const FN_RE = /\bUSER_(?:NAME|EMAIL)\s*\(/

/** Does a step's config call USER_NAME / USER_EMAIL anywhere (any nesting)? */
export function usesPeopleFunctions(config: unknown): boolean {
  if (config === null || config === undefined) return false
  try { return FN_RE.test(typeof config === 'string' ? config : JSON.stringify(config)) } catch { return false }
}

/** A user id (or a person value { id } / { user_id }) → its directory entry, from the scope the engine prepared. */
export function lookupPerson(scope: unknown, ref: unknown): PersonEntry | null {
  const dir = scope && typeof scope === 'object' ? (scope as Record<symbol, unknown>)[PEOPLE] : undefined
  if (!(dir instanceof Map)) return null
  const id = typeof ref === 'string' ? ref.trim() : ref && typeof ref === 'object' ? String((ref as Record<string, unknown>).id ?? (ref as Record<string, unknown>).user_id ?? '') : ''
  return id ? (dir.get(id) as PersonEntry | undefined) ?? null : null
}

/** Membership + user rows → the directory (display name, else the email's local part). */
export function buildDirectory(users: ReadonlyArray<{ id: string; display_name?: string | null; full_name?: string | null; email?: string | null }>): Map<string, PersonEntry> {
  const out = new Map<string, PersonEntry>()
  for (const u of users.slice(0, PEOPLE_DIRECTORY_CAP)) {
    if (!u?.id) continue
    const email = u.email ? String(u.email) : null
    out.set(String(u.id), { name: String(u.display_name || u.full_name || (email ? email.split('@')[0] : '')).trim(), email })
  }
  return out
}
