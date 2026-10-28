/** Shared with the browser heartbeat (no server imports here: lib/last-seen pulls in the database client). */
export const LAST_SEEN_TOUCH_INTERVAL_MS = 5 * 60 * 1000
export const LAST_SEEN_STORAGE_PREFIX = 'ut:last-seen:'
