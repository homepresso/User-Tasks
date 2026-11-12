/**
 * "Share your solution" form: the messages people see before anything is
 * uploaded. The same limits as the form's fields and the listing schema
 * (lib/gallery/community CommunityListingSchema, COMMUNITY_LIMITS); the server
 * still validates everything, so this only says it sooner and in words.
 * Client-safe: no imports from the package validator.
 */

/** Mirrors COMMUNITY_LIMITS (asserted equal in the tests). */
export const SHARE_LIMITS = { packageMb: 5, screenshots: 6, screenshotMb: 2, maxTags: 8 } as const

export const SHARE_FIELD_LABELS = {
  file: 'Package file',
  title: 'Title',
  category: 'Category',
  summary: 'Summary',
  description: 'Description',
  tags: 'Tags',
  author_name: 'Author name',
  author_url: 'Author link',
  screenshots: 'Screenshots',
  notes: 'What changed in this version',
  sample_input: 'Sample input',
} as const

export type ShareField = keyof typeof SHARE_FIELD_LABELS

export interface ShareValues {
  file: { name: string } | null
  title: string
  category: string
  summary: string
  description: string
  tags: string
  author_name: string
  author_url: string
  screenshots: number
  notes: string
  sample_input: string
}

function length(field: string, value: string, min: number, max: number, what = 'characters'): string | null {
  const n = value.trim().length
  if (!n) return `Enter ${field.toLowerCase() === 'title' ? 'a title' : `the ${field.toLowerCase()}`}.`
  if (n < min) return `${field} needs at least ${min} ${what} (${n} so far).`
  if (n > max) return `${field} can be at most ${max} ${what} (${n} now).`
  return null
}

/** The tags the form sends: comma separated, trimmed, blanks dropped. */
export function splitTags(tags: string): string[] {
  return tags.split(',').map((t) => t.trim()).filter(Boolean)
}

/** One field's message, or null when it is fine. */
export function validateShareField(field: ShareField, v: ShareValues): string | null {
  switch (field) {
    case 'file':
      if (!v.file || !v.file.name) return 'Choose the .utpkg package file to upload.'
      if (!/\.utpkg$/i.test(v.file.name)) return `“${v.file.name}” is not a .utpkg package. Build one in Automations → Packages or with usertasks packages build.`
      return null
    case 'title': return length('Title', v.title, 3, 80)
    case 'category': return v.category ? null : 'Choose the category it belongs in.'
    case 'summary': return length('Summary', v.summary, 40, 200)
    case 'description': return length('Description', v.description, 100, 6000)
    case 'tags': {
      const tags = splitTags(v.tags)
      if (!tags.length) return 'Add at least one tag, for example visitors, reception.'
      if (tags.length > SHARE_LIMITS.maxTags) return `Use at most ${SHARE_LIMITS.maxTags} tags (${tags.length} now).`
      const bad = tags.find((t) => t.length < 2 || t.length > 30 || !/^[a-z0-9][a-z0-9 .+#-]*$/.test(t.toLowerCase()))
      if (bad) return `“${bad}” is not a tag: use words of 2-30 letters or digits, separated by commas.`
      return null
    }
    case 'author_name': return length('Author name', v.author_name, 2, 60)
    case 'author_url': {
      const url = v.author_url.trim()
      if (!url) return null
      try {
        const u = new URL(url)
        if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) return url.length > 300 ? 'The author link can be at most 300 characters.' : null
      } catch { /* falls through */ }
      return 'Enter a full link starting with https://, or leave it empty.'
    }
    case 'screenshots': return v.screenshots > SHARE_LIMITS.screenshots ? `Choose at most ${SHARE_LIMITS.screenshots} screenshots (${v.screenshots} chosen).` : null
    case 'notes': return v.notes.trim().length > 1000 ? `Version notes can be at most 1000 characters (${v.notes.trim().length} now).` : null
    case 'sample_input': {
      const sample = v.sample_input.trim()
      if (!sample) return null
      try {
        const parsed: unknown = JSON.parse(sample)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return null
      } catch { /* falls through */ }
      return 'Sample input must be a JSON object, for example {"visitor_name": "Grace Kim"}.'
    }
  }
}

/** Every field's message, in form order (only the fields with a problem). */
export function validateShareForm(v: ShareValues): Partial<Record<ShareField, string>> {
  const errors: Partial<Record<ShareField, string>> = {}
  for (const field of Object.keys(SHARE_FIELD_LABELS) as ShareField[]) {
    const message = validateShareField(field, v)
    if (message) errors[field] = message
  }
  return errors
}

/** The form's values as the validator reads them. */
export function shareValuesFrom(form: FormData): ShareValues {
  const file = form.get('file')
  const text = (name: string) => String(form.get(name) ?? '')
  return {
    file: typeof File !== 'undefined' && file instanceof File && file.name ? { name: file.name } : null,
    title: text('title'), category: text('category'), summary: text('summary'), description: text('description'), tags: text('tags'),
    author_name: text('author_name'), author_url: text('author_url'), notes: text('notes'), sample_input: text('sample_input'),
    screenshots: form.getAll('screenshots').filter((s) => typeof File !== 'undefined' && s instanceof File && s.size > 0).length,
  }
}
