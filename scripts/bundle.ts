/**
 * `npm run bundle`: the air-gapped install bundle (docs/setup-air-gapped.md).
 *
 *   npm run bundle -- create [--image usertasks:local] [--out dist/bundle] [--platform linux/arm64]
 *                            [--build [--build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true]...]
 *                            [--deps postgres,minio,valkey,mailpit,openbao,smoke[,pgbouncer,keycloak,local-kms,localstack] | none]
 *                            [--signing-key key.pem] [--no-sbom] [--no-tar]
 *   npm run bundle -- verify <bundle.tar.gz | dir> [--fingerprint aa:bb:…]
 *   npm run bundle -- load <bundle.tar.gz | dir> [--registry host[:port]/path] [--push]
 *
 * create, on a connected machine with Docker: the OCI images (`docker save`,
 * one platform), the Helm chart (.tgz), the Compose files, npm tarballs of
 * @usertasks/sdk and @usertasks/cli (the CLI with its dependencies bundled,
 * so `npm install -g` works offline), the docs (Markdown; the full docs site
 * is served by the app at /docs), SBOMs (syft, run in Docker), SHA256SUMS
 * and an ed25519 signature over it — the same key type and fingerprint
 * format as package signing (lib/packages). The key: --signing-key, else
 * BUNDLE_SIGNING_KEY (PEM), else a new key written next to the bundle (keep
 * it; publish its fingerprint). The bundle's bundle.sh verifies, loads and
 * runs it on the offline host without Node.js.
 *
 * Optional drivers (docs/optional-drivers.md) are decided when the image is
 * built and can't be added offline: --build builds --image from this
 * checkout for --platform with the Dockerfile's INCLUDE_* build args
 * (--build-arg), and every bundle's manifest lists which optional packages
 * the image has (and warns about the missing ones).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'
import { chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { createGzip } from 'node:zlib'
import { OPTIONAL_PACKAGES } from '../lib/optional-drivers'

const ROOT = path.resolve(__dirname, '..')
const SYFT_IMAGE = 'anchore/syft:v1.33.0'

/** Dependency images by short name (the tags the Compose files and the chart use). */
export const DEPENDENCY_IMAGES: Record<string, string> = {
  postgres: 'postgres:16-alpine',
  minio: 'pgsty/minio:latest',
  valkey: 'valkey/valkey:8-alpine',
  mailpit: 'axllent/mailpit:v1.27',
  openbao: 'openbao/openbao:2.3.1',
  smoke: 'node:22-alpine',
  pgbouncer: 'edoburu/pgbouncer:v1.24.1-p1',
  keycloak: 'quay.io/keycloak/keycloak:26.0',
  'local-kms': 'nsmithuk/local-kms:3.12.0',
  // The aws reference profile (compose/deploy/compose/aws.yml).
  localstack: 'localstack/localstack:4.9',
}
const DEFAULT_DEPS = ['postgres', 'minio', 'valkey', 'mailpit', 'openbao', 'smoke']

/** Files copied into compose/ (paths relative to the repository, kept as they are). */
const COMPOSE_FILES = [
  'docker-compose.yml',
  'deploy/compose/onprem.yml',
  'deploy/compose/kms.yml',
  'deploy/compose/kms/local-kms-seed.yaml',
  'deploy/compose/keycloak/usertasks-realm.json',
  'deploy/compose/smoke/smoke.mjs',
  'deploy/compose/standalone.env.example',
  // The cloud reference profiles (emulated; need --deps localstack for aws, and the azure / gcp emulators).
  'deploy/compose/aws.yml',
  'deploy/compose/azure.yml',
  'deploy/compose/gcp.yml',
  'deploy/compose/localstack/init-aws.sh',
  'deploy/compose/mocks/cloud-mocks.mjs',
]

/** The Dockerfile build args that choose the optional packages (lib/optional-drivers). */
export const DRIVER_BUILD_ARGS = [...new Set(Object.values(OPTIONAL_PACKAGES).flatMap((p) => (p.dockerArg ? [p.dockerArg.name] : [])))]

/** Parses --build-arg NAME=value, allowing only the optional-driver args. */
export function driverBuildArgs(list: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of list) {
    const m = /^([A-Z_]+)=(true|false)$/.exec(item)
    if (!m || !DRIVER_BUILD_ARGS.includes(m[1])) throw new Error(`--build-arg ${item}: expected one of ${DRIVER_BUILD_ARGS.join(', ')} =true|false`)
    out[m[1]] = m[2]
  }
  return out
}

