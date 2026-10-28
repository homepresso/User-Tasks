/**
 * The in-process `instance_settings` cache (written by ./instance-settings).
 * Separate so browser-shared modules (./public) can peek at it without
 * importing the database client.
 */

export const INSTANCE_SETTINGS_TTL_MS = 30_000

let cache: { at: number; values: Map<string, unknown> } | null = null

export function readSettingsCache(): Map<string, unknown> | null {
  return cache && Date.now() - cache.at < INSTANCE_SETTINGS_TTL_MS ? cache.values : null
}

export function writeSettingsCache(values: Map<string, unknown> | null): void {
  cache = values ? { at: Date.now(), values } : null
}

/**
 * Last loaded values even when older than the TTL (null before the first
 * load). For synchronous readers that must not flip back to defaults just
 * because nothing refreshed the cache recently (storage URL resolution).
 */
export function readSettingsCacheStale(): Map<string, unknown> | null {
  return cache ? cache.values : null
}
