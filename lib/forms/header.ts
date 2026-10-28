/**
 * The form header: an optional band above the fields with an image (the
 * UserTasks mark by default, the workspace logo or an uploaded image), a
 * title and a subtitle. A first-class form setting, independent of the
 * mini theme (whose banner colour it uses when one is set).
 *
 * Title and subtitle may hold {{placeholders}}: {{task_data.<key>}} /
 * {{form.<key>}} (the form's values, resolved as the form is drawn), the
 * task ({{task.title}}) and workflow variables (resolved when the task is
 * created). Uploaded images live in the storage provider
 * (`task-files/form-headers/<tenant>/…`, a storage:// reference or the
 * public URL) and are served through /files.
 *
 * Existing forms have no header (`null`); new forms start with one enabled.
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { pathValue } from './lookup'

export type FormHeaderImageSource = 'default' | 'workspace_logo' | 'upload' | 'none'

export interface FormHeader {
  enabled: boolean
  image: FormHeaderImageSource
  /** Uploaded image (image === 'upload'): storage reference or own-storage URL. */
  image_url?: string
  title?: string
  subtitle?: string
  align?: 'left' | 'center'
  /** Use the mini theme's banner colour behind the header. */
  banner?: boolean
}

/** The UserTasks mark shipped with the app. */
export const DEFAULT_HEADER_IMAGE = '/brand/mark.svg'
export const HEADER_IMAGE_BUCKET = 'task-files'
export const HEADER_IMAGE_FOLDER = 'form-headers'
export const HEADER_IMAGE_MAX_BYTES = 1024 * 1024
export const HEADER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const

const MAX_TITLE = 120
const MAX_SUBTITLE = 300

/** A new form's header: on, the UserTasks mark, its name as the title. */
export function defaultFormHeader(title = ''): FormHeader {
  return { enabled: true, image: 'default', ...(title ? { title: title.slice(0, MAX_TITLE) } : {}), align: 'left' }
}

/** Is this an uploaded header image of this app (storage:// ref, /files/ path or own Supabase public URL in the header folder)? */
export function isHeaderImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 600) return false
  const v = value.trim()
  if (/^storage:\/\/task-files\/form-headers\/[0-9a-f-]{36}\/[A-Za-z0-9_.-]+$/i.test(v)) return true
  if (/^\/files\/task-files\/form-headers\/[0-9a-f-]{36}\/[A-Za-z0-9_.-]+$/i.test(v)) return true
  return /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/task-files\/form-headers\/[0-9a-f-]{36}\/[A-Za-z0-9_.-]+$/i.test(v)
}

function text(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  // No markup: rendered as text, but keep stored values tidy.
  const s = raw.replace(/[<>]/g, '').trim()
  return s ? s.slice(0, max) : undefined
}

/** Stored / submitted header → a clean header, or null (none). */
export function normalizeFormHeader(raw: unknown): FormHeader | null {
  if (!isPlainObject(raw)) return null
  const image: FormHeaderImageSource = raw.image === 'workspace_logo' || raw.image === 'upload' || raw.image === 'none' ? raw.image : 'default'
  const out: FormHeader = { enabled: raw.enabled === true, image }
  if (image === 'upload') {
    if (isHeaderImageUrl(raw.image_url)) out.image_url = raw.image_url.trim()
    else out.image = 'default'
  }
  const title = text(raw.title, MAX_TITLE)
  const subtitle = text(raw.subtitle, MAX_SUBTITLE)
  if (title) out.title = title
  if (subtitle) out.subtitle = subtitle
  out.align = raw.align === 'center' ? 'center' : 'left'
  if (raw.banner === true) out.banner = true
  return out
}

const TEMPLATE_RE = /\{\{\s*([\w.\-[\]]+)\s*\}\}/g

/**
 * Resolve a header text's placeholders against the form's values and the
 * task: {{task_data.<key>}}, {{form.<key>}}, {{task.data.<key>}},
 * {{<key>}} (a field key), {{task.<column>}}. Unknown → ''. Objects are
 * shown by their `name` / `label` / first text value.
 */
export function resolveHeaderText(template: string | undefined, values: Record<string, unknown>, task?: Record<string, unknown> | null): string {
  if (!template) return ''
  return template.replace(TEMPLATE_RE, (_m, path: string) => {
    let v: unknown
    const field = /^(?:task_data|form|task\.data)\.(.+)$/.exec(path)
    if (field) v = pathValue(values, field[1])
    else if (/^task\./.test(path)) v = task ? pathValue(task, path.slice(5)) : undefined
    else v = pathValue(values, path)
    if (v === null || v === undefined) return ''
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? '' : String(x))).filter(Boolean).join(', ')
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      const first = o.name ?? o.label ?? o.title ?? Object.values(o).find((x) => typeof x === 'string')
      return typeof first === 'string' ? first : ''
    }
    return String(v)
  })
}

/** Header ready to draw (null when off). `workspaceLogo` = the workspace logo URL, if any. */
export function headerImageSrc(header: FormHeader, workspaceLogo?: string | null): string | null {
  if (header.image === 'none') return null
  if (header.image === 'upload' && header.image_url) return header.image_url
  if (header.image === 'workspace_logo') return workspaceLogo || DEFAULT_HEADER_IMAGE
  return DEFAULT_HEADER_IMAGE
}
