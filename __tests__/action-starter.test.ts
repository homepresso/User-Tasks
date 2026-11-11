import { createHash, generateKeyPairSync, sign } from 'crypto'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import * as esbuild from 'esbuild'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { ACTION_CAPABILITIES, ACTION_FIELD_TYPES, ACTION_LIMITS } from '@/lib/custom-actions/contract'
import { parseActionManifest } from '@/lib/custom-actions/manifest'
import { parseActionModule, parseActionZip, probeActionModule } from '@/lib/custom-actions/package'
import { runAction } from '@/packages/action/src/testing'

const ROOT = process.cwd()
const STARTER = path.join(ROOT, 'templates/action-starter')
const ZIP = path.join(ROOT, 'public/downloads/action-starter.zip')
const PACKAGE_SRC = path.join(ROOT, 'packages/action/src')
const VARIANTS = ['typescript', 'javascript'] as const
const VENDORED = ['contract.ts', 'sandbox.ts', 'helpers.ts', 'testing.ts', 'index.ts']
const SKIP_DIRS = ['node_modules', 'dist', 'release', '.harness']

/** The template tree as the zip should hold it (no installs or build output). */
function templateFiles(dir = STARTER, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return SKIP_DIRS.includes(name) ? [] : templateFiles(full, rel)
    return ['.DS_Store', 'package-lock.json'].includes(name) ? [] : [rel]
  })
}

const read = (...parts: string[]) => readFileSync(path.join(STARTER, ...parts), 'utf8')
const manifestOf = (variant: string) => JSON.parse(read(variant, 'manifest.json'))
const casesOf = (variant: string) => JSON.parse(read(variant, 'test/cases.json')).cases as Array<{ name: string; operation: string; inputs: Record<string, unknown>; expect?: Record<string, unknown>; expect_error?: string }>

