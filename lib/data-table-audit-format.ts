/** A recorded old / new value as text for the change history (pure, client-safe): empty → "(empty)", objects → their label / JSON. */
export function auditValueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(empty)'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(auditValueText).join(', ') || '(empty)'
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const label = o.label ?? o.name ?? o.display_name ?? o.title ?? o.email
    if (label !== undefined && label !== null) return String(label).slice(0, 200)
    try { return JSON.stringify(v).slice(0, 200) } catch { return '(value)' }
  }
  return String(v).slice(0, 200)
}
