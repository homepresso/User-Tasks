/** Checks UserTasks makes on upload, run locally so a package is not refused. */
import { readFileSync } from 'node:fs'

export const MODULE_BYTES = 1024 * 1024 // ACTION_LIMITS.moduleBytes
export const MANIFEST_BYTES = 128 * 1024 // ACTION_LIMITS.manifestBytes
export const ZIP_BYTES = 5 * 1024 * 1024 // the upload limit for a package
export const MAX_OPERATIONS = 40 // ACTION_LIMITS.operations
export const MAX_FIELDS = 40 // ACTION_LIMITS.fieldsPerOperation

export const FIELD_TYPES = ['string', 'text', 'number', 'integer', 'boolean', 'date', 'datetime', 'select', 'object', 'array', 'json', 'file']
export const CAPABILITIES = ['http', 'data', 'files', 'credentials']

const KEY_RE = /^[a-z][a-z0-9_]{1,62}$/
const OPERATION_RE = /^[a-z][a-z0-9_]{0,62}$/
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function fieldProblems(fields, where, problems) {
  if (fields === undefined) return
  if (!Array.isArray(fields)) return problems.push(`${where} must be a list`)
  if (fields.length > MAX_FIELDS) problems.push(`${where}: at most ${MAX_FIELDS} fields`)
  const seen = new Set()
  fields.forEach((field, index) => {
    const at = `${where}[${index}]`
    if (!FIELD_RE.test(field?.name ?? '')) problems.push(`${at}: name must start with a letter and use letters, digits and underscores`)
    if (seen.has(field?.name)) problems.push(`${at}: duplicate field "${field.name}"`)
    seen.add(field?.name)
    if (!FIELD_TYPES.includes(field?.type ?? 'string')) problems.push(`${at}: type must be one of ${FIELD_TYPES.join(', ')}`)
    if (field?.type === 'select' && !(field.options?.length)) problems.push(`${at}: a select needs options`)
    if (field?.fields) fieldProblems(field.fields, at, problems)
    if (field?.items?.fields) fieldProblems(field.items.fields, `${at}.items`, problems)
  })
}

export function readManifest(path = 'manifest.json') {
  const text = readFileSync(path, 'utf8')
  const manifest = JSON.parse(text)
  const problems = []
  if (Buffer.byteLength(text) > MANIFEST_BYTES) problems.push(`manifest is larger than ${MANIFEST_BYTES / 1024} KB`)
  if (manifest.manifest_version !== 1) problems.push('manifest_version must be 1')
  if (!KEY_RE.test(manifest.key ?? '')) problems.push('key must be 2–63 lowercase letters, digits and underscores, starting with a letter (e.g. acme_tax)')
  if (String(manifest.key ?? '').startsWith('ut_')) problems.push('keys starting with ut_ are reserved for official UserTasks actions')
  if (!manifest.name) problems.push('name is required')
  if (!SEMVER_RE.test(manifest.version ?? '')) problems.push('version must be semver, e.g. 1.2.0')
  if (!Array.isArray(manifest.operations) || manifest.operations.length === 0) problems.push('operations must list at least one function')
  else if (manifest.operations.length > MAX_OPERATIONS) problems.push(`at most ${MAX_OPERATIONS} operations`)
  const ids = new Set()
  for (const [index, op] of (manifest.operations ?? []).entries()) {
    const where = `operations[${index}]`
    if (!OPERATION_RE.test(op?.id ?? '')) problems.push(`${where}.id must be lowercase letters, digits and underscores`)
    if (ids.has(op?.id)) problems.push(`duplicate operation id "${op.id}"`)
    ids.add(op?.id)
    fieldProblems(op?.inputs ?? [], `${where}.inputs`, problems)
    fieldProblems(op?.outputs ?? [], `${where}.outputs`, problems)
    if (!(op?.outputs?.length)) problems.push(`${where} (${op?.id}) declares no outputs`)
  }
  for (const capability of Object.keys(manifest.capabilities ?? {})) {
    if (!CAPABILITIES.includes(capability)) problems.push(`capabilities.${capability} is not a known capability (${CAPABILITIES.join(', ')})`)
  }
  const hosts = manifest.capabilities?.http?.hosts
  if (manifest.capabilities?.http && !(Array.isArray(hosts) && hosts.length)) problems.push('capabilities.http.hosts must list the hosts the action calls')
  for (const host of hosts ?? []) if (/[/:]/.test(String(host).replace(/:\d+$/, ''))) problems.push(`capabilities.http.hosts: "${host}" must be a hostname (no scheme or path)`)
  if (problems.length) throw new Error(`manifest.json:\n  - ${problems.join('\n  - ')}`)
  return manifest
}

/** ONE self-contained ES module with a default export: the sandbox has no module loader. */
export function checkModule(code, manifest) {
  const problems = []
  const bytes = Buffer.byteLength(code)
  if (bytes > MODULE_BYTES) problems.push(`module is ${bytes} bytes; the limit is ${MODULE_BYTES}`)
  if (/^\s*import\s*(?:[\w*{$]|["'])/m.test(code) || /^\s*export\s*(?:\*|\{[^}]*\})\s*from/m.test(code)) problems.push('module has import statements: bundle every dependency into one file')
  if (/\bimport\s*\(/.test(code)) problems.push('module uses dynamic import(): bundle it, the sandbox cannot load other files')
  if (!/export\s+default|export\s*\{[^}]*\bdefault\b/.test(code)) problems.push('module has no default export: export default defineAction({ operations: { … } })')
  for (const op of manifest.operations) if (!code.includes(op.id)) problems.push(`module never mentions the operation "${op.id}"`)
  if (problems.length) throw new Error(`module:\n  - ${problems.join('\n  - ')}`)
  return bytes
}
