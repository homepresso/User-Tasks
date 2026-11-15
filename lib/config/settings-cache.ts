/**
 * The in-process `instance_settings` cache (written by ./instance-settings).
 * Separate so browser-shared modules (./public) can peek at it without
 * importing the database client.
 */

export const INSTANCE_SETTINGS_TTL_MS = 30_000

/*
 * Kept on globalThis so every bundle in the server process sees the same
 * copy: proxy.ts is bundled separately from the app routes, and its
 * synchronous readers (CSP sources, trusted embedding) would otherwise only
 * ever see an empty cache.
 */
type CacheEntry = { at: number; values: Map<string, unknown> }
const SLOT = Symbol.for('usertasks.instanceSettingsCache')
const holder = globalThis as unknown as { [SLOT]?: CacheEntry | null }

export function readSettingsCache(): Map<string, unknown> | null {
  const cache = holder[SLOT]
  return cache && Date.now() - cache.at < INSTANCE_SETTINGS_TTL_MS ? cache.values : null
}

export function writeSettingsCache(values: Map<string, unknown> | null): void {
  holder[SLOT] = values ? { at: Date.now(), values } : null
}

/**
 * Last loaded values even when older than the TTL (null before the first
 * load). For synchronous readers that must not flip back to defaults just
 * because nothing refreshed the cache recently (storage URL resolution).
 */
export function readSettingsCacheStale(): Map<string, unknown> | null {
  return holder[SLOT]?.values ?? null
}
