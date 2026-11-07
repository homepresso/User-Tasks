import { describe, expect, it } from 'vitest'
import PizZip from 'pizzip'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { looksLikeCredentialName, actionFieldSchema, actionManifestOf, checkActionOutputs, coerceActionValue, parseActionManifest, prepareActionInputs, ActionManifestError } from '@/lib/custom-actions/manifest'
import { parseActionModule, parseActionUpload, probeActionModule, ActionPackageError } from '@/lib/custom-actions/package'
import { buildDataTree } from '@/lib/workflow-data-picker'

const MANIFEST = {
  manifest_version: 1,
  key: 'acme_tax',
  name: 'Acme tax',
  version: '1.2.0',
  operations: [
    {
      id: 'gst', label: 'GST', sample: { amount: 100 },
      inputs: [{ name: 'amount', type: 'number', required: true }, { name: 'rate', type: 'number', default: 15 }, { name: 'mode', type: 'select', options: ['add', 'remove'] }],
      outputs: [{ name: 'total', type: 'number' }, { name: 'lines', type: 'array', items: { type: 'object', fields: [{ name: 'label', type: 'string' }, { name: 'value', type: 'number' }] } }],
    },
  ],
  capabilities: { http: { hosts: ['api.example.com'] }, credentials: [{ name: 'api_key' }] },
  limits: { timeout_ms: 999_999, memory_mb: 1 },
}
const MODULE = `export default { operations: { gst: (i) => ({ total: i.amount * (1 + i.rate / 100), lines: [{ label: 'gst', value: i.amount * i.rate / 100 }] }) } }`

describe('action manifest', () => {
  it('validates and clamps limits', () => {
    const m = parseActionManifest(MANIFEST)
    expect(m.limits).toEqual({ timeout_ms: 60_000, memory_mb: 8 })
    expect(m.operations[0].inputs[2].options).toEqual([{ value: 'add' }, { value: 'remove' }])
    expect(m.capabilities).toEqual({ http: { hosts: ['api.example.com'] }, credentials: [{ name: 'api_key', label: 'Api key' }] })
  })

  it.each([
    ['bad key', { key: 'Acme-Tax' }, /key must be/],
    ['no operations', { operations: [] }, /at least one/],
    ['bad semver', { version: '1.0' }, /semver/],
    ['unknown capability', { capabilities: { shell: true } }, /not a known capability/],
    ['http without hosts', { capabilities: { http: {} } }, /must list the hosts/],
    ['host with scheme', { capabilities: { http: { hosts: ['https://x.com'] } } }, /hostname/],
    ['duplicate op', { operations: [MANIFEST.operations[0], MANIFEST.operations[0]] }, /duplicate operation/],
    ['bad field type', { operations: [{ id: 'x', outputs: [{ name: 'a', type: 'blob' }] }] }, /type must be/],
    ['no outputs', { operations: [{ id: 'x', outputs: [] }] }, /declares no outputs/],
  ])('refuses %s', (_name, patch, message) => {
    expect(() => parseActionManifest({ ...MANIFEST, ...patch })).toThrow(ActionManifestError)
    expect(() => parseActionManifest({ ...MANIFEST, ...patch })).toThrow(message)
  })

  it('refuses credential-looking field names (exports would blank them) and the secrets key', async () => {
    const { isSensitiveKey } = await import('@/lib/secret-fields')
    for (const name of ['token', 'api_key', 'client_secret', 'password', 'refresh_token', 'jwt', 'signature', 'key', 'amount']) expect(looksLikeCredentialName(name), name).toBe(isSensitiveKey(name))
    expect(() => parseActionManifest({ ...MANIFEST, operations: [{ id: 'x', inputs: [{ name: 'token', type: 'string' }], outputs: [{ name: 'ok', type: 'boolean' }] }] })).toThrow(/looks like a credential/)
    expect(() => parseActionManifest({ ...MANIFEST, capabilities: { secrets: [{ name: 'k1' }] } })).toThrow(/capabilities.credentials/)
  })

  it('reads legacy activity manifests as one run operation', () => {
    const m = actionManifestOf({ key: 'scorer', name: 'Scorer', manifest: { inputs: [{ name: 'amount', type: 'number' }], outputs: [{ name: 'score', type: 'any' }] } })
    expect(m.operations).toHaveLength(1)
    expect(m.operations[0]).toMatchObject({ id: 'run', inputs: [{ name: 'amount', type: 'number' }], outputs: [{ name: 'score', type: 'json' }] })
  })

  it('coerces typed inputs and reports bad ones', () => {
    const op = parseActionManifest(MANIFEST).operations[0]
    expect(prepareActionInputs(op, { amount: '1,250.5' })).toEqual({ inputs: { amount: 1250.5, rate: 15, mode: null }, errors: [] })
    expect(prepareActionInputs(op, {}).errors).toEqual(['Amount is required'])
    expect(prepareActionInputs(op, { amount: 'abc', mode: 'double' }).errors).toEqual(['Amount must be a number', 'Mode must be one of add, remove'])
    expect(coerceActionValue({ name: 'xs', type: 'array', items: { type: 'number' } }, '1, 2,3')).toEqual({ value: [1, 2, 3] })
    expect(coerceActionValue({ name: 'o', type: 'object' }, '{"a":1}')).toEqual({ value: { a: 1 } })
    expect(coerceActionValue({ name: 'b', type: 'boolean' }, 'yes')).toEqual({ value: true })
    expect(coerceActionValue({ name: 'd', type: 'date' }, 'not a date')).toHaveProperty('error')
    expect(coerceActionValue({ name: 'n', type: 'integer' }, '1.5')).toHaveProperty('error')
  })

  it('checks outputs against their declared types', () => {
    const op = parseActionManifest(MANIFEST).operations[0]
    expect(checkActionOutputs(op, { total: 115, lines: [] })).toEqual([])
    expect(checkActionOutputs(op, { total: '115', extra: 1 })).toEqual(['output "total" should be number but is string', 'returned undeclared output "extra" (kept)'])
  })

  it('typed outputs feed the data picker (prefixed, with item fields)', () => {
    const op = parseActionManifest(MANIFEST).operations[0]
    expect(actionFieldSchema(op.outputs[1])).toMatchObject({ type: 'array', items: { type: 'object', fields: [{ name: 'label', type: 'string' }, { name: 'value', type: 'number' }] } })
    const nodes = [
      { id: 't', type: 'webhook_received', label: 'Start', config: {} },
      { id: 'a', type: 'custom_activity', label: 'Tax', config: { custom_activity_key: 'acme_tax', operation: 'gst', _output_prefix: 'tax', _action_outputs: op.outputs } },
      { id: 'b', type: 'set_variable', label: 'Next', config: {} },
    ]
    const tree = buildDataTree({ nodes, edges: [{ source: 't', target: 'a' }, { source: 'a', target: 'b' }], currentNodeId: 'b' })
    const roots = tree.flatMap((g) => g.roots)
    expect(roots.find((r: { path: string }) => r.path === 'tax_total')?.schema).toMatchObject({ type: 'number' })
    expect(roots.find((r: { path: string }) => r.path === 'tax_lines')?.schema).toMatchObject({ type: 'array', items: { type: 'object' } })
  })
})