/** Which optional packages an image has (present in its node_modules). */
function imageOptionalPackages(image: string): { present: string[]; missing: string[] } {
  const names = Object.keys(OPTIONAL_PACKAGES)
  const res = run('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', `for p in ${names.join(' ')}; do [ -d "node_modules/$p" ] && echo "$p"; done; true`], { quiet: true, allowFail: true })
  const present = res.stdout.split('\n').map((l) => l.trim()).filter((l) => names.includes(l))
  return { present, missing: names.filter((n) => !present.includes(n)) }
}

// ── Signing (ed25519; fingerprints as lib/packages/format.ts) ─────────────────

export function publicKeyDer(key: KeyObject): Buffer {
  return (key.type === 'public' ? key : createPublicKey(key)).export({ type: 'spki', format: 'der' })
}

export function fingerprintOf(publicKey: KeyObject): string {
  return createHash('sha256').update(publicKeyDer(publicKey)).digest('hex').slice(0, 32).match(/../g)!.join(':')
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full, base))
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out.sort()
}

/** SHA256SUMS text (sha256sum format) over every file but the sums and signature themselves. */
export async function checksums(dir: string): Promise<string> {
  const lines: string[] = []
  for (const file of listFiles(dir)) {
    if (file === 'SHA256SUMS' || file === 'SHA256SUMS.sig') continue
    lines.push(`${await sha256File(path.join(dir, file))}  ${file}`)
  }
  return `${lines.join('\n')}\n`
}

export interface VerifyResult { ok: boolean; fingerprint?: string; problems: string[]; files: number }

/** Checksums, completeness and the signature of an unpacked bundle. */
export async function verifyBundle(dir: string, expectedFingerprint?: string): Promise<VerifyResult> {
  const problems: string[] = []
  const sumsFile = path.join(dir, 'SHA256SUMS')
  if (!existsSync(sumsFile) || !existsSync(path.join(dir, 'SHA256SUMS.sig')) || !existsSync(path.join(dir, 'signing-key.pub.pem'))) {
    return { ok: false, problems: ['SHA256SUMS, SHA256SUMS.sig or signing-key.pub.pem is missing'], files: 0 }
  }
  const sums = readFileSync(sumsFile)
  const listed = new Map<string, string>()
  for (const line of sums.toString('utf8').split('\n').filter(Boolean)) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
    if (!m) { problems.push(`malformed SHA256SUMS line: ${line.slice(0, 80)}`); continue }
    listed.set(m[2], m[1])
  }
  for (const [file, hash] of listed) {
    const full = path.join(dir, file)
    if (!existsSync(full)) problems.push(`missing: ${file}`)
    else if ((await sha256File(full)) !== hash) problems.push(`checksum mismatch: ${file}`)
  }
  for (const file of listFiles(dir)) {
    if (['SHA256SUMS', 'SHA256SUMS.sig', 'compose/.env'].includes(file)) continue
    if (!listed.has(file)) problems.push(`not covered by SHA256SUMS: ${file}`)
  }
  let fingerprint: string | undefined
  try {
    const publicKey = createPublicKey(readFileSync(path.join(dir, 'signing-key.pub.pem')))
    if (publicKey.asymmetricKeyType !== 'ed25519') problems.push('signing-key.pub.pem is not an ed25519 key')
    fingerprint = fingerprintOf(publicKey)
    if (!verify(null, sums, publicKey, readFileSync(path.join(dir, 'SHA256SUMS.sig')))) problems.push('signature check failed: SHA256SUMS was not signed by signing-key.pub.pem')
  } catch (error) {
    problems.push(`signature: ${(error as Error).message}`)
  }
  if (expectedFingerprint && fingerprint && fingerprint !== expectedFingerprint.toLowerCase()) {
    problems.push(`signer fingerprint ${fingerprint} is not the expected ${expectedFingerprint}`)
  }
  return { ok: problems.length === 0, fingerprint, problems, files: listed.size }
}

/** The registry reference an image is pushed as (its own registry host replaced). */
export function targetRef(ref: string, registry: string): string {
  const first = ref.split('/')[0]
  const hasHost = ref.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')
  return `${registry.replace(/\/+$/, '')}/${hasHost ? ref.slice(first.length + 1) : ref}`
}

// ── create ───────────────────────────────────────────────────────────────────

