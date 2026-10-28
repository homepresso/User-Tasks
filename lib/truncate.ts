/**
 * Clamp a value to a max serialized size for storage (log rows, persisted node
 * outputs). Values that fit are returned as-is (same reference); larger ones
 * become `{ _truncated: true, _original_size, preview }` with the first
 * `maxBytes` characters of the JSON.
 */
export function truncateForStorage(value: unknown, maxBytes = 64 * 1024): unknown {
  if (value == null) return value
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    if (s === undefined || s.length <= maxBytes) return value
    return {
      _truncated: true,
      _original_size: s.length,
      preview: s.slice(0, maxBytes),
    }
  } catch {
    return { _truncated: true, _error: 'serialize failed' }
  }
}
