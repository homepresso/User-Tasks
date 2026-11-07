/** Checks UserTasks makes on upload, run locally so a package is not refused. */
import { readFileSync } from 'node:fs'

export const MODULE_BYTES = 2 * 1024 * 1024 // PACKAGE_LIMITS.moduleBytes
export const ZIP_BYTES = 3 * 1024 * 1024 // PACKAGE_LIMITS.zipBytes

const VALUE_TYPES = ['string', 'number', 'boolean', 'date', 'json', 'array', 'files']
const PROP_TYPES = ['string', 'text', 'number', 'boolean', 'select', 'color', 'string[]', 'json']
const CAPABILITIES = ['lookup', 'files', 'network', 'reports']
const OUTPUT_TYPES = ['string', 'number', 'boolean', 'date', 'object', 'array']
const RESERVED = new Set([
  'value', 'disabled', 'readonly', 'readOnly', 'required', 'invalid', 'error', 'props', 'theme', 'locale', 'context',
  'label', 'description', 'id', 'className', 'style', 'innerHTML', 'outerHTML', 'textContent', 'slot', 'hidden',
  'tabIndex', 'title', 'lang', 'dir', 'constructor', '__proto__', 'prototype',
])

export function readManifest(path = 'manifest.json') {
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  const problems = []
  if (manifest.manifest_version !== 1) problems.push('manifest_version must be 1')
  if (!/^[a-z][a-z0-9._]*-[a-z0-9._-]*$/.test(manifest.tag ?? '')) problems.push('tag must be lowercase and contain a hyphen')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '')) problems.push('version must be semver, e.g. 1.2.0')
  if (!manifest.name) problems.push('name is required')
  if (!VALUE_TYPES.includes(manifest.value?.type)) problems.push(`value.type must be one of ${VALUE_TYPES.join(', ')}`)
  for (const prop of manifest.props ?? []) {
    if (!PROP_TYPES.includes(prop.type)) problems.push(`prop ${prop.name}: type must be one of ${PROP_TYPES.join(', ')}`)
    if (RESERVED.has(prop.name)) problems.push(`prop ${prop.name}: reserved name`)
  }
  for (const capability of manifest.capabilities ?? []) if (!CAPABILITIES.includes(capability)) problems.push(`unknown capability ${capability}`)
  // output: what the workflow receives (the server checks the full rules; these catch the usual slips).
  const output = manifest.output
  if (output !== undefined) {
    const structured = ['json', 'array', 'files'].includes(manifest.value?.type)
    if (!OUTPUT_TYPES.includes(output?.type)) problems.push(`output.type must be one of ${OUTPUT_TYPES.join(', ')}`)
    else if (manifest.value?.type === 'files' && output.type !== 'array') problems.push('a files control outputs its file list: output.type must be "array"')
    else if (structured && !['object', 'array'].includes(output.type) && !output.primary && !output.template && !(output.choices ?? []).every((c) => c.primary || c.template)) problems.push(`a ${output.type} output of a structured value needs output.primary (a path, e.g. "html") or output.template`)
    if ((output?.html || output?.template) && output?.type !== 'string') problems.push('output.html / output.template need output.type "string"')
    for (const suffix of Object.keys(output?.extras ?? {})) if (!/^[a-z][a-z0-9_]{0,30}$/.test(suffix) || ['raw', 'item', 'label', 'count', 'included'].includes(suffix)) problems.push(`output.extras: "${suffix}" is not allowed`)
  }
  if (problems.length) throw new Error(`manifest.json:\n  - ${problems.join('\n  - ')}`)
  return manifest
}

/** The module must be ONE self-contained ES module: the frame's CSP blocks every other fetch. */
export function checkModule(code, tag) {
  const problems = []
  const bytes = Buffer.byteLength(code)
  if (bytes > MODULE_BYTES) problems.push(`module is ${bytes} bytes; the limit is ${MODULE_BYTES}`)
  if (/^\s*import\s*(?:[\w*{$]|["'])/m.test(code) || /^\s*export\s*\*\s*from/m.test(code)) problems.push('module has import statements: bundle every dependency into one file')
  if (/\bimport\s*\(/.test(code)) problems.push('module uses dynamic import(): bundle it, the frame cannot load other files')
  if (/\bimport\.meta\.url\b/.test(code)) problems.push('module uses import.meta.url: inline assets as data: URIs instead')
  if (!code.includes(tag)) problems.push(`module does not mention its tag "${tag}"`)
  if (problems.length) throw new Error(`module:\n  - ${problems.join('\n  - ')}`)
  return bytes
}
