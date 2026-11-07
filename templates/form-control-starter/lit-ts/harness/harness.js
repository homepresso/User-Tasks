/**
 * Mock UserTasks host for developing a custom form control.
 *
 * Does what the real runtime does inside the control's frame: loads
 * manifest.json and the ES module, creates ONE <tag> element, sets the host
 * properties (value, disabled, readonly, required, invalid, error, props,
 * theme, locale, context, label, description) plus each declared prop by
 * name, puts the theme tokens on :root, answers ut-request (lookup / upload)
 * when the capability is declared and granted, measures the height within
 * manifest size.min_height / max_height — and logs every ut-* event.
 *
 * It is a development aid, not the sandbox: the real frame also applies a
 * strict CSP (no network unless approved) and the server validates values.
 */

const RESERVED = new Set([
  'value', 'disabled', 'readonly', 'readOnly', 'required', 'invalid', 'error', 'props', 'theme', 'locale', 'context',
  'label', 'description', 'id', 'className', 'style', 'innerHTML', 'outerHTML', 'textContent', 'slot', 'hidden',
  'tabIndex', 'title', 'lang', 'dir', 'constructor', '__proto__', 'prototype',
])
const REQUEST_CAPABILITY = { lookup: 'lookup', upload: 'files' }
const VALUE_BYTES = 256 * 1024
const MIN_HEIGHT = 24
const MAX_HEIGHT = 2000

/** Example tokens; the real values come from the form's theme in the current mode. */
const THEMES = {
  light: {
    'ut-primary': '#2563eb', 'ut-on-primary': '#ffffff', 'ut-primary-text': '#1d4ed8', 'ut-primary-light': '#dbeafe',
    'ut-text': '#111827', 'ut-muted-text': '#4b5563', 'ut-surface': '#f9fafb', 'ut-card': '#ffffff', 'ut-border': '#d1d5db',
    'ut-input-bg': '#ffffff', 'ut-input-text': '#111827', 'ut-focus-ring': '#2563eb', 'ut-error': '#b91c1c', 'ut-success': '#15803d',
    'ut-radius': '8px', 'ut-font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif', 'ut-font-size': '14px',
  },
  dark: {
    'ut-primary': '#60a5fa', 'ut-on-primary': '#0b1220', 'ut-primary-text': '#93c5fd', 'ut-primary-light': '#1e3a8a',
    'ut-text': '#f3f4f6', 'ut-muted-text': '#9ca3af', 'ut-surface': '#0b1220', 'ut-card': '#111827', 'ut-border': '#374151',
    'ut-input-bg': '#0f172a', 'ut-input-text': '#f3f4f6', 'ut-focus-ring': '#93c5fd', 'ut-error': '#f87171', 'ut-success': '#4ade80',
    'ut-radius': '8px', 'ut-font-family': 'system-ui, -apple-system, "Segoe UI", sans-serif', 'ut-font-size': '14px',
  },
}

const $ = (id) => document.getElementById(id)
const moduleUrl = document.querySelector('meta[name="ut-module"]').content

const manifest = await fetch('../manifest.json', { cache: 'no-store' }).then((r) => r.json())
document.title = `${manifest.name} — control harness`
$('title').textContent = `${manifest.name} <${manifest.tag}> ${manifest.version}`

const problems = checkManifest(manifest)
if (problems.length) log('manifest', { problems }, 'warn')

try {
  await import(moduleUrl)
} catch (error) {
  log('module', { error: String(error) }, 'warn')
}
if (!customElements.get(manifest.tag)) log('module', { error: `the module did not define <${manifest.tag}>` }, 'warn')

// ── Host state (what the runtime sends in its init / update messages) ──────
const defaults = Object.fromEntries((manifest.props ?? []).filter((p) => p.default !== undefined).map((p) => [p.name, p.default]))
const state = {
  value: manifest.value?.default ?? null,
  disabled: false,
  readonly: false,
  required: false,
  invalid: false,
  error: null,
  props: defaults,
  theme: { mode: 'light', tokens: THEMES.light },
  locale: navigator.language || 'en',
  context: { fields: Object.fromEntries((manifest.context ?? []).map((c) => [c.name, null])), form_id: 'form_demo', task_id: null, workflow_id: null, field_key: 'rating' },
  label: 'How was your visit?',
  description: 'Choose 1 to 5 stars.',
  capabilities: [...(manifest.capabilities ?? [])],
}

let el
const frame = $('frame')

function create() {
  el?.remove()
  el = document.createElement(manifest.tag)
  frame.append(el)
  apply()
}