/** The kit's build (scripts/build.mjs), in memory. */
async function buildModule(variant: string): Promise<string> {
  const entry = variant === 'typescript' ? 'src/action.ts' : 'src/action.js'
  const result = await esbuild.build({
    entryPoints: [path.join(STARTER, variant, entry)],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2020',
    minifySyntax: true,
    write: false,
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

describe('action starter kit', () => {
  it('public/downloads/action-starter.zip holds exactly the template (run npm run action-starter:build)', () => {
    const zip = new PizZip(readFileSync(ZIP))
    const entries = Object.values(zip.files).filter((file) => !file.dir)
    const expected = templateFiles().sort()
    expect(entries.map((file) => file.name.replace(/^action-starter\//, '')).sort()).toEqual(expected)
    for (const rel of expected) {
      const entry = zip.file(`action-starter/${rel}`)
      expect(entry, rel).not.toBeNull()
      expect(Buffer.from(entry!.asUint8Array()).equals(readFileSync(path.join(STARTER, rel))), `${rel} differs`).toBe(true)
    }
  })

  it('ships both variants with a manifest, tests, the harness, a README and package scripts', () => {
    const files = new Set(templateFiles())
    for (const variant of VARIANTS) {
      for (const file of ['manifest.json', 'README.md', 'package.json', '.gitignore', 'test/cases.json', 'harness/run.ts', 'scripts/build.mjs', 'scripts/test.mjs', 'scripts/package.mjs', 'scripts/checks.mjs', 'scripts/zip.mjs']) {
        expect(files.has(`${variant}/${file}`), `${variant}/${file}`).toBe(true)
      }
      const pkg = JSON.parse(read(variant, 'package.json'))
      expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining(['build', 'test', 'package']))
      // The harness runs the same QuickJS build the app pins.
      expect(pkg.devDependencies['quickjs-emscripten-core']).toBe('0.32.0')
      expect(pkg.devDependencies['@jitl/quickjs-singlefile-cjs-release-sync']).toBe('0.32.0')
      expect(pkg.devDependencies.esbuild).toBeDefined()
      expect(pkg.dependencies ?? {}).toEqual({})
      expect(pkg.version).toBe(manifestOf(variant).version)
    }
    expect(files.has('typescript/src/action.ts')).toBe(true)
    expect(files.has('typescript/tsconfig.json')).toBe(true)
    expect(files.has('javascript/src/action.js')).toBe(true)
    expect(read('README.md')).toContain('/docs/workflows/custom-actions')
  })

  it.each(VARIANTS)('%s: vendored @user-tasks/action sources are byte-identical to packages/action/src', (variant) => {
    for (const file of VENDORED) {
      expect(read(variant, 'vendor/usertasks-action', file), file).toBe(readFileSync(path.join(PACKAGE_SRC, file), 'utf8'))
    }
  })

  it('the two variants share the manifest, the tests, the harness and the scripts', () => {
    expect(manifestOf('javascript')).toEqual(manifestOf('typescript'))
    expect(read('javascript', 'test/cases.json')).toBe(read('typescript', 'test/cases.json'))
    expect(read('javascript', 'harness/run.ts')).toBe(read('typescript', 'harness/run.ts'))
    for (const script of readdirSync(path.join(STARTER, 'typescript/scripts'))) {
      expect(read('javascript', 'scripts', script), script).toBe(read('typescript', 'scripts', script))
    }
  })

  it('the manifest passes the app\'s strict parser', () => {
    const raw = manifestOf('typescript')
    const manifest = parseActionManifest(raw)
    expect(manifest).toMatchObject({ key: 'acme_tax', name: 'Acme tax calculator', version: '1.0.0', entry: 'dist/action.js', capabilities: {} })
    expect(manifest.operations.map((op) => op.id)).toEqual(['calculate', 'invoice_totals'])
    for (const op of manifest.operations) expect(op.sample, op.id).toBeDefined()
    expect(manifest.key.startsWith('ut_')).toBe(false)
  })

  it('the upload checks in scripts/checks.mjs match the contract', async () => {
    const checks = await import(pathToFileURL(path.join(STARTER, 'typescript/scripts/checks.mjs')).href)
    expect(checks.FIELD_TYPES).toEqual([...ACTION_FIELD_TYPES])
    expect(checks.CAPABILITIES).toEqual([...ACTION_CAPABILITIES])
    expect(checks.MODULE_BYTES).toBe(ACTION_LIMITS.moduleBytes)
    expect(checks.MANIFEST_BYTES).toBe(ACTION_LIMITS.manifestBytes)
    expect(checks.MAX_OPERATIONS).toBe(ACTION_LIMITS.operations)
    expect(checks.MAX_FIELDS).toBe(ACTION_LIMITS.fieldsPerOperation)
    expect(() => checks.readManifest(path.join(STARTER, 'typescript/manifest.json'))).not.toThrow()
  })

  it.each(VARIANTS)('%s: the built module uploads and passes its samples and test cases in the sandbox', async (variant) => {
    const code = await buildModule(variant)
    const manifest = manifestOf(variant)
    expect(code).not.toMatch(/^\s*import\s/m)
    const parsed = parseActionModule(code, manifest)
    expect(parsed.warnings).toEqual([])
    expect(await probeActionModule(parsed)).toEqual([])

    for (const op of manifest.operations) {
      const result = await runAction({ module: code, manifest, operation: op.id, inputs: op.sample })
      expect(result.ok, `${op.id}: ${result.error?.message}`).toBe(true)
      for (const field of op.outputs) expect(result.outputs, `${op.id}.${field.name}`).toHaveProperty(field.name)
    }
    for (const testCase of casesOf(variant)) {
      const result = await runAction({ module: code, manifest, operation: testCase.operation, inputs: testCase.inputs })
      if (testCase.expect_error) {
        expect(result.ok, testCase.name).toBe(false)
        expect(result.error?.code, testCase.name).toBe(testCase.expect_error)
      } else {
        expect(result.ok, `${testCase.name}: ${result.error?.message}`).toBe(true)
        expect(result.outputs, testCase.name).toMatchObject(testCase.expect ?? {})
      }
    }
  }, 30_000)

  it('the package script\'s zip (with signature.json) is accepted and verified', async () => {
    const { makeZip } = await import(pathToFileURL(path.join(STARTER, 'typescript/scripts/zip.mjs')).href)
    const bytes = Buffer.from(await buildModule('typescript'))
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const sha = createHash('sha256').update(bytes).digest('hex')
    const signature = {
      alg: 'ed25519',
      public_key: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      signature: sign(null, Buffer.from(sha, 'utf8'), privateKey).toString('base64'),
    }
    const zip: Buffer = makeZip([
      { name: 'manifest.json', data: Buffer.from(read('typescript', 'manifest.json')) },
      { name: 'dist/action.js', data: bytes },
      { name: 'README.md', data: Buffer.from(read('typescript', 'README.md')) },
      { name: 'signature.json', data: Buffer.from(JSON.stringify(signature)) },
    ])
    const parsed = await parseActionZip(new Uint8Array(zip))
    expect(parsed.manifest.entry).toBe('dist/action.js')
    expect(parsed.sha256).toBe(sha)
    expect(parsed.signature?.verified).toBe(true)
    expect(parsed.warnings).toEqual([])
  })

  it('package.mjs signs the module SHA-256 the same way', () => {
    const script = read('typescript', 'scripts/package.mjs')
    expect(script).toContain("sign(null, Buffer.from(sha256, 'utf8'), privateKey)")
    expect(script).toContain("export({ format: 'der', type: 'spki' })")
  })
})