describe('action packages', () => {
  it('a module + manifest: checksum, operations probe', async () => {
    const parsed = parseActionModule(MODULE, MANIFEST)
    expect(parsed.sha256).toBe(createHash('sha256').update(MODULE).digest('hex'))
    expect(await probeActionModule(parsed)).toEqual([])
    const missing = parseActionModule(`export default { operations: { other: () => ({}) } }\n// gst`, MANIFEST)
    expect(await probeActionModule(missing)).toEqual(['operation "gst" has no function in the module'])
  })

  it('refuses imports and modules without a default export', () => {
    expect(() => parseActionModule(`import x from 'lodash'\nexport default {}`, MANIFEST)).toThrow(ActionPackageError)
    expect(() => parseActionModule(`export const gst = () => ({})`, MANIFEST)).toThrow(/default export/)
  })

  it('a zip with dist/action.js and a verified ed25519 signature', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const sha = createHash('sha256').update(MODULE).digest('hex')
    const signature = { alg: 'ed25519', public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'), signature: sign(null, Buffer.from(sha), privateKey).toString('base64') }
    const zip = new PizZip()
    zip.file('acme/manifest.json', JSON.stringify(MANIFEST))
    zip.file('acme/dist/action.js', MODULE)
    zip.file('acme/src/action.ts', 'ignored')
    zip.file('acme/signature.json', JSON.stringify(signature))
    const parsed = await parseActionUpload({ zip: zip.generate({ type: 'uint8array' }) })
    expect(parsed.manifest.entry).toBe('dist/action.js')
    expect(parsed.signature).toMatchObject({ alg: 'ed25519', verified: true })
    const tampered = new PizZip()
    tampered.file('manifest.json', JSON.stringify(MANIFEST))
    tampered.file('dist/action.js', MODULE + '\n// changed')
    tampered.file('signature.json', JSON.stringify(signature))
    const bad = await parseActionUpload({ zip: tampered.generate({ type: 'uint8array' }) })
    expect(bad.signature?.verified).toBe(false)
    expect(bad.warnings.join(' ')).toMatch(/does not verify/)
  })
})
