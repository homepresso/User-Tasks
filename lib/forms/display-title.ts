/**
 * A form title as people should read it (pure; __tests__/form-display-title.test.ts):
 * never a raw page / view identifier. Imports name pages after their source
 * views (InfoPath "NEW_SUBMISSION_PAGE"); a title like
 * "Expense claim — NEW_SUBMISSION_PAGE" shows as "Expense claim", and a
 * title that is only such an identifier is humanised ("New submission").
 */
const RAW_ID = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$|^[A-Z0-9_]*_(?:PAGE|VIEW)$/

export function humaniseIdentifier(id: string): string {
  const words = id.replace(/_(PAGE|VIEW)$/, '').toLowerCase().split(/[_\s]+/).filter(Boolean)
  const text = words.join(' ')
  return text ? text[0].toUpperCase() + text.slice(1) : id
}

export function displayFormTitle(title: string): string {
  const t = String(title ?? '').trim()
  if (!t) return t
  const parts = t.split(/\s+[—–-]\s+/)
  if (parts.length > 1 && RAW_ID.test(parts[parts.length - 1])) return parts.slice(0, -1).join(' — ')
  return RAW_ID.test(t) ? humaniseIdentifier(t) : t
}
