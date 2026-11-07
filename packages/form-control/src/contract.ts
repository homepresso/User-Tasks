/**
 * The UserTasks form control contract: what a custom form control (a web
 * component, e.g. built with Lit) declares in its manifest, what the host
 * gives it, what it tells the host, and the postMessage bridge between the
 * form (the app's page) and the sandboxed frame the control runs in.
 *
 * Pure and isomorphic — shared by the app, the frame runtime, the starter
 * kit and the @usertasks/form-control package (packages/form-control keeps
 * a copy of the types; __tests__/form-control-contract checks they agree).
 *
 * ── Manifest (manifest.json beside the ES module) ─────────────────────────
 *   tag            custom element name (lowercase, contains a hyphen), the
 *                  control's identity in a workspace: `acme-star-rating`
 *   name           palette label; description; icon (a Lucide icon name in
 *                  kebab case, e.g. `star`, or an `data:image/svg+xml` URI)
 *   version        semver (`1.2.0`); each upload is a new immutable version
 *   entry          the ES module file in a zip package (default: the only
 *                  .js / .mjs file, or `index.js`)
 *   value          { type, schema?, default? } — what the field stores
 *   props          designer-editable properties (the properties panel)
 *   events         extra events it emits (documentation only)
 *   validation     { reports_validity?: boolean } — emits ut-validity
 *   size           { default_height?, min_height?, max_height?, full_width? }
 *   capabilities   host services it may request: lookup, files, network,
 *                  reports
 *   network        { allowed_hosts } — only effective once an admin approves
 *   context        other form values it needs (the designer maps each one
 *                  to a field)
 *   display        { template?, format? } — read-only rendering (completed
 *                  tasks, mobile): `{{value}}`, `{{value.path}}`,
 *                  `{{props.name}}`; format json / text / number / date / list
 *   accessibility  { role?, keyboard?, labelled_by_host? } — for the
 *                  accessibility checker and the docs
 *   dependencies   { name: version } bundled into the module (informational)
 *   author, license, homepage
 *
 * ── Element API (inside the frame) ────────────────────────────────────────
 *   The runtime creates one `<tag>` and sets these PROPERTIES:
 *     value, disabled, readonly, required, invalid, error, props, theme
 *     ({ mode, tokens }), locale, context, label, description
 *   plus each declared prop by name (`el.max = 5`) unless it clashes with a
 *   reserved name. Theme tokens are also CSS custom properties on :root
 *   (`--ut-primary`, …) so they inherit into the shadow DOM.
 *   The element DISPATCHES (bubbling, composed CustomEvents):
 *     ut-change   { value }            the user changed the value
 *     ut-blur     {}                   the user left the control
 *     ut-validity { valid, message? }  the control's own validity
 *     ut-resize   { height }           optional; the runtime also measures
 *     ut-request  { kind, payload, resolve, reject }  host services
 *   "No value" is null (the form's Required fails on null, '' and []).
 *   The host draws the field's label, help text and error message around
 *   the control; the control uses `label` / `description` / `error` as its
 *   accessible name / description and announcement (visually hidden).
 *   Tab moves through the control's stops; past its last (or before its
 *   first) the runtime hands focus back to the form.
 */

export const FORM_CONTROL_MANIFEST_VERSION = 1

/** Bridge protocol version (every message carries `ut: BRIDGE_VERSION`). */
export const BRIDGE_VERSION = 1

export const CONTROL_VALUE_TYPES = ['string', 'number', 'boolean', 'date', 'json', 'array', 'files'] as const
export type ControlValueType = (typeof CONTROL_VALUE_TYPES)[number]

export const CONTROL_PROP_TYPES = ['string', 'text', 'number', 'boolean', 'select', 'color', 'string[]', 'json'] as const
export type ControlPropType = (typeof CONTROL_PROP_TYPES)[number]

