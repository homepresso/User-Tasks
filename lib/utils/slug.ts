/** Slug helpers (pure, client-safe). */

/** Identifier/key slug: lowercase, every run of other characters → `_`, no leading or trailing `_`. */
export function toKeySlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** URL slug: lowercase, every run of other characters → `-`, no leading or trailing `-`, cut to `maxLength`. */
export function toUrlSlug(value: string, maxLength?: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return maxLength === undefined ? slug : slug.slice(0, maxLength)
}
