import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import PizZip from 'pizzip'
import { compareSemver, isValidTag, latestVersion, parseFormControlManifest, resolveControlProps, ManifestError } from '@/lib/forms/custom-controls/manifest'
import { normalizeValueSchema, validateAgainstSchema } from '@/lib/forms/custom-controls/json-schema'
import {
  coerceCustomValue, customConfigFromManifest, customControlRefs, customValueError, formatCustomValue, normalizeCustomControlConfig,
  setCustomControlValidity, workflowCustomControlRefs,
} from '@/lib/forms/custom-controls/field'
import { acceptFrameMessage, clampFrameHeight, hostMessage, OPAQUE_ORIGIN } from '@/lib/forms/custom-controls/bridge'
import { buildFrameDocument, frameContentSecurityPolicy, frameUrl, inlineJson, inlineScriptSafe, FRAME_HEADERS } from '@/lib/forms/custom-controls/frame'
import { moduleProblems, parseControlUpload, parseZipPackage, PackageError } from '@/lib/forms/custom-controls/package'
import { normalizeTaskFields, validateTaskFieldValues, coerceTaskFieldValues } from '@/lib/task-field-schema'
import { formatFieldValue } from '@/components/forms/form-renderer'
import { startFormFromVariables, variablesFromStartForm } from '@/lib/forms/start-form'
import { deriveInputFields, validateWorkflowInputs } from '@/lib/workflow-inputs'

const KIT = 'templates/form-control-starter/vanilla-js'
const MANIFEST = JSON.parse(readFileSync(`${KIT}/manifest.json`, 'utf8'))
const MODULE = readFileSync(`${KIT}/ut-star-rating.js`, 'utf8')

const base = { tag: 'acme-rating', name: 'Rating', version: '1.0.0', value: { type: 'number' } }

describe('manifest', () => {
  it('accepts the starter kit manifest', () => {
    const m = parseFormControlManifest(MANIFEST)
    expect(m.tag).toBe('ut-star-rating')
    expect(m.value.type).toBe('number')
    expect(m.props.map((p) => p.name)).toEqual(['max', 'allow_clear', 'size'])
    expect(m.display?.template).toContain('{{value}}')
  })

  it('refuses bad tags, versions, value types and reserved prop names', () => {
    expect(() => parseFormControlManifest({ ...base, tag: 'rating' })).toThrow(ManifestError)
    expect(() => parseFormControlManifest({ ...base, tag: 'Acme-Rating' })).toThrow(/custom element name/)
    expect(() => parseFormControlManifest({ ...base, tag: 'font-face' })).toThrow()
    expect(() => parseFormControlManifest({ ...base, version: '1.0' })).toThrow(/semantic version/)
    expect(() => parseFormControlManifest({ ...base, value: { type: 'blob' } })).toThrow(/value.type/)
    expect(() => parseFormControlManifest({ ...base, props: [{ name: 'value', type: 'string' }] })).toThrow(/reserved/)
    expect(() => parseFormControlManifest({ ...base, props: [{ name: 'a', type: 'select' }] })).toThrow(/options/)
    expect(() => parseFormControlManifest('{not json')).toThrow(/valid JSON/)
  })

  it('gates capabilities: files needs a files value, network needs hosts', () => {
    expect(() => parseFormControlManifest({ ...base, capabilities: ['files'] })).toThrow(/files/)
    expect(() => parseFormControlManifest({ ...base, capabilities: ['network'] })).toThrow(/allowed_hosts/)
    expect(() => parseFormControlManifest({ ...base, capabilities: ['camera'] })).toThrow(/Unknown capability/)
    const m = parseFormControlManifest({ ...base, capabilities: ['network', 'lookup'], network: { allowed_hosts: ['API.example.com', 'https://evil', '*.example.org'] } })
    expect(m.network?.allowed_hosts).toEqual(['api.example.com', '*.example.org'])
  })

  it('checks a default value against the schema and drops unknown keys', () => {
    expect(() => parseFormControlManifest({ ...base, value: { type: 'number', schema: { maximum: 5 }, default: 9 } })).toThrow(/default/)
    const m = parseFormControlManifest({ ...base, evil: '<script>', value: { type: 'number', schema: { maximum: 5, $ref: 'http://x' } } })
    expect(m).not.toHaveProperty('evil')
    expect(m.value.schema).toEqual({ maximum: 5 })
  })

  it('orders semver (pre-releases before releases)', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1)
    expect(compareSemver('1.0.0-beta.2', '1.0.0')).toBe(-1)
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    expect(latestVersion(['1.0.0', '2.0.0-rc.1', '1.5.0'])).toBe('2.0.0-rc.1')
    expect(isValidTag('ut-star-rating')).toBe(true)
  })

  it('resolves designer props against the manifest (defaults, coercion, unknown dropped)', () => {
    const m = parseFormControlManifest(MANIFEST)
    expect(resolveControlProps(m, { max: '7', size: 'huge', bogus: 1 })).toEqual({ max: 7, allow_clear: false, size: 'medium' })
    expect(resolveControlProps(m, { max: 99 })).toMatchObject({ max: 10 })
  })
})