/**
 * lookup   suggestions from the field's lookup source (a data table or an API
 *          reference — the server calls it; keys never reach the control)
 * files    upload files (value type `files`) and read the bytes of files the
 *          form already gives the control (its own value or a context field)
 * network  fetch from the manifest's allowed hosts once an admin approves them;
 *          for tile.openstreetmap.org also `tile` requests (map tiles fetched by
 *          the UserTasks server, which public tile servers require)
 * reports  rows of the saved report the designer chose (`report_id` prop),
 *          run as the person filling in the form
 */
export const CONTROL_CAPABILITIES = ['lookup', 'files', 'network', 'reports'] as const
export type ControlCapability = (typeof CONTROL_CAPABILITIES)[number]

export const CONTROL_DISPLAY_FORMATS = ['text', 'json', 'number', 'date', 'list'] as const
export type ControlDisplayFormat = (typeof CONTROL_DISPLAY_FORMATS)[number]

/** A JSON Schema subset the server enforces on values (lib/forms/custom-controls/json-schema.ts). */
export interface ControlValueSchema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null' | Array<'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'>
  enum?: unknown[]
  const?: unknown
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: 'date' | 'date-time' | 'email' | 'uri'
  items?: ControlValueSchema
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  properties?: Record<string, ControlValueSchema>
  required?: string[]
  additionalProperties?: boolean | ControlValueSchema
  description?: string
  title?: string
}

export interface ControlValueSpec {
  type: ControlValueType
  schema?: ControlValueSchema
  default?: unknown
}

/**
 * What a control gives the WORKFLOW (and data picker, emails, rules) — its
 * output — as opposed to what it stores for itself (its value). A workflow
 * reads `<key>` as a primitive of `type`; when the value is an object that
 * is a projection of it (`primary`: a dot path, or `template`: text), the
 * whole value stays under `<key>_raw` and each `extras` entry becomes
 * `<key>_<suffix>`. `html`: the main output is HTML, sanitised by the
 * server (allowlist) — never trusted from the control. `choices`: what the
 * form author may pick as the main output (the first is the default), e.g.
 * HTML or Plain text. Without `output` the value is the output (as before).
 */
export const CONTROL_OUTPUT_TYPES = ['string', 'number', 'boolean', 'date', 'object', 'array'] as const
export type ControlOutputType = (typeof CONTROL_OUTPUT_TYPES)[number]

export interface ControlOutputChoice {
  value: string
  label: string
  primary?: string
  template?: string
  html?: boolean
}

export interface ControlOutputSpec {
  type: ControlOutputType
  /** Dot path into the value for the main output (absent: the value itself). */
  primary?: string
  /** Or a template (`{{value.path}}`, `{{props.name}}`) giving the main output as text. */
  template?: string
  /** The main output is HTML (sanitised on the server). */
  html?: boolean
  /** Sibling outputs: `<key>_<suffix>` ← a dot path into the value ('' = the whole value). */
  extras?: Record<string, string>
  /** Main outputs the form author can choose between (the first is the default). */
  choices?: ControlOutputChoice[]
  description?: string
}

/** Bounds the server enforces on outputs. */
export const OUTPUT_LIMITS = {
  /** Longest text output (characters). */
  stringChars: 200_000,
  extras: 10,
  choices: 6,
} as const

export interface ControlPropSpec {
  /** Property name on the element (camelCase or snake_case). */
  name: string
  label?: string
  type: ControlPropType
  description?: string
  default?: unknown
  /** select only. */
  options?: Array<string | { value: string; label?: string }>
  /** number bounds. */
  min?: number
  max?: number
  required?: boolean
}

export interface ControlEventSpec {
  name: string
  description?: string
}

export interface ControlSizeSpec {
  default_height?: number
  min_height?: number
  max_height?: number
  /** Take the full row width in the classic (no grid) layout. */
  full_width?: boolean
}

export interface ControlContextSpec {
  /** Name the control reads (`context.country`). */
  name: string
  label?: string
  description?: string
}

export interface ControlDisplaySpec {
  /** `{{value}}`, `{{value.path}}`, `{{props.name}}` — plain text, never HTML. */
  template?: string
  format?: ControlDisplayFormat
}