/** Set every host property and each declared prop by name. */
function apply() {
  if (!el) return
  for (const key of ['value', 'disabled', 'readonly', 'required', 'invalid', 'error', 'props', 'theme', 'locale', 'context', 'label', 'description']) {
    el[key] = state[key]
  }
  for (const spec of manifest.props ?? []) {
    if (!RESERVED.has(spec.name)) el[spec.name] = state.props[spec.name] ?? spec.default
  }
  for (const [name, value] of Object.entries(state.theme.tokens)) document.documentElement.style.setProperty(`--${name}`, value)
  document.documentElement.dataset.mode = state.theme.mode
  // The host draws the label, help text and error around the frame.
  $('field-label').textContent = state.label + (state.required ? ' *' : '')
  $('field-help').textContent = state.description ?? ''
  $('field-error').textContent = state.invalid && state.error ? state.error : ''
  $('value').textContent = JSON.stringify(state.value)
}

// ── Events from the control ─────────────────────────────────────────────────
for (const type of ['ut-change', 'ut-blur', 'ut-validity', 'ut-resize', 'ut-request']) {
  frame.addEventListener(type, (event) => onEvent(event))
}

function onEvent(event) {
  if (!(event instanceof CustomEvent)) return
  const notes = []
  if (!event.composed) notes.push('not composed: the runtime listens outside the shadow root, set composed: true')
  const { type, detail } = event
  if (type === 'ut-change') {
    notes.push(...checkValue(detail?.value))
    state.value = detail?.value ?? null
    $('value').textContent = JSON.stringify(state.value)
  }
  if (type === 'ut-validity') $('validity').textContent = detail?.valid ? 'valid' : `invalid: ${detail?.message ?? ''}`
  if (type === 'ut-request') {
    handleRequest(detail)
    log(type, { kind: detail?.kind, payload: summarise(detail?.payload) }, notes.length ? 'warn' : '')
    return
  }
  log(type, detail, notes.length ? 'warn' : '', notes)
}

function handleRequest(detail) {
  const { kind, payload, resolve, reject } = detail ?? {}
  if (typeof resolve !== 'function' || typeof reject !== 'function') return log('ut-request', { error: 'detail needs resolve and reject functions' }, 'warn')
  const capability = REQUEST_CAPABILITY[kind]
  if (!capability) return reject(new Error(`Unknown request kind "${kind}"`))
  if (!state.capabilities.includes(capability)) {
    log('response', { kind, error: `capability "${capability}" not declared in manifest.json or not granted` }, 'warn')
    return reject(new Error(`Capability "${capability}" is not available`))
  }
  const delay = Number($('delay').value) || 0
  setTimeout(() => {
    if ($('fail').checked) {
      log('response', { kind, ok: false })
      return reject(new Error('Simulated failure'))
    }
    if (kind === 'lookup') {
      let items = []
      try { items = JSON.parse($('lookup-items').value) } catch { return reject(new Error('Lookup items JSON is invalid')) }
      const query = String(payload?.query ?? '').toLowerCase()
      const result = { items: items.filter((item) => String(item.label ?? '').toLowerCase().includes(query)).slice(0, 50) }
      log('response', { kind, ok: true, result })
      return resolve(result)
    }
    if (!(payload?.bytes instanceof ArrayBuffer)) return reject(new Error('upload payload.bytes must be an ArrayBuffer'))
    const result = { id: `file_${Math.random().toString(36).slice(2, 10)}`, name: String(payload.name ?? 'file'), size: payload.bytes.byteLength, type: String(payload.type || 'application/octet-stream') }
    log('response', { kind, ok: true, result })
    resolve(result)
  }, delay)
}