describe('JSON Schema subset', () => {
  it('validates types, bounds, strings, arrays and objects', () => {
    const s = normalizeValueSchema({ type: 'object', required: ['n'], additionalProperties: false, properties: { n: { type: 'integer', minimum: 1 }, tags: { type: 'array', items: { type: 'string', maxLength: 3 }, uniqueItems: true } } })
    expect(validateAgainstSchema({ n: 2, tags: ['a'] }, s)).toBeNull()
    expect(validateAgainstSchema({ n: 1.5 }, s)).toMatch(/n: must be integer/)
    expect(validateAgainstSchema({}, s)).toMatch(/n is required/)
    expect(validateAgainstSchema({ n: 2, x: 1 }, s)).toMatch(/x: is not allowed/)
    expect(validateAgainstSchema({ n: 2, tags: ['a', 'a'] }, s)).toMatch(/repeat/)
    expect(validateAgainstSchema({ n: 2, tags: ['abcd'] }, s)).toMatch(/tags\[0\]/)
    expect(validateAgainstSchema('2026-02-30', { format: 'date' })).toBeNull() // shape only
    expect(validateAgainstSchema('x', { format: 'email' })).toMatch(/email/)
    expect(validateAgainstSchema('javascript:alert(1)', { format: 'uri' })).toMatch(/http/)
    expect(validateAgainstSchema(3, { enum: [1, 2] })).toMatch(/one of/)
    expect(validateAgainstSchema(0.3, { multipleOf: 0.1 })).toBeNull()
  })

  it('refuses unsafe regex patterns', () => {
    expect(() => normalizeValueSchema({ pattern: '(a+)+$' })).toThrow()
  })
})