export interface ControlAccessibilitySpec {
  /** ARIA role of the interactive part (slider, radiogroup, combobox, …). */
  role?: string
  /** How a keyboard user operates it (shown in the docs / checker). */
  keyboard?: string
  /** The control uses the host's label / description (`label`, `description` properties) as its accessible name. Default true. */
  labelled_by_host?: boolean
}

export interface FormControlManifest {
  manifest_version: number
  tag: string
  name: string
  description?: string
  icon?: string
  version: string
  entry?: string
  value: ControlValueSpec
  props: ControlPropSpec[]
  events: ControlEventSpec[]
  validation: { reports_validity?: boolean }
  size: ControlSizeSpec
  capabilities: ControlCapability[]
  network?: { allowed_hosts: string[] }
  context: ControlContextSpec[]
  display?: ControlDisplaySpec
  /** What the workflow receives (absent: the value itself). */
  output?: ControlOutputSpec
  accessibility?: ControlAccessibilitySpec
  dependencies?: Record<string, string>
  author?: string
  license?: string
  homepage?: string
}

/** Properties the runtime owns; a declared prop may not use these names. */
export const RESERVED_ELEMENT_PROPERTIES: ReadonlySet<string> = new Set([
  'value', 'disabled', 'readonly', 'readOnly', 'required', 'invalid', 'error', 'props', 'theme', 'locale', 'context',
  'label', 'description', 'id', 'className', 'style', 'innerHTML', 'outerHTML', 'textContent', 'slot', 'hidden',
  'tabIndex', 'title', 'lang', 'dir', 'constructor', '__proto__', 'prototype',
])

/** Events the element dispatches. */
export const CONTROL_EVENTS = {
  change: 'ut-change',
  blur: 'ut-blur',
  validity: 'ut-validity',
  resize: 'ut-resize',
  request: 'ut-request',
} as const

/**
 * Theme tokens: CSS custom properties set on the frame's :root (and passed
 * as `theme.tokens`), resolved from the form's theme / mini theme in the
 * current mode. Keys are the names without the leading `--`.
 */
export const THEME_TOKENS = [
  'ut-primary', 'ut-on-primary', 'ut-primary-text', 'ut-primary-light',
  'ut-text', 'ut-muted-text', 'ut-surface', 'ut-card', 'ut-border',
  'ut-input-bg', 'ut-input-text', 'ut-focus-ring', 'ut-error', 'ut-success',
  'ut-radius', 'ut-font-family', 'ut-font-size',
] as const
export type ThemeToken = (typeof THEME_TOKENS)[number]

export interface ControlTheme {
  mode: 'light' | 'dark'
  tokens: Partial<Record<ThemeToken, string>>
}

/** Read-only context: other field values the control declared, plus ids. Never secrets or tokens. */
export interface ControlContext {
  fields: Record<string, unknown>
  form_id?: string | null
  task_id?: string | null
  workflow_id?: string | null
  field_key: string
}

/** Everything the host tells the control (init, then partial updates). */
export interface ControlState {
  value: unknown
  disabled: boolean
  readonly: boolean
  required: boolean
  invalid: boolean
  error: string | null
  props: Record<string, unknown>
  theme: ControlTheme
  locale: string
  context: ControlContext
  /** Accessible name and description (the host field's label / help text). */
  label: string
  description: string | null
  /** Capabilities this instance may use (declared ∩ granted). */
  capabilities: ControlCapability[]
}

// ── Bridge messages ─────────────────────────────────────────────────────────

/** host → frame */
export type HostMessage =
  | { ut: 1; channel: string; type: 'init'; state: ControlState }
  | { ut: 1; channel: string; type: 'update'; state: Partial<ControlState> }
  | { ut: 1; channel: string; type: 'focus'; from: 'start' | 'end' }
  | { ut: 1; channel: string; type: 'response'; request_id: string; ok: boolean; result?: unknown; error?: string }