// ── Checks the server makes too (a subset; the server is the authority) ────
function checkValue(value) {
  const notes = []
  if (value === undefined) return ['ut-change detail has no "value"']
  let json
  try { json = JSON.stringify(value) } catch { return ['value is not JSON-serialisable'] }
  if (json && new Blob([json]).size > VALUE_BYTES) notes.push(`value is larger than ${VALUE_BYTES} bytes`)
  if (value === null) return notes
  const type = manifest.value?.type
  const ok = {
    string: typeof value === 'string',
    number: typeof value === 'number' && Number.isFinite(value),
    boolean: typeof value === 'boolean',
    date: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value),
    json: true,
    array: Array.isArray(value),
    files: Array.isArray(value),
  }[type]
  if (!ok) notes.push(`value does not match value.type "${type}"`)
  const schema = manifest.value?.schema ?? {}
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) notes.push(`value < schema.minimum ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) notes.push(`value > schema.maximum ${schema.maximum}`)
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) notes.push('value longer than schema.maxLength')
  if (schema.enum && !schema.enum.some((v) => JSON.stringify(v) === json)) notes.push('value not in schema.enum')
  return notes
}

function checkManifest(m) {
  const out = []
  if (!/^[a-z][a-z0-9._]*-[a-z0-9._-]*$/.test(m.tag ?? '')) out.push('tag must be lowercase and contain a hyphen')
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(m.version ?? '')) out.push('version must be semver (1.2.0)')
  for (const p of m.props ?? []) if (RESERVED.has(p.name)) out.push(`prop "${p.name}" uses a reserved name`)
  return out
}

// ── Log ─────────────────────────────────────────────────────────────────────
function summarise(payload) {
  if (payload?.bytes instanceof ArrayBuffer) return { ...payload, bytes: `ArrayBuffer(${payload.bytes.byteLength})` }
  return payload
}

function log(type, detail, tone = '', notes = []) {
  const li = document.createElement('li')
  if (tone) li.dataset.tone = tone
  const time = new Date().toLocaleTimeString(undefined, { hour12: false })
  let text
  try { text = JSON.stringify(detail) } catch { text = String(detail) }
  li.innerHTML = '<time></time> <b></b> <code></code>'
  li.querySelector('time').textContent = time
  li.querySelector('b').textContent = type
  li.querySelector('code').textContent = text ?? ''
  for (const note of notes) {
    const div = document.createElement('div')
    div.className = 'note'
    div.textContent = `⚠ ${note}`
    li.append(div)
  }
  $('log').prepend(li)
  window.__utEvents?.push({ type, detail, notes })
}
window.__utEvents = []

// ── Controls ────────────────────────────────────────────────────────────────
function bindCheckbox(id, key) {
  const input = $(id)
  input.checked = state[key]
  input.addEventListener('change', () => { state[key] = input.checked; apply() })
}
bindCheckbox('disabled', 'disabled')
bindCheckbox('readonly', 'readonly')
bindCheckbox('required', 'required')
bindCheckbox('invalid', 'invalid')

for (const [id, key] of [['label', 'label'], ['description', 'description'], ['error', 'error'], ['locale', 'locale']]) {
  const input = $(id)
  input.value = state[key] ?? ''
  input.addEventListener('input', () => { state[key] = input.value || (key === 'label' ? '' : null); apply() })
}
$('error').value = 'Choose a rating.'
state.error = 'Choose a rating.'

$('mode').addEventListener('change', () => {
  const mode = $('mode').value
  state.theme = { mode, tokens: THEMES[mode] }
  apply()
})

$('props').value = JSON.stringify(state.props, null, 2)
$('apply-props').addEventListener('click', () => {
  try {
    state.props = JSON.parse($('props').value)
    $('props').removeAttribute('aria-invalid')
    apply()
    log('host', { props: state.props })
  } catch (error) {
    $('props').setAttribute('aria-invalid', 'true')
    log('host', { error: `props JSON: ${error.message}` }, 'warn')
  }
})

$('context').value = JSON.stringify(state.context.fields, null, 2)
$('apply-context').addEventListener('click', () => {
  try {
    state.context = { ...state.context, fields: JSON.parse($('context').value) }
    apply()
    log('host', { context: state.context })
  } catch (error) {
    log('host', { error: `context JSON: ${error.message}` }, 'warn')
  }
})

$('set-value').addEventListener('click', () => {
  try {
    state.value = JSON.parse($('new-value').value || 'null')
    apply()
    log('host', { value: state.value })
  } catch (error) {
    log('host', { error: `value JSON: ${error.message}` }, 'warn')
  }
})

const caps = $('caps')
for (const capability of ['lookup', 'files', 'network']) {
  const declared = (manifest.capabilities ?? []).includes(capability)
  const label = document.createElement('label')
  label.innerHTML = `<input type="checkbox"> ${capability}${declared ? '' : ' <small>(not declared)</small>'}`
  const input = label.querySelector('input')
  input.checked = declared
  input.disabled = !declared
  input.addEventListener('change', () => {
    state.capabilities = input.checked ? [...state.capabilities, capability] : state.capabilities.filter((c) => c !== capability)
  })
  caps.append(label)
}
$('lookup-items').value = JSON.stringify([
  { value: 'nz', label: 'New Zealand', description: 'Oceania' },
  { value: 'au', label: 'Australia', description: 'Oceania' },
  { value: 'gb', label: 'United Kingdom', description: 'Europe' },
], null, 2)

$('recreate').addEventListener('click', () => { create(); log('host', { recreated: manifest.tag }) })
$('clear-log').addEventListener('click', () => { $('log').replaceChildren() })
// The host's label focuses the control (as clicking a field label does in a form).
$('field-label').addEventListener('click', () => el?.focus())

// Frame height: what the runtime would give the iframe.
const size = manifest.size ?? {}
const minH = Math.max(MIN_HEIGHT, size.min_height ?? MIN_HEIGHT)
const maxH = Math.min(MAX_HEIGHT, size.max_height ?? MAX_HEIGHT)
frame.style.minHeight = `${minH}px`
frame.style.maxHeight = `${maxH}px`
new ResizeObserver(() => {
  const h = el ? Math.ceil(el.getBoundingClientRect().height) : 0
  $('height').textContent = `${h}px (frame ${Math.min(maxH, Math.max(minH, h))}px, min ${minH}, max ${maxH})`
}).observe(frame)

create()

// Live reload when the dev server rebuilds (esbuild serve; ignored elsewhere).
try {
  const source = new EventSource('/esbuild')
  source.addEventListener('change', () => location.reload())
  source.onerror = () => source.close()
} catch { /* no live reload */ }
