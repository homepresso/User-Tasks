/**
 * Makes release/<key>-<version>.zip — manifest.json, dist/action.js and
 * README.md — ready to upload in Extensibility → Workflow actions (or with
 * the API, MCP or CLI).
 *
 * Signing (optional): pass an ed25519 private key (PEM) and the zip also
 * gets signature.json — { alg, public_key, signature } where signature is
 * the ed25519 signature over the module's SHA-256 (hex). UserTasks records
 * the key fingerprint and whether it verified on the version.
 *
 *   npm run package -- --sign ~/keys/acme-actions.pem
 *   ACTION_SIGNING_KEY=~/keys/acme-actions.pem npm run package
 *
 * Make a key once with: openssl genpkey -algorithm ed25519 -out acme-actions.pem
 * (keep it out of the repository).
 */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { ZIP_BYTES, checkModule, readManifest } from './checks.mjs'
import { makeZip } from './zip.mjs'

const manifest = readManifest()
const entry = manifest.entry ?? 'dist/action.js'
if (!existsSync(entry)) throw new Error(`${entry} is missing: run npm run build first`)
const code = readFileSync(entry)
checkModule(code.toString('utf8'), manifest)

const files = [
  { name: 'manifest.json', data: readFileSync('manifest.json') },
  { name: entry, data: code },
]
if (existsSync('README.md')) files.push({ name: 'README.md', data: readFileSync('README.md') })

const signFlag = process.argv.indexOf('--sign')
const keyPath = (signFlag > -1 ? process.argv[signFlag + 1] : process.env.ACTION_SIGNING_KEY)?.replace(/^~(?=\/)/, homedir())
const sha256 = createHash('sha256').update(code).digest('hex')
if (keyPath) {
  const privateKey = createPrivateKey(readFileSync(keyPath))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error(`${keyPath} is not an ed25519 key`)
  const signature = {
    alg: 'ed25519',
    public_key: createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64'),
    signature: sign(null, Buffer.from(sha256, 'utf8'), privateKey).toString('base64'),
  }
  files.push({ name: 'signature.json', data: Buffer.from(`${JSON.stringify(signature, null, 2)}\n`) })
}

const zip = makeZip(files)
if (zip.length > ZIP_BYTES) throw new Error(`zip is ${zip.length} bytes; the limit is ${ZIP_BYTES}`)
mkdirSync('release', { recursive: true })
const out = `release/${manifest.key}-${manifest.version}.zip`
writeFileSync(out, zip)
console.log(`${out}  ${(zip.length / 1024).toFixed(1)} KB  sha256 ${sha256.slice(0, 16)}…${keyPath ? '  signed' : ''}`)
console.log('Upload it in Extensibility → Workflow actions → Upload, or with POST /api/v1/workflow-activities/upload (multipart file=@zip)')