/** frame → host */
export type FrameMessage =
  /** The runtime is running (before the module has defined the element): the host sends `init` at once. */
  | { ut: 1; channel: string; type: 'hello' }
  /** The element is mounted with the init state and has painted at its measured height. */
  | { ut: 1; channel: string; type: 'ready'; tag: string; version: string }
  | { ut: 1; channel: string; type: 'change'; value: unknown }
  | { ut: 1; channel: string; type: 'blur' }
  | { ut: 1; channel: string; type: 'focus' }
  | { ut: 1; channel: string; type: 'validity'; valid: boolean; message?: string }
  | { ut: 1; channel: string; type: 'resize'; height: number }
  | { ut: 1; channel: string; type: 'request'; request_id: string; kind: ControlRequestKind; payload: unknown }
  | { ut: 1; channel: string; type: 'focus-exit'; direction: 'forward' | 'backward' }
  | { ut: 1; channel: string; type: 'error'; message: string }

export const CONTROL_REQUEST_KINDS = ['lookup', 'upload', 'file', 'report', 'tile'] as const
export type ControlRequestKind = (typeof CONTROL_REQUEST_KINDS)[number]

/** Capability a request kind needs. */
export const REQUEST_CAPABILITY: Record<ControlRequestKind, ControlCapability> = {
  lookup: 'lookup',
  upload: 'files',
  file: 'files',
  report: 'reports',
  tile: 'network',
}

/** `lookup` request payload → result. */
export interface LookupRequest { query: string }
/** `fields`: the item's configured fields (display, value and fill fields of the lookup source); `data` is the older name, kept for controls built against it. */
export interface LookupResult { items: Array<{ value: string; label: string; description?: string; fields?: Record<string, unknown>; data?: Record<string, unknown> }>; truncated?: boolean }

/** `upload` request payload (one file) → result (a stored file reference). */
export interface UploadRequest { name: string; type: string; bytes: ArrayBuffer }
export interface UploadResult { id: string; name: string; size: number; type: string }

/**
 * `file` request payload → result: the bytes of a file the form already gave
 * the control (an entry of its own `files` value, or of a context field's
 * value). Any other id is refused by the host.
 */
export interface FileRequest { id: string }
export interface FileResult { id: string; name: string; type: string; size: number; bytes: ArrayBuffer }

/**
 * `report` request payload → result: the saved report the designer chose for
 * this field (the `report_id` prop, read by the server from the stored form —
 * never from the control), run with the permissions of the person filling in
 * the form. `limit` caps the rows (default 200, at most 1000).
 */
export interface ReportRequest { limit?: number }
export interface ReportResult {
  report: { id: string; name: string; description: string | null; visualization: string | null }
  columns: Array<{ key: string; label: string; type: string }>
  rows: Array<Record<string, unknown>>
  total: number
  truncated: boolean
}

/**
 * `tile` request payload → result: one OpenStreetMap raster tile, fetched and
 * cached by the UserTasks server (public tile servers refuse requests without
 * a referrer, which a sandboxed frame never sends). Only for controls whose
 * approved hosts include tile.openstreetmap.org. z 0-19, x / y within 2^z.
 */
export interface TileRequest { z: number; x: number; y: number }
export interface TileResult { type: string; bytes: ArrayBuffer }

export const BRIDGE_LIMITS = {
  /** Largest serialised value a control may report (bytes of JSON). */
  valueBytes: 256 * 1024,
  /** Largest file a control may hand over for upload. */
  uploadBytes: 25 * 1024 * 1024,
  /** Height bounds the host enforces whatever the manifest says. */
  minHeight: 24,
  maxHeight: 2000,
  /** Requests in flight per control instance. */
  maxPendingRequests: 8,
  /** Validity / error message length. */
  messageLength: 500,
} as const

/** Limits on a package (upload, URL import). */
export const PACKAGE_LIMITS = {
  /** The ES module (dependencies bundled; 2 MB fits a PDF renderer with its worker inlined). */
  moduleBytes: 2 * 1024 * 1024,
  /** A zip package. */
  zipBytes: 3 * 1024 * 1024,
  manifestBytes: 64 * 1024,
  props: 50,
  context: 20,
  valueSchemaBytes: 16 * 1024,
} as const
