/**
 * Build-time extension registry (lib/extensions/build/codegen.ts) and the
 * public-repo guard rails:
 *  - with USERTASKS_EXTENSIONS unset the generated modules are the committed
 *    empty ones (the public build is unchanged), and the committed files ARE
 *    empty (an Enterprise build's registry must never be committed);
 *  - the example extension resolves, and an incompatible one fails the build;
 *  - core never imports a private extension package (@usertasks-ext/*) or an
 *    in-repo extension directly — only the generated registry may.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateExtensionRegistry, parseExtensionList, renderClientRegistry, renderPagesRegistry, renderServerRegistry, PRIVATE_SCOPES } from '@/lib/extensions/build/codegen'

const root = path.resolve(__dirname, '..')

describe('extension codegen', () => {
  it('parses the comma list', () => {
    expect(parseExtensionList(' a, ./b ,, @usertasks-ext/c ')).toEqual(['a', './b', '@usertasks-ext/c'])
    expect(parseExtensionList(undefined)).toEqual([])
  })

  it('keeps the committed registry empty (USERTASKS_EXTENSIONS unset = public build unchanged)', () => {
    const result = generateExtensionRegistry({ root, extensions: '', write: false })
    expect(result.extensions).toEqual([])
    expect(result.transpilePackages).toEqual([])
    for (const file of result.files) {
      expect(file.changed, `${path.relative(root, file.path)} must be committed empty — run \`npm run extensions:gen\` without USERTASKS_EXTENSIONS`).toBe(false)
    }
    expect(readFileSync(path.join(root, 'lib/extensions/generated/registry.client.ts'), 'utf8')).toContain('GENERATED_EXTENSIONS: readonly ExtensionDefinition[] = []')
  })

  it('resolves the in-repo example extension (manifest, server, pages)', () => {
    const result = generateExtensionRegistry({ root, extensions: './extensions/example-hello', write: false })
    expect(result.extensions).toEqual([expect.objectContaining({
      id: 'example-hello', version: '1.0.0',
      manifest: '@/extensions/example-hello/manifest', server: '@/extensions/example-hello/server', pages: '@/extensions/example-hello/pages',
      packageName: null,
    })])
    const client = result.files.find((f) => f.path.endsWith('registry.client.ts'))!
    expect(client.content).toContain("import m0 from '@/extensions/example-hello/manifest'")
    expect(client.changed).toBe(true)
  })

  it('renders package imports and transpilePackages for npm extensions', () => {
    const ext = { spec: '@usertasks-ext/demo', id: 'demo', version: '1.0.0', manifest: '@usertasks-ext/demo/manifest', server: '@usertasks-ext/demo/server', pages: null, packageName: '@usertasks-ext/demo' }
    expect(renderClientRegistry([ext])).toContain("import m0 from '@usertasks-ext/demo/manifest'")
    expect(renderServerRegistry([ext])).toContain('[s0]')
    expect(renderPagesRegistry([ext])).toContain('= {}')
  })

  it('fails the build for an incompatible, missing or duplicated extension', () => {
    const dir = mkdtempSync(path.join(root, '.tmp-ext-'))
    try {
      const rel = `./${path.basename(dir)}`
      writeFileSync(path.join(dir, 'usertasks-extension.json'), JSON.stringify({ id: 'future-ext', version: '1.0.0', engines: { usertasks: '>=99.0.0' } }))
      writeFileSync(path.join(dir, 'manifest.ts'), 'export default {}')
      expect(() => generateExtensionRegistry({ root, extensions: rel, write: false })).toThrow(/needs UserTasks >=99.0.0/)
      expect(() => generateExtensionRegistry({ root, extensions: './no/such/dir', write: false })).toThrow(/does not exist/)
      expect(() => generateExtensionRegistry({ root, extensions: '@usertasks-ext/not-installed', write: false })).toThrow(/not installed/)
      expect(() => generateExtensionRegistry({ root, extensions: './extensions/example-hello,./extensions/example-hello', write: false })).toThrow(/listed twice/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses paths outside the project', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'ext-outside-'))
    mkdirSync(path.join(outside, 'x'))
    expect(() => generateExtensionRegistry({ root, extensions: path.join(outside, 'x'), write: false })).toThrow(/outside the project/)
  })
})

/** Source files of core (not extensions, not tests, not generated). */
function coreFiles(): string[] {
  const out: string[] = []
  const skip = new Set(['node_modules', '.next', 'extensions', '__tests__', 'generated', 'public', '.git', 'coverage', 'dist'])
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name) || name.startsWith('.tmp-ext-')) continue
      const full = path.join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) walk(full)
      else if (/\.(tsx?|mjs|js)$/.test(name)) out.push(full)
    }
  }
  for (const top of ['app', 'lib', 'components', 'hooks', 'stores', 'scripts', 'packages']) {
    try { walk(path.join(root, top)) } catch { /* optional directory */ }
  }
  return out
}

describe('public repo guard: core never imports extension code', () => {
  const files = coreFiles()

  it('scans core sources', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  it('has no import of a private extension package', () => {
    const offenders = files.filter((file) => {
      const src = readFileSync(file, 'utf8')
      return PRIVATE_SCOPES.some((scope) => new RegExp(`(from|import\\(|require\\()\\s*['"]${scope.replace('/', '\\/')}`).test(src))
    })
    expect(offenders.map((f) => path.relative(root, f))).toEqual([])
  })

  it('imports in-repo extensions only through the generated registry', () => {
    const extensionsDir = path.join(root, 'extensions') + path.sep
    // Docs pages hold code samples in Markdown strings, not imports.
    const docs = path.join(root, 'lib', 'docs', 'content') + path.sep
    const offenders = files.filter((file) => !file.startsWith(docs)).filter((file) => {
      for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)) {
        const spec = match[1]
        if (spec.startsWith('@/extensions/')) return true
        if (spec.startsWith('.') && path.resolve(path.dirname(file), spec).startsWith(extensionsDir)) return true
      }
      return false
    })
    expect(offenders.map((f) => path.relative(root, f))).toEqual([])
  })

  it('keeps extension sources on the SDK (no core imports)', () => {
    const dir = path.join(root, 'extensions')
    const offenders: string[] = []
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        const full = path.join(d, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(tsx?)$/.test(name) && /from\s*['"]@\/(?!extensions\/)/.test(readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full))
      }
    }
    walk(dir)
    expect(offenders).toEqual([])
  })
})
