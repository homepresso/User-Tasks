/**
 * `npm run release:bundle`: the release assets of the one-line installer
 * (docs: /docs/self-hosting/install#one-line-installer).
 *
 *   npm run release:bundle -- create [--version <x.y.z>] [--image ghcr.io/homepresso/usertasks:<v>]
 *                                    [--image-digest sha256:…] [--out dist/release]
 *                                    [--signing-key key.pem] [--previous <x.y.z>] [--migrations-dir <dir>] [--local]
 *   npm run release:bundle -- verify <dir> [--public-key key.pub.pem]
 *   npm run release:bundle -- set-key <key.pub.pem | private key.pem>
 *   npm run release:bundle -- keygen --out <key.pem>
 *
 * create writes dist/release/v<version>/:
 *   usertasks-<version>.tar.gz   compose file, env template, the `usertasks` wrapper (sh, ps1, cmd), manifest.json
 *   install.sh, install.ps1      the installers (with the embedded release key)
 *   release.json                 version discovery for `latest/download/release.json`
 *   SHA256SUMS, SHA256SUMS.sig   checksums of all of the above, signed with ed25519
 *   RELEASE_NOTES.md             from deploy/install/RELEASE_NOTES.template.md
 * The key: --signing-key, else RELEASE_SIGNING_KEY (PEM), else BUNDLE_SIGNING_KEY
 * (the air-gapped bundle's key, the recommended single key), else a throwaway
 * key next to the output (local tests; never publish with it). The version
 * defaults to package.json's. --image-digest pins the image (the release
 * workflow passes the digest it pushed), so the signed bundle names exactly
 * one image. --local allows installers without a committed release key (the
 * signing key is embedded in the copies written here): test releases only.
 *
 * set-key writes deploy/install/release-key.pub.pem and embeds the key in
 * install.sh and install.ps1 (a private key is accepted: only its public half
 * is written). keygen makes a new ed25519 key (keep it secret; store it as the
 * RELEASE_SIGNING_KEY repository secret).
 */
import { execFileSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { sha256File } from './bundle'
import {
  BUNDLE_FILES, INSTALLER_FILES, assertVersion, buildManifest, bundleName, embeddedKey, fingerprintOf, manifestJson,
  newMigrations, parseSums, publicKeyPem, releaseJson, releaseNotesValues, renderTemplate, signSums, sumsText, verifySums,
  withEmbeddedKey,
} from './release-bundle-helpers'

const ROOT = path.resolve(__dirname, '..')
const INSTALL_DIR = path.join(ROOT, 'deploy/install')
const KEY_FILE = path.join(INSTALL_DIR, 'release-key.pub.pem')

function gitOut(args: string[]): string | undefined {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return undefined }
}

function loadSigningKey(file: string | undefined, outDir: string): { key: KeyObject; throwaway: boolean } {
  const pem = file ? readFileSync(file, 'utf8') : (process.env.RELEASE_SIGNING_KEY || process.env.BUNDLE_SIGNING_KEY)?.replace(/\\n/g, '\n')
  if (pem) {
    const key = createPrivateKey(pem)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('the signing key must be an ed25519 private key (PEM)')
    return { key, throwaway: false }
  }
  const { privateKey } = generateKeyPairSync('ed25519')
  const keyFile = path.join(outDir, 'THROWAWAY-signing-key.pem')
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.warn(`No --signing-key / RELEASE_SIGNING_KEY: signed with a throwaway key (${path.relative(process.cwd(), keyFile)}). For local tests only.`)
  return { key: privateKey, throwaway: true }
}