describe('custom field type', () => {
  afterEach(() => setCustomControlValidity('rating', null))
  const manifest = parseFormControlManifest(MANIFEST)
  const field = { key: 'rating', label: 'Rating', type: 'custom', required: true, custom: customConfigFromManifest(manifest) }

  it('normalizes and keeps the snapshot; drops invalid configs', () => {
    const [f] = normalizeTaskFields([field])
    expect(f.type).toBe('custom')
    expect(f.custom?.tag).toBe('ut-star-rating')
    expect(f.custom?.value_schema).toEqual({ type: 'number', minimum: 0, maximum: 10 })
    expect(normalizeCustomControlConfig({ tag: 'nope', version: '1.0.0' })).toBeNull()
    expect(normalizeTaskFields([{ key: 'x', label: 'X', type: 'custom', custom: { tag: 'bad' } }])[0].custom).toBeUndefined()
  })

  it('validates on the server side: required, type, schema — never trusting the control', () => {
    const fields = normalizeTaskFields([field])
    expect(validateTaskFieldValues(fields, {})).toEqual({ rating: 'Rating is required' })
    expect(validateTaskFieldValues(fields, { rating: null })).toEqual({ rating: 'Rating is required' })
    expect(validateTaskFieldValues(fields, { rating: 'five' })).toEqual({ rating: 'Rating must be a number' })
    expect(validateTaskFieldValues(fields, { rating: 11 })).toEqual({ rating: 'Rating: must be at most 10' })
    expect(validateTaskFieldValues(fields, { rating: '4' })).toEqual({})
    expect(coerceTaskFieldValues(fields, { rating: '4' })).toEqual({ rating: 4 })
    const unconfigured = normalizeTaskFields([{ key: 'u', label: 'U', type: 'custom' }])
    expect(validateTaskFieldValues(unconfigured, { u: 1 }).u).toMatch(/not configured/)
  })

  it('holds the submit while the control reports itself invalid (browser only)', () => {
    const fields = normalizeTaskFields([field])
    setCustomControlValidity('rating', 'Pick at least one star')
    expect(validateTaskFieldValues(fields, { rating: 3 })).toEqual({ rating: 'Rating: Pick at least one star' })
    setCustomControlValidity('rating', null)
    expect(validateTaskFieldValues(fields, { rating: 3 })).toEqual({})
  })

  it('respects visible_when and hidden steps', () => {
    const fields = normalizeTaskFields([{ key: 'show', label: 'Show', type: 'boolean' }, { ...field, visible_when: { field: 'show', operator: 'equals', value: 'true' } }])
    expect(validateTaskFieldValues(fields, { show: false })).toEqual({})
  })

  it('formats read-only values with the display template', () => {
    const [f] = normalizeTaskFields([{ ...field, custom: { ...field.custom, props: { max: 7 } } }])
    expect(formatFieldValue(f, 5)).toBe('5 of 7 stars')
    expect(formatFieldValue(f, null)).toBe('—')
    expect(formatCustomValue({ tag: 'a-b', version: '1.0.0', value_type: 'json' }, { a: 1 })).toContain('"a": 1')
    // A statement matrix (Likert) reads as one line per statement, N/A for 0.
    expect(formatCustomValue({ tag: 'ut-likert', version: '1.0.0', value_type: 'json', display: { format: 'json' }, props: { statements: ['Speed of response', 'Café quality'] } }, { speed_of_response: 4, cafe_quality: 0 })).toBe('Speed of response: 4\nCafé quality: N/A')
    expect(formatCustomValue({ tag: 'a-b', version: '1.0.0', value_type: 'array' }, ['x', 'y'])).toBe('x, y')
  })

  it('types values per manifest value type', () => {
    expect(customValueError('D', { tag: 'a-b', version: '1.0.0', value_type: 'date' }, '2026-10-30')).toBeNull()
    expect(customValueError('D', { tag: 'a-b', version: '1.0.0', value_type: 'date' }, 'tomorrow')).toMatch(/date/)
    expect(customValueError('B', { tag: 'a-b', version: '1.0.0', value_type: 'boolean' }, coerceCustomValue({ tag: 'a-b', version: '1.0.0', value_type: 'boolean' }, 'true'))).toBeNull()
    expect(customValueError('J', { tag: 'a-b', version: '1.0.0', value_type: 'json' }, { big: 'x'.repeat(300_000) })).toMatch(/too large/)
    expect(customValueError('F', { tag: 'a-b', version: '1.0.0', value_type: 'files' }, [{ name: 'x' }])).toMatch(/uploaded files/)
  })

  it('finds references in forms, workflows and start forms', () => {
    expect(customControlRefs([field, { key: 'x', type: 'text' }])).toEqual([{ tag: 'ut-star-rating', version: '1.0.0', field_key: 'rating' }])
    const refs = workflowCustomControlRefs([{ id: 'n1', type: 'user_task', label: 'Review', config: { fields: [field] } }], [{ name: 'score', format: 'custom', custom: { tag: 'ut-star-rating', version: '1.0.0' } }])
    expect(refs.map((r) => r.node_label)).toEqual(['Review', 'Start form'])
  })

  it('round-trips start forms and validates custom workflow inputs on the server', () => {
    const custom = customConfigFromManifest(manifest)
    const model = startFormFromVariables([{ name: 'score', type: 'number', format: 'custom', custom, label: 'Score', required: true }], {})
    expect(model.def.fields[0]).toMatchObject({ type: 'custom', custom: { tag: 'ut-star-rating' } })
    const vars = variablesFromStartForm(model.def, [], model.nameByKey, () => 'v1')
    expect(vars[0]).toMatchObject({ name: 'score', type: 'number', format: 'custom' })
    const inputs = deriveInputFields(vars)
    expect(validateWorkflowInputs(inputs, { score: 12 }).errors[0].message).toMatch(/at most 10/)
    expect(validateWorkflowInputs(inputs, { score: '3' }).values.score).toBe(3)
  })
})