function run(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean; allowFail?: boolean } = {}): { status: number; stdout: string } {
  if (!opts.quiet) console.log(`$ ${cmd} ${args.join(' ')}`)
  const res = spawnSync(cmd, args, { cwd: opts.cwd ?? ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (res.status !== 0 && !opts.allowFail) {
    process.stderr.write((res.stdout ?? '').slice(-3000) + (res.stderr ?? '').slice(-3000))
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')}… exited with ${res.status}`)
  }
  return { status: res.status ?? 1, stdout: res.stdout ?? '' }
}

const imageFile = (ref: string) => `${ref.replace(/[^A-Za-z0-9._-]+/g, '_')}.tar.gz`

async function saveImage(ref: string, platform: string, outFile: string, sbomDir: string | null): Promise<void> {
  const tmp = `${outFile}.tmp.tar`
  run('docker', ['save', '--platform', platform, '-o', tmp, ref])
  if (sbomDir) {
    const name = path.basename(outFile).replace(/\.tar\.gz$/, '.spdx.json')
    const res = run('docker', ['run', '--rm', '-v', `${path.dirname(tmp)}:/in:ro`, '-v', `${sbomDir}:/out`, SYFT_IMAGE,
      `docker-archive:/in/${path.basename(tmp)}`, '-q', '-o', `spdx-json=/out/${name}`], { allowFail: true })
    if (res.status !== 0) console.warn(`  (no SBOM for ${ref}: syft failed)`)
  }
  await pipeline(createReadStream(tmp), createGzip({ level: 6 }), createWriteStream(outFile))
  rmSync(tmp)
}

/** The CLI as an npm tarball with its dependencies inside (bundleDependencies), installable offline. */
function packCli(stage: string, out: string, sdkTarball: string): void {
  const cli = path.join(ROOT, 'packages/cli')
  const manifest = JSON.parse(readFileSync(path.join(cli, 'package.json'), 'utf8'))
  const work = path.join(stage, 'cli')
  mkdirSync(work, { recursive: true })
  for (const f of manifest.files as string[]) run('cp', ['-R', path.join(cli, f), work], { quiet: true })
  const deps = Object.keys(manifest.dependencies ?? {})
  for (const dep of deps) {
    const dest = path.join(work, 'node_modules', dep)
    mkdirSync(path.dirname(dest), { recursive: true })
    if (dep === '@usertasks/sdk') {
      mkdirSync(dest, { recursive: true })
      run('tar', ['-xzf', sdkTarball, '-C', dest, '--strip-components=1'], { quiet: true })
      continue
    }
    const src = path.join(ROOT, 'node_modules', dep)
    const depManifest = JSON.parse(readFileSync(path.join(src, 'package.json'), 'utf8'))
    if (Object.keys(depManifest.dependencies ?? {}).length) throw new Error(`${dep} has dependencies of its own: bundle them too`)
    run('cp', ['-R', src, dest], { quiet: true })
  }
  writeFileSync(path.join(work, 'package.json'), `${JSON.stringify({ ...manifest, bundleDependencies: deps }, null, 2)}\n`)
  run('npm', ['pack', '--pack-destination', out], { cwd: work })
}

async function create(values: Record<string, string | boolean | string[] | undefined>): Promise<void> {
  const version = readFileSync(path.join(ROOT, 'deploy/helm/usertasks/Chart.yaml'), 'utf8').match(/^appVersion:\s*"?([^"\n]+)"?/m)![1]
  const image = String(values.image ?? 'usertasks:local')
  const arch = run('docker', ['info', '--format', '{{.Architecture}}'], { quiet: true }).stdout.trim()
  const platform = String(values.platform ?? `linux/${{ x86_64: 'amd64', aarch64: 'arm64' }[arch] ?? arch}`)
  const depsArg = String(values.deps ?? DEFAULT_DEPS.join(','))
  const deps = depsArg === 'none' ? [] : depsArg.split(',').map((d) => d.trim()).filter(Boolean)
  for (const d of deps) if (!DEPENDENCY_IMAGES[d]) throw new Error(`unknown --deps entry ${d} (${Object.keys(DEPENDENCY_IMAGES).join(', ')})`)
  const outRoot = path.resolve(String(values.out ?? path.join(ROOT, 'dist/bundle')))
  const name = `usertasks-bundle-${version}-${platform.replace('/', '-')}`
  const dir = path.join(outRoot, name)
  if (existsSync(dir)) rmSync(dir, { recursive: true })
  for (const sub of ['images', 'charts', 'compose', 'npm', 'docs', 'sbom']) mkdirSync(path.join(dir, sub), { recursive: true })
  const stage = mkdtempSync(path.join(os.tmpdir(), 'usertasks-bundle-'))

  try {
    // 1. Images.
    const buildArgs = driverBuildArgs((values['build-arg'] as string[] | undefined) ?? [])
    if (values.build) {
      run('docker', ['buildx', 'build', '--platform', platform, '--load', '-t', image, ...Object.entries(buildArgs).flatMap(([k, v]) => ['--build-arg', `${k}=${v}`]), ROOT])
    } else if (Object.keys(buildArgs).length) {
      throw new Error('--build-arg needs --build')
    }
    if (run('docker', ['image', 'inspect', image], { quiet: true, allowFail: true }).status !== 0) throw new Error(`image ${image} not found: docker build -t ${image} . (or pass --build)`)
    const optional = imageOptionalPackages(image)
    if (optional.missing.length) {
      const args = [...new Set(optional.missing.map((n) => (OPTIONAL_PACKAGES as Record<string, { dockerArg: { name: string } | null }>)[n].dockerArg?.name).filter(Boolean))]
      console.warn(`The image has no ${optional.missing.join(', ')}: features that need them won't work offline. Rebuild with ${args.map((a) => `--build-arg ${a}=true`).join(' ')} if you need them (docs/optional-drivers.md).`)
    }
    const sbom = values['no-sbom'] ? null : path.join(dir, 'sbom')
    if (sbom && run('docker', ['image', 'inspect', SYFT_IMAGE], { quiet: true, allowFail: true }).status !== 0) {
      if (run('docker', ['pull', SYFT_IMAGE], { allowFail: true }).status !== 0) console.warn('  (syft unavailable: no SBOMs)')
    }
    const images: { file: string; ref: string; role: 'app' | 'dependency'; id: string }[] = []
    for (const [ref, role] of [[image, 'app'], ...deps.map((d) => [DEPENDENCY_IMAGES[d], 'dependency'])] as [string, 'app' | 'dependency'][]) {
      if (role === 'dependency') run('docker', ['pull', '--platform', platform, ref])
      const file = imageFile(ref)
      await saveImage(ref, platform, path.join(dir, 'images', file), sbom)
      const id = run('docker', ['image', 'inspect', '--format', '{{.Id}}', ref], { quiet: true }).stdout.trim()
      images.push({ file, ref, role, id })
    }
    writeFileSync(path.join(dir, 'images/images.txt'), images.map((i) => `${i.file} ${i.ref} ${i.role}`).join('\n') + '\n')

    // 2. Helm chart.
    run('helm', ['package', path.join(ROOT, 'deploy/helm/usertasks'), '--destination', path.join(dir, 'charts')])

    // 3. Compose files (same layout as the repository: compose/ is the project directory).
    for (const f of COMPOSE_FILES) {
      mkdirSync(path.dirname(path.join(dir, 'compose', f)), { recursive: true })
      copyFileSync(path.join(ROOT, f), path.join(dir, 'compose', f))
    }

    // 4. npm packages.
    run('npm', ['run', 'cli:build'])
    run('npm', ['pack', '--pack-destination', stage], { cwd: path.join(ROOT, 'packages/sdk') })
    const sdkTarball = path.join(stage, readdirSync(stage).find((f) => f.startsWith('usertasks-sdk-'))!)
    copyFileSync(sdkTarball, path.join(dir, 'npm', path.basename(sdkTarball)))
    packCli(stage, path.join(dir, 'npm'), sdkTarball)

    // 5. Docs (Markdown).
    run('cp', ['-R', path.join(ROOT, 'docs') + '/.', path.join(dir, 'docs')], { quiet: true })

    // 6. Install helper and README.
    copyFileSync(path.join(ROOT, 'deploy/bundle/bundle.sh'), path.join(dir, 'bundle.sh'))
    chmodSync(path.join(dir, 'bundle.sh'), 0o755)
    copyFileSync(path.join(ROOT, 'deploy/bundle/README.md'), path.join(dir, 'README.md'))

    // 7. Signing key, manifest, SHA256SUMS, signature.
    let privateKey: KeyObject
    const keyPem = values['signing-key'] ? readFileSync(String(values['signing-key']), 'utf8') : process.env.BUNDLE_SIGNING_KEY?.replace(/\\n/g, '\n')
    if (keyPem) {
      privateKey = createPrivateKey(keyPem)
      if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('the signing key must be an ed25519 private key (PEM)')
    } else {
      privateKey = generateKeyPairSync('ed25519').privateKey
      const keyFile = path.join(outRoot, `${name}.signing-key.pem`)
      writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
      console.warn(`No --signing-key / BUNDLE_SIGNING_KEY: generated ${path.relative(process.cwd(), keyFile)} (keep it private; reuse it with --signing-key).`)
    }
    const fingerprint = fingerprintOf(privateKey)
    writeFileSync(path.join(dir, 'signing-key.pub.pem'), createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }))
    const commit = run('git', ['rev-parse', 'HEAD'], { quiet: true, allowFail: true }).stdout.trim()
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({
      name: 'usertasks-bundle', version, platform, created: new Date().toISOString(), commit: commit || null,
      images, optionalPackages: optional, ...(values.build ? { buildArgs } : {}), chart: readdirSync(path.join(dir, 'charts')), npm: readdirSync(path.join(dir, 'npm')), sbom: readdirSync(path.join(dir, 'sbom')),
      signer: { alg: 'ed25519', fingerprint },
    }, null, 2)}\n`)
    const sums = await checksums(dir)
    writeFileSync(path.join(dir, 'SHA256SUMS'), sums)
    writeFileSync(path.join(dir, 'SHA256SUMS.sig'), sign(null, Buffer.from(sums), privateKey))

    // 8. One tarball (+ its checksum, for the transfer).
    let tarball = ''
    if (!values['no-tar']) {
      tarball = path.join(outRoot, `${name}.tar`)
      // COPYFILE_DISABLE: no macOS ._* metadata files in the archive.
      execFileSync('tar', ['-cf', tarball, '-C', outRoot, name], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
      writeFileSync(`${tarball}.sha256`, `${await sha256File(tarball)}  ${path.basename(tarball)}\n`)
    }
    const size = (f: string) => `${(statSync(f).size / 1024 / 1024).toFixed(0)} MB`
    console.log(`\nBundle ${name}: ${images.length} image(s), chart, compose, npm, docs, ${readdirSync(path.join(dir, 'sbom')).length} SBOM(s)`)
    console.log(`  ${tarball ? `${path.relative(process.cwd(), tarball)} (${size(tarball)})` : path.relative(process.cwd(), dir)}`)
    console.log(`  signer fingerprint: ${fingerprint}`)
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

/** A bundle path (tarball or directory) as an unpacked directory. */
function unpacked(target: string): string {
  const full = path.resolve(target)
  if (statSync(full).isDirectory()) return full
  const into = mkdtempSync(path.join(os.tmpdir(), 'usertasks-bundle-'))
  execFileSync('tar', ['-xf', full, '-C', into])
  const [only] = readdirSync(into)
  return path.join(into, only)
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      image: { type: 'string' }, out: { type: 'string' }, platform: { type: 'string' }, deps: { type: 'string' },
      'signing-key': { type: 'string' }, 'no-sbom': { type: 'boolean' }, 'no-tar': { type: 'boolean' },
      fingerprint: { type: 'string' }, registry: { type: 'string' }, push: { type: 'boolean' },
      build: { type: 'boolean' }, 'build-arg': { type: 'string', multiple: true },
    },
  })
  const [command, target] = positionals
  if (command === 'create') return create(values)
  if (command === 'verify' || command === 'load') {
    if (!target) throw new Error(`${command} needs the bundle (.tar or directory)`)
    const dir = unpacked(target)
    const result = await verifyBundle(dir, values.fingerprint)
    for (const p of result.problems) console.error(`  ${p}`)
    if (!result.ok) throw new Error('the bundle did not verify')
    console.log(`Checksums OK (${result.files} files), signature OK. Signer fingerprint: ${result.fingerprint}`)
    if (!values.fingerprint) console.log('Compare it with the fingerprint published with the release (or pass --fingerprint).')
    if (command === 'load') {
      const args = ['load', ...(values.registry ? ['--registry', values.registry] : []), ...(values.push ? ['--push'] : [])]
      const child = spawn('sh', [path.join(dir, 'bundle.sh'), ...args], { stdio: 'inherit' })
      const code = await new Promise<number>((resolve) => child.on('exit', (c) => resolve(c ?? 1)))
      if (code !== 0) process.exit(code)
    }
    return
  }
  console.log(readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*\n?/, '').replace(/^ \* ?/gm, ''))
  process.exit(command ? 2 : 0)
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch((error) => {
    console.error(`bundle: ${(error as Error).message}`)
    process.exit(1)
  })
}