async function create(values: Record<string, string | boolean | undefined>) {
  const pkgVersion = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string
  const version = assertVersion(String(values.version ?? pkgVersion))
  const outRoot = path.resolve(String(values.out ?? path.join(ROOT, 'dist/release')))
  const out = path.join(outRoot, `v${version}`)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  const migrationsDir = path.resolve(String(values['migrations-dir'] ?? path.join(ROOT, 'supabase/migrations')))
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))
  const manifest = buildManifest({
    version,
    image: values.image ? String(values.image) : undefined,
    imageDigest: values['image-digest'] ? String(values['image-digest']) : undefined,
    gitCommit: gitOut(['rev-parse', 'HEAD']),
    migrations,
  })

  const { key, throwaway } = loadSigningKey(values['signing-key'] ? String(values['signing-key']) : undefined, outRoot)
  const pubPem = publicKeyPem(key)

  // The bundle: usertasks-<v>/… as a gzipped tar.
  const stage = path.join(outRoot, `.stage-${version}`)
  const top = path.join(stage, `usertasks-${version}`)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(top, { recursive: true })
  for (const [src, name, exec] of BUNDLE_FILES) {
    copyFileSync(path.join(ROOT, src), path.join(top, name))
    chmodSync(path.join(top, name), exec ? 0o755 : 0o644)
  }
  writeFileSync(path.join(top, 'manifest.json'), manifestJson(manifest))
  // bsdtar (macOS) would add extended attributes GNU tar warns about; release builds run on Linux.
  const macFlags = process.platform === 'darwin' ? ['--no-xattrs', '--no-mac-metadata'] : []
  execFileSync('tar', [...macFlags, '-czf', path.join(out, bundleName(version)), '-C', stage, `usertasks-${version}`], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  rmSync(stage, { recursive: true, force: true })

  // The installers carry the key that signs this release (a throwaway one only in local tests).
  for (const name of INSTALLER_FILES) {
    const script = readFileSync(path.join(INSTALL_DIR, name), 'utf8')
    const embedded = embeddedKey(script)
    if (!throwaway && embedded && createPublicKey(embedded).export({ type: 'spki', format: 'der' }).compare(createPublicKey(pubPem).export({ type: 'spki', format: 'der' })) !== 0) {
      throw new Error(`deploy/install/${name} embeds a different release key than the signing key (npm run release:bundle -- set-key)`)
    }
    if (!throwaway && !embedded && !values.local) throw new Error(`deploy/install/${name} has no embedded release key: run npm run release:bundle -- set-key <public key> and commit it first`)
    writeFileSync(path.join(out, name), withEmbeddedKey(script, pubPem), { mode: 0o644 })
  }
  writeFileSync(path.join(out, 'release.json'), releaseJson(manifest))

  const entries: Record<string, string> = {}
  for (const name of [bundleName(version), ...INSTALLER_FILES, 'release.json']) entries[name] = await sha256File(path.join(out, name))
  const sums = sumsText(entries)
  writeFileSync(path.join(out, 'SHA256SUMS'), sums)
  writeFileSync(path.join(out, 'SHA256SUMS.sig'), signSums(sums, key))
  writeFileSync(path.join(out, 'release-key.pub.pem'), pubPem)

  // Release notes.
  const previous = values.previous ? assertVersion(String(values.previous)) : undefined
  const prevList = previous ? (gitOut(['ls-tree', '--name-only', `v${previous}`, 'supabase/migrations/']) ?? '').split('\n').map((l) => path.basename(l)) : []
  const notes = renderTemplate(readFileSync(path.join(INSTALL_DIR, 'RELEASE_NOTES.template.md'), 'utf8'), releaseNotesValues({
    manifest,
    fingerprint: fingerprintOf(key),
    previousVersion: previous,
    newMigrations: previous ? newMigrations(migrations, prevList) : [],
  }))
  writeFileSync(path.join(out, 'RELEASE_NOTES.md'), notes)

  console.log(`Release ${version}: ${path.relative(process.cwd(), out)}`)
  for (const name of Object.keys(entries).sort()) console.log(`  ${entries[name]}  ${name}`)
  console.log(`  image: ${manifest.imageDigest ? `${manifest.image}@${manifest.imageDigest}` : `${manifest.image} (not pinned: pass --image-digest)`}`)
  console.log(`  signer fingerprint: ${fingerprintOf(key)}${throwaway ? ' (THROWAWAY key)' : ''}`)
}

async function verifyDir(dir: string, publicKeyFile?: string) {
  const keyPem = readFileSync(publicKeyFile ?? (existsSync(KEY_FILE) ? KEY_FILE : path.join(dir, 'release-key.pub.pem')), 'utf8')
  const key = createPublicKey(keyPem)
  const sums = readFileSync(path.join(dir, 'SHA256SUMS'))
  if (!verifySums(sums, readFileSync(path.join(dir, 'SHA256SUMS.sig')), key)) throw new Error('signature check failed')
  const listed = parseSums(sums.toString('utf8'))
  for (const [name, want] of Object.entries(listed)) {
    const have = await sha256File(path.join(dir, name))
    if (have !== want) throw new Error(`checksum mismatch: ${name}`)
  }
  for (const name of INSTALLER_FILES) {
    const embedded = embeddedKey(readFileSync(path.join(dir, name), 'utf8'))
    if (!embedded || createPublicKey(embedded).export({ type: 'spki', format: 'der' }).compare(key.export({ type: 'spki', format: 'der' })) !== 0) {
      throw new Error(`${name} does not embed the signing key`)
    }
  }
  console.log(`Signature OK, ${Object.keys(listed).length} checksums OK. Signer fingerprint: ${fingerprintOf(key)}`)
}

function setKey(file: string) {
  const text = readFileSync(file, 'utf8')
  const pub = text.includes('PRIVATE KEY') ? createPublicKey(createPrivateKey(text)) : createPublicKey(text)
  if (pub.asymmetricKeyType !== 'ed25519') throw new Error('the release key must be ed25519')
  const pem = publicKeyPem(pub)
  writeFileSync(KEY_FILE, pem)
  for (const name of INSTALLER_FILES) {
    const p = path.join(INSTALL_DIR, name)
    writeFileSync(p, withEmbeddedKey(readFileSync(p, 'utf8'), pem))
  }
  console.log(`Release key set (fingerprint ${fingerprintOf(pub)}): deploy/install/release-key.pub.pem, install.sh, install.ps1. Commit them.`)
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      version: { type: 'string' }, image: { type: 'string' }, 'image-digest': { type: 'string' }, out: { type: 'string' },
      'signing-key': { type: 'string' }, previous: { type: 'string' }, 'migrations-dir': { type: 'string' },
      'public-key': { type: 'string' }, local: { type: 'boolean' },
    },
  })
  const [command, target] = positionals
  if (command === 'create') return create(values)
  if (command === 'verify') {
    if (!target) throw new Error('verify needs the release folder')
    return verifyDir(path.resolve(target), values['public-key'])
  }
  if (command === 'set-key') {
    if (!target) throw new Error('set-key needs a key file')
    return setKey(target)
  }
  if (command === 'keygen') {
    if (!values.out) throw new Error('keygen needs --out <file>')
    if (existsSync(values.out)) throw new Error(`${values.out} exists`)
    const { privateKey } = generateKeyPairSync('ed25519')
    writeFileSync(values.out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    console.log(`Wrote ${values.out} (fingerprint ${fingerprintOf(privateKey)}). Keep it secret; then: npm run release:bundle -- set-key ${values.out}`)
    return
  }
  console.log(readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*\n?/, '').replace(/^ \* ?/gm, ''))
  process.exit(command ? 2 : 0)
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error) => {
    console.error(`release:bundle: ${(error as Error).message}`)
    process.exit(1)
  })
}