describe('bridge', () => {
  const frameWindow = { id: 'frame' }
  const expect_ = { frameWindow, channel: 'c0ffee', capabilities: [] as Array<'lookup' | 'files' | 'network' | 'reports'> }
  const msg = (data: Record<string, unknown>, over: Partial<{ source: unknown; origin: string }> = {}) => acceptFrameMessage({ source: over.source ?? frameWindow, origin: over.origin ?? OPAQUE_ORIGIN, data: { ut: 1, channel: 'c0ffee', ...data } }, expect_)

  it('accepts well-formed messages from its own frame', () => {
    expect(msg({ type: 'change', value: 3 })).toEqual({ ok: true, message: { ut: 1, channel: 'c0ffee', type: 'change', value: 3 } })
    expect(msg({ type: 'validity', valid: false, message: 'x'.repeat(900) })).toMatchObject({ ok: true, message: { message: 'x'.repeat(500) } })
  })

  it('refuses other windows, non-opaque origins, other channels and bad shapes', () => {
    expect(msg({ type: 'change', value: 1 }, { source: { id: 'other' } })).toEqual({ ok: false, reason: 'source' })
    expect(msg({ type: 'change', value: 1 }, { origin: 'https://app.example.com' })).toMatchObject({ ok: false, reason: 'origin' })
    expect(msg({ type: 'change', value: 1, channel: 'other' })).toEqual({ ok: false, reason: 'channel' })
    expect(msg({ type: 'eval', code: '1' })).toEqual({ ok: false, reason: 'shape' })
    expect(msg({ type: 'change' })).toEqual({ ok: false, reason: 'shape' })
    expect(acceptFrameMessage({ source: frameWindow, origin: 'null', data: { ut: 2, channel: 'c0ffee', type: 'blur' } }, expect_)).toEqual({ ok: false, reason: 'shape' })
    expect(msg({ type: 'change', value: 'x'.repeat(300 * 1024) })).toEqual({ ok: false, reason: 'size' })
  })

  it('gates host requests by capability', () => {
    expect(msg({ type: 'request', request_id: 'r1', kind: 'lookup', payload: { query: 'ab' } })).toMatchObject({ ok: false, reason: 'capability' })
    const granted = acceptFrameMessage({ source: frameWindow, origin: 'null', data: { ut: 1, channel: 'c0ffee', type: 'request', request_id: 'r1', kind: 'lookup', payload: { query: 'ab', extra: 1 } } }, { ...expect_, capabilities: ['lookup'] })
    expect(granted).toEqual({ ok: true, message: { ut: 1, channel: 'c0ffee', type: 'request', request_id: 'r1', kind: 'lookup', payload: { query: 'ab' } } })
    const upload = (bytes: unknown) => acceptFrameMessage({ source: frameWindow, origin: 'null', data: { ut: 1, channel: 'c0ffee', type: 'request', request_id: 'r2', kind: 'upload', payload: { name: 'a.png', type: 'image/png', bytes } } }, { ...expect_, capabilities: ['files'] })
    expect(upload(new ArrayBuffer(10))).toMatchObject({ ok: true })
    expect(upload('not bytes')).toMatchObject({ ok: false, reason: 'shape' })
    expect(upload(new ArrayBuffer(26 * 1024 * 1024))).toMatchObject({ ok: false, reason: 'size' })
  })

  it('accepts file reads (files) and report runs (reports) with clean payloads only', () => {
    const req = (kind: string, payload: unknown, capabilities: Array<'lookup' | 'files' | 'network' | 'reports'>) =>
      acceptFrameMessage({ source: frameWindow, origin: 'null', data: { ut: 1, channel: 'c0ffee', type: 'request', request_id: 'r3', kind, payload } }, { ...expect_, capabilities })
    expect(req('file', { id: 'f1' }, [])).toMatchObject({ ok: false, reason: 'capability' })
    expect(req('file', { id: 'f1', path: '../x' }, ['files'])).toMatchObject({ ok: true, message: { kind: 'file', payload: { id: 'f1' } } })
    expect(req('file', { id: '../../etc' }, ['files'])).toMatchObject({ ok: false, reason: 'shape' })
    expect(req('report', { report_id: 'someone-elses', limit: 5000 }, ['reports'])).toMatchObject({ ok: true, message: { kind: 'report', payload: { limit: 1000 } } })
    expect(req('report', {}, ['lookup'])).toMatchObject({ ok: false, reason: 'capability' })
    expect(req('report', null, ['reports'])).toMatchObject({ ok: true, message: { payload: {} } })
  })

  it('clamps heights to the manifest and host bounds', () => {
    expect(clampFrameHeight(5000, { max_height: 120 })).toBe(120)
    expect(clampFrameHeight(1, undefined)).toBe(24)
    expect(msg({ type: 'resize', height: 99999 })).toMatchObject({ message: { height: 2000 } })
    expect(hostMessage('c', { type: 'focus', from: 'start' })).toEqual({ ut: 1, channel: 'c', type: 'focus', from: 'start' })
  })
})

