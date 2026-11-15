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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateExtensionRegistry, parseExtensionList, renderClientRegistry, renderExtensionStyles, renderPagesRegistry, renderServerRegistry, watchLinkedExtensions, LINKED_DIR, PRIVATE_SCOPES } from '@/lib/extensions/build/codegen'

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

describe('extension styles (Tailwind sources)', () => {
  it('commits an empty extensions.css imported by the global stylesheet', () => {
    const css = readFileSync(path.join(root, 'lib/extensions/generated/extensions.css'), 'utf8')
    expect(css).not.toContain('@source')
    expect(readFileSync(path.join(root, 'app/globals.css'), 'utf8')).toContain('@import "../lib/extensions/generated/extensions.css";')
  })

  it('lists in-repo and installed extension directories as @source, relative to the generated directory', () => {
    const result = generateExtensionRegistry({ root, extensions: './extensions/example-hello', write: false })
    const css = result.files.find((f) => f.path.endsWith('extensions.css'))!
    expect(css.content).toContain('@source "../../../extensions/example-hello";')
    expect(renderExtensionStyles([{ spec: '@usertasks-ext/demo', id: 'demo', version: '1.0.0', manifest: 'x', server: null, pages: null, packageName: '@usertasks-ext/demo', dir: path.join(root, 'node_modules/@usertasks-ext/demo') }], root))
      .toContain('@source "../../../node_modules/@usertasks-ext/demo";')
  })
})

describe('linked extension packages (npm link)', () => {
  function fixture() {
    const project = mkdtempSync(path.join(tmpdir(), 'ext-project-'))
    const linked = mkdtempSync(path.join(tmpdir(), 'ext-linked-'))
    writeFileSync(path.join(linked, 'package.json'), JSON.stringify({ name: '@usertasks-ext/demo', version: '1.0.0' }))
    writeFileSync(path.join(linked, 'usertasks-extension.json'), JSON.stringify({ id: 'demo', version: '1.0.0', engines: { usertasks: '>=0.1.0' } }))
    writeFileSync(path.join(linked, 'manifest.ts'), 'export default {}')
    writeFileSync(path.join(linked, 'pages.tsx'), 'export default {}')
    mkdirSync(path.join(linked, 'src'))
    writeFileSync(path.join(linked, 'src', 'ui.tsx'), 'export const x = <div className="grid-cols-7" />')
    for (const skipped of ['.git', 'node_modules']) { mkdirSync(path.join(linked, skipped)); writeFileSync(path.join(linked, skipped, 'f'), 'x') }
    mkdirSync(path.join(project, 'node_modules', '@usertasks-ext'), { recursive: true })
    symlinkSync(linked, path.join(project, 'node_modules', '@usertasks-ext', 'demo'), 'dir')
    return { project, linked, cleanup: () => { rmSync(project, { recursive: true, force: true }); rmSync(linked, { recursive: true, force: true }) } }
  }

  it('mirrors a linked package into the project and imports the mirror (no transpilePackages)', () => {
    const { project, cleanup } = fixture()
    try {
      const result = generateExtensionRegistry({ root: project, extensions: '@usertasks-ext/demo', platformVersion: '0.1.0' })
      expect(result.extensions[0]).toMatchObject({ id: 'demo', manifest: `@/${LINKED_DIR}/demo/manifest`, pages: `@/${LINKED_DIR}/demo/pages`, packageName: null })
      expect(result.transpilePackages).toEqual([])
      const mirror = path.join(project, LINKED_DIR, 'demo')
      expect(readFileSync(path.join(mirror, 'src', 'ui.tsx'), 'utf8')).toContain('grid-cols-7')
      expect(existsSync(path.join(mirror, '.git'))).toBe(false)
      expect(existsSync(path.join(mirror, 'node_modules'))).toBe(false)
      expect(readFileSync(path.join(project, 'lib/extensions/generated/registry.client.ts'), 'utf8')).toContain(`import m0 from '@/${LINKED_DIR}/demo/manifest'`)
      expect(readFileSync(path.join(project, 'lib/extensions/generated/extensions.css'), 'utf8')).toContain(`@source "../../../${LINKED_DIR}/demo";`)
      // Regenerating without it removes the mirror (private code does not linger in the checkout).
      generateExtensionRegistry({ root: project, extensions: '', platformVersion: '0.1.0' })
      expect(existsSync(mirror)).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('does not mirror in check mode, and keeps the mirror in sync while watching', async () => {
    const { project, linked, cleanup } = fixture()
    try {
      generateExtensionRegistry({ root: project, extensions: '@usertasks-ext/demo', platformVersion: '0.1.0', write: false })
      expect(existsSync(path.join(project, LINKED_DIR))).toBe(false)
      const result = generateExtensionRegistry({ root: project, extensions: '@usertasks-ext/demo', platformVersion: '0.1.0' })
      const watchers = watchLinkedExtensions(result)
      try {
        writeFileSync(path.join(linked, 'src', 'ui.tsx'), 'export const x = <div className="grid-cols-9" />')
        const target = path.join(project, LINKED_DIR, 'demo', 'src', 'ui.tsx')
        for (let i = 0; i < 50 && !readFileSync(target, 'utf8').includes('grid-cols-9'); i++) await new Promise((r) => setTimeout(r, 50))
        expect(readFileSync(target, 'utf8')).toContain('grid-cols-9')
      } finally {
        for (const w of watchers) w.close()
      }
    } finally {
      cleanup()
    }
  })

  it('imports an installed (real) package in place', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'ext-project-'))
    try {
      const dir = path.join(project, 'node_modules', '@usertasks-ext', 'demo')
      mkdirSync(dir, { recursive: true })
      writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@usertasks-ext/demo', version: '1.0.0' }))
      writeFileSync(path.join(dir, 'usertasks-extension.json'), JSON.stringify({ id: 'demo', version: '1.0.0', engines: { usertasks: '>=0.1.0' } }))
      writeFileSync(path.join(dir, 'manifest.ts'), 'export default {}')
      const result = generateExtensionRegistry({ root: project, extensions: '@usertasks-ext/demo', platformVersion: '0.1.0', write: false })
      expect(result.extensions[0]).toMatchObject({ manifest: '@usertasks-ext/demo/manifest', packageName: '@usertasks-ext/demo' })
      expect(result.extensions[0].linkedFrom).toBeUndefined()
      expect(result.transpilePackages).toEqual(['@usertasks-ext/demo'])
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
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
