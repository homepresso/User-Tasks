/**
 * Licence issuing (vendor side, development tool). The private signing key
 * is NEVER in the repository: it is read at run time from a file
 * (--key <path> or USERTASKS_LICENCE_SIGNING_KEY_FILE) or from the
 * environment (USERTASKS_LICENCE_SIGNING_KEY, PEM). Without one, `sign`
 * refuses to run.
 *
 *   tsx scripts/licence-issue.ts keygen --kid lic-2027-1 --out ~/secure/lic-2027-1.pem
 *       new Ed25519 key pair: the private key is written (0600, outside the
 *       repository), the keyring entry to add to lib/licensing/keyring.ts is printed.
 *
 *   tsx scripts/licence-issue.ts sign --key ~/secure/lic-2026-1.pem --kid lic-2026-1 \
 *       --customer "Example Corp" --expires 2027-12-31T00:00:00Z \
 *       --ext sharepoint:connector,importers --limit sharepoint.farms=2 \
 *       [--request usertasks-licence-request.json | --instance inst_… --host usertasks.corp.example] \
 *       [--licence-id lic_…] [--updates-until 2027-12-31] [--not-before …] [--trial] --out example.licence
 *
 *   tsx scripts/licence-issue.ts verify example.licence [--instance inst_…] [--host …]
 */

import { randomBytes, generateKeyPairSync } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'
import { keyringEntryFor, parseLicence, signLicence } from '../lib/licensing/format'
import { verifyLicence } from '../lib/licensing/service'
import { LICENCE_KEYRING } from '../lib/licensing/keyring'
import { LICENCE_FORMAT_VERSION, LICENCE_KIND, type LicenceExtensionGrant } from '../lib/licensing/types'

const repoRoot = resolve(__dirname, '..')

function insideRepo(path: string): boolean {
  const rel = relative(repoRoot, resolve(path))
  return !rel.startsWith('..') && !isAbsolute(rel)
}

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    key: { type: 'string' }, kid: { type: 'string' }, out: { type: 'string' },
    customer: { type: 'string' }, 'customer-id': { type: 'string' }, expires: { type: 'string' }, 'not-before': { type: 'string' },
    'updates-until': { type: 'string' }, 'licence-id': { type: 'string' },
    ext: { type: 'string', multiple: true }, limit: { type: 'string', multiple: true },
    instance: { type: 'string', multiple: true }, host: { type: 'string', multiple: true },
    request: { type: 'string' }, trial: { type: 'boolean' }, notes: { type: 'string' },
  },
})

const [command, ...rest] = positionals

function readPrivateKey(): string {
  const file = values.key || process.env.USERTASKS_LICENCE_SIGNING_KEY_FILE
  if (file) {
    if (insideRepo(file)) fail(`Refusing to read a signing key from inside the repository (${file}): keep it outside the checkout.`)
    return readFileSync(file, 'utf8')
  }
  const inline = process.env.USERTASKS_LICENCE_SIGNING_KEY?.replace(/\\n/g, '\n').trim()
  if (inline) return inline
  fail('No signing key: pass --key <path> or set USERTASKS_LICENCE_SIGNING_KEY_FILE / USERTASKS_LICENCE_SIGNING_KEY. The key is never stored in the repository.')
}

if (command === 'keygen') {
  const kid = values.kid || fail('keygen needs --kid <key id>, e.g. lic-2027-1')
  const out = values.out || fail('keygen needs --out <path> for the private key (outside the repository)')
  if (insideRepo(out)) fail('Refusing to write a private key inside the repository.')
  if (existsSync(out)) fail(`${out} exists: not overwriting a key.`)
  const { privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  writeFileSync(out, pem, { mode: 0o600 })
  console.log(`Private key written to ${resolve(out)} (mode 0600). Keep it offline / in a KMS.`)
  console.log('Add this entry to LICENCE_KEYRING in lib/licensing/keyring.ts:')
  console.log(JSON.stringify(keyringEntryFor(pem, kid), null, 2))
} else if (command === 'sign') {
  const pem = readPrivateKey()
  const kid = values.kid || fail('sign needs --kid (the key id in lib/licensing/keyring.ts)')
  const customer = values.customer || fail('sign needs --customer "<legal name>"')
  const expires = values.expires || fail('sign needs --expires <ISO date>')
  if (Number.isNaN(Date.parse(expires))) fail('--expires must be an ISO 8601 date')
  if (!values.ext?.length) fail('sign needs one or more --ext <id>[:feature,feature]')
  const extensions: LicenceExtensionGrant[] = values.ext.map((spec) => {
    const [id, features] = spec.split(':')
    return { id: id.trim(), ...(features ? { features: features.split(',').map((f) => f.trim()).filter(Boolean) } : {}) }
  })
  const limits: Record<string, number> = {}
  for (const item of values.limit ?? []) {
    const [k, v] = item.split('=')
    if (!k || !Number.isFinite(Number(v))) fail(`--limit expects key=number, got ${item}`)
    limits[k.trim()] = Number(v)
  }
  const instanceIds = [...(values.instance ?? [])]
  const hostnames = [...(values.host ?? [])]
  if (values.request) {
    const request = JSON.parse(readFileSync(values.request, 'utf8')) as { kind?: string; instance_id?: string | null; hostnames?: string[] }
    if (request.kind !== 'usertasks.licence_request') fail(`${values.request} is not a UserTasks activation request`)
    if (request.instance_id) instanceIds.push(request.instance_id)
    hostnames.push(...(request.hostnames ?? []))
  }
  const licence = signLicence({
    format: LICENCE_FORMAT_VERSION,
    kind: LICENCE_KIND,
    licence_id: values['licence-id'] || `lic_${randomBytes(10).toString('hex')}`,
    customer: { name: customer, ...(values['customer-id'] ? { id: values['customer-id'] } : {}) },
    issued_at: new Date().toISOString(),
    ...(values['not-before'] ? { not_before: new Date(values['not-before']).toISOString() } : {}),
    expires_at: new Date(expires).toISOString(),
    ...(values['updates-until'] ? { updates_until: values['updates-until'] } : {}),
    ...(instanceIds.length || hostnames.length ? { binding: { instance_ids: [...new Set(instanceIds)], hostnames: [...new Set(hostnames)] } } : {}),
    extensions,
    ...(Object.keys(limits).length ? { limits } : {}),
    ...(values.trial ? { trial: true } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  }, pem, kid)
  const text = `${JSON.stringify(licence, null, 2)}\n`
  if (values.out) {
    writeFileSync(values.out, text)
    console.log(`Licence ${licence.licence_id} written to ${resolve(values.out)}`)
  } else process.stdout.write(text)
  if (!LICENCE_KEYRING.some((k) => k.kid === kid)) console.error(`warning: ${kid} is not in lib/licensing/keyring.ts — this build will not accept the licence.`)
} else if (command === 'verify') {
  const file = rest[0] || fail('verify needs a licence file')
  const text = readFileSync(file, 'utf8')
  parseLicence(text)
  const v = verifyLicence({ source: 'setting', raw: text }, { instanceId: values.instance?.[0] ?? null, hostnames: values.host ?? [] }, new Date(), LICENCE_KEYRING)
  console.log(JSON.stringify({ valid: v.valid, timing: v.timing, problems: v.problems }, null, 2))
  process.exit(v.valid && v.timing?.usable ? 0 : 1)
} else {
  fail('Usage: tsx scripts/licence-issue.ts keygen | sign | verify (see the header of this file)')
}