describe('frame document and CSP', () => {
  const manifest = parseFormControlManifest(MANIFEST)
  it('locks the frame down: no network, sandboxed, framed by the app only, scripts by hash', () => {
    const csp = frameContentSecurityPolicy({ scriptHashes: ['AAA=', 'BBB='], approvedHosts: [] })
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'sha256-AAA=' 'sha256-BBB='")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).toContain("form-action 'none'")
    expect(csp).not.toMatch(/unsafe-eval|allow-same-origin/)
    expect(frameContentSecurityPolicy({ scriptHashes: ['A'], approvedHosts: ['api.example.com'] })).toContain('connect-src https://api.example.com')
    expect(FRAME_HEADERS['X-Content-Type-Options']).toBe('nosniff')
  })

  it('inlines exactly the scripts it hashes, made safe for a <script> element', () => {
    const { html, scripts } = buildFrameDocument(manifest, `${MODULE}\n// </script><script>alert(1)</script> <!-- x`)
    expect(scripts).toHaveLength(2)
    for (const script of scripts) expect(html).toContain(script)
    expect(html.match(/<\/script>/g)).toHaveLength(3) // config + runtime + module
    expect(scripts[1]).not.toMatch(/<\/script/i)
    expect(inlineScriptSafe('"</SCRIPT>"')).toBe('"<\\u002fSCRIPT>"')
    expect(inlineJson({ a: '</script>' })).not.toContain('</')
    const hash = createHash('sha256').update(scripts[0], 'utf8').digest('base64')
    expect(hash).toMatch(/=$/)
  })

  it('builds frame URLs per control version (task workspace when given)', () => {
    expect(frameUrl('ut-star-rating', '1.0.0', { task: 'abc' })).toBe('/form-controls/frame/ut-star-rating/1.0.0?task=abc')
  })
})

describe('packages', () => {
  it('reads a zip (root or one folder), verifies an ed25519 signature and records the checksum', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const sha = createHash('sha256').update(MODULE).digest('hex')
    const signature = { alg: 'ed25519', public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), signature: sign(null, Buffer.from(sha), privateKey).toString('base64') }
    const zip = new PizZip()
    zip.file('pkg/manifest.json', JSON.stringify(MANIFEST))
    zip.file('pkg/ut-star-rating.js', MODULE)
    zip.file('pkg/signature.json', JSON.stringify(signature))
    zip.file('pkg/README.md', '# hi')
    const parsed = await parseZipPackage(new Uint8Array(zip.generate({ type: 'uint8array' })))
    expect(parsed.manifest.tag).toBe('ut-star-rating')
    expect(parsed.sha256).toBe(sha)
    expect(parsed.signature).toMatchObject({ alg: 'ed25519', verified: true })
    const tampered = new PizZip()
    tampered.file('manifest.json', JSON.stringify(MANIFEST))
    tampered.file('ut-star-rating.js', `${MODULE}\n// changed`)
    tampered.file('signature.json', JSON.stringify(signature))
    expect((await parseZipPackage(new Uint8Array(tampered.generate({ type: 'uint8array' })))).signature?.verified).toBe(false)
  })

  it('refuses modules that import other files and packages without a manifest', async () => {
    expect(moduleProblems("import { LitElement } from 'lit'\nexport class A {}")[0]).toMatch(/bundle every dependency/)
    expect(moduleProblems('const x = await import("https://evil.example/x.js")')[0]).toMatch(/evil/)
    expect(moduleProblems(MODULE)).toEqual([])
    const zip = new PizZip()
    zip.file('a.js', MODULE)
    await expect(parseZipPackage(new Uint8Array(zip.generate({ type: 'uint8array' })))).rejects.toThrow(/manifest.json/)
    await expect(parseControlUpload({ module: MODULE })).rejects.toThrow(PackageError)
    await expect(parseZipPackage(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(/zip/)
  })
})
