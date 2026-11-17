/**
 * Generate the TRIAL-ONLY licence signing key (owner runs this once).
 *
 *   npx tsx scripts/licensing/new-trial-key.ts [--kid trial-1] [--out ~/secure/usertasks-trial-1.pem] [--sku sharepoint-se]
 *
 * - Writes the Ed25519 private key (PKCS#8 PEM) to --out with mode 0600 —
 *   outside the repository, never over an existing file. Set its contents as
 *   the Vercel environment secret TRIAL_LICENCE_SIGNING_KEY (and TRIAL_LICENCE_KID
 *   if the kid is not the only trial key), then delete or lock the file away.
 * - Prints ONLY the public keyring entry (kind 'trial') to paste into
 *   LICENCE_KEYRING in lib/licensing/keyring.ts. The private key is never printed.
 *
 * This key can only sign trials: installations accept what it signs only for
 * `trial: true`, at most 30 days, the listed SKUs and exactly one farm
 * (lib/licensing/trial-policy.ts). The main licence key is not involved.
 */

import { generateKeyPairSync } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { keyringEntryFor } from '../../lib/licensing/format'
import { TRIAL_SKUS } from '../../lib/licensing/trial-policy'

const repoRoot = resolve(__dirname, '..', '..')

function fail(message: string): never {
  console.error(message)
  process.exit(2)
}

const { values } = parseArgs({ options: { kid: { type: 'string' }, out: { type: 'string' }, sku: { type: 'string', multiple: true } } })
const kid = values.kid || 'trial-1'
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(kid)) fail('--kid: lower-case letters, digits and hyphens')
const skus = values.sku?.length ? values.sku : ['sharepoint-se']
for (const sku of skus) if (!TRIAL_SKUS[sku]) fail(`--sku ${sku}: no trial rules for it in lib/licensing/trial-policy.ts`)
const out = resolve((values.out || `~/usertasks-${kid}.pem`).replace(/^~(?=$|\/)/, homedir()))
const rel = relative(repoRoot, out)
if (!rel.startsWith('..') && !isAbsolute(rel)) fail('Refusing to write a private key inside the repository: choose a path outside the checkout.')
if (existsSync(out)) fail(`${out} exists: not overwriting a key.`)

const { privateKey } = generateKeyPairSync('ed25519')
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
writeFileSync(out, pem, { mode: 0o600, flag: 'wx' })
const entry = { ...keyringEntryFor(pem, kid), kind: 'trial' as const, trialSkus: skus, note: `Self-serve trial key (${new Date().toISOString().slice(0, 10)}).` }

console.log(`Private key written to ${out} (mode 0600). It is NOT printed.`)
console.log('')
console.log('1. Set it as a Vercel environment secret (production):')
console.log(`     vercel env add TRIAL_LICENCE_SIGNING_KEY production < ${out}`)
if (kid !== 'trial-1') console.log(`     vercel env add TRIAL_LICENCE_KID production   (value: ${kid})`)
console.log('2. Add this PUBLIC entry to LICENCE_KEYRING in lib/licensing/keyring.ts:')
console.log('')
console.log(`  { kid: '${entry.kid}', kind: 'trial', trialSkus: ${JSON.stringify(entry.trialSkus).replace(/"/g, "'")}, public_key: '${entry.public_key}', fingerprint: '${entry.fingerprint}', note: '${entry.note}' },`)
console.log('')
console.log('3. Deploy, then remove the file (or keep it offline as a backup).')
