import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import {
  CONTROL_CAPABILITIES,
  CONTROL_DISPLAY_FORMATS,
  CONTROL_PROP_TYPES,
  CONTROL_VALUE_TYPES,
  FORM_CONTROL_MANIFEST_VERSION,
  PACKAGE_LIMITS,
  RESERVED_ELEMENT_PROPERTIES,
  type FormControlManifest,
} from '@/lib/forms/custom-controls/contract'

const ROOT = process.cwd()
const STARTER = path.join(ROOT, 'templates/form-control-starter')
const ZIP = path.join(ROOT, 'public/downloads/form-control-starter.zip')
const VARIANTS = ['lit-ts', 'vanilla-js'] as const

/** The template tree as the zip should hold it (no installs or build output). */
function templateFiles(dir = STARTER, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix ? `${prefix}/${name}` : name
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return ['node_modules', 'dist', 'release'].includes(name) ? [] : templateFiles(full, rel)
    return ['.DS_Store', 'package-lock.json'].includes(name) ? [] : [rel]
  })
}

function manifestProblems(m: FormControlManifest): string[] {
  const problems: string[] = []
  if (m.manifest_version !== FORM_CONTROL_MANIFEST_VERSION) problems.push('manifest_version')
  if (!/^[a-z][a-z0-9._]*-[a-z0-9._-]*$/.test(m.tag)) problems.push('tag: lowercase with a hyphen')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(m.version)) problems.push('version: semver')
  if (!m.name) problems.push('name')
  if (!(CONTROL_VALUE_TYPES as readonly string[]).includes(m.value?.type)) problems.push(`value.type ${m.value?.type}`)
  if (!Array.isArray(m.props) || m.props.length > PACKAGE_LIMITS.props) problems.push('props')
  for (const prop of m.props ?? []) {
    if (!(CONTROL_PROP_TYPES as readonly string[]).includes(prop.type)) problems.push(`prop ${prop.name}: type ${prop.type}`)
    if (RESERVED_ELEMENT_PROPERTIES.has(prop.name)) problems.push(`prop ${prop.name}: reserved`)
    if (prop.type === 'select' && !(prop.options?.length)) problems.push(`prop ${prop.name}: options`)
    if (prop.type === 'select' && prop.default !== undefined && !prop.options?.some((o) => (typeof o === 'string' ? o : o.value) === prop.default)) problems.push(`prop ${prop.name}: default not an option`)
  }
  if (new Set((m.props ?? []).map((p) => p.name)).size !== (m.props ?? []).length) problems.push('duplicate prop names')
  for (const capability of m.capabilities ?? []) if (!(CONTROL_CAPABILITIES as readonly string[]).includes(capability)) problems.push(`capability ${capability}`)
  if (!Array.isArray(m.events) || !Array.isArray(m.context) || !Array.isArray(m.capabilities)) problems.push('events / context / capabilities arrays')
  if (typeof m.validation !== 'object' || typeof m.size !== 'object') problems.push('validation / size objects')
  if (m.display?.format && !(CONTROL_DISPLAY_FORMATS as readonly string[]).includes(m.display.format)) problems.push('display.format')
  if (Buffer.byteLength(JSON.stringify(m)) > PACKAGE_LIMITS.manifestBytes) problems.push('manifest too large')
  return problems
}

describe('form control starter kit', () => {
  it('public/downloads/form-control-starter.zip holds exactly the template (run npm run starter:build)', () => {
    const zip = new PizZip(readFileSync(ZIP))
    const entries = Object.values(zip.files).filter((file) => !file.dir)
    const expected = templateFiles().sort()
    expect(entries.map((file) => file.name.replace(/^form-control-starter\//, '')).sort()).toEqual(expected)
    for (const rel of expected) {
      const entry = zip.file(`form-control-starter/${rel}`)
      expect(entry, rel).not.toBeNull()
      expect(Buffer.from(entry!.asUint8Array()).equals(readFileSync(path.join(STARTER, rel))), `${rel} differs`).toBe(true)
    }
  })

  it('ships both variants with a manifest, a harness, a README and package scripts', () => {
    const files = new Set(templateFiles())
    for (const variant of VARIANTS) {
      for (const file of ['manifest.json', 'README.md', 'package.json', 'harness/index.html', 'harness/harness.js', 'scripts/package.mjs']) {
        expect(files.has(`${variant}/${file}`), `${variant}/${file}`).toBe(true)
      }
    }
    expect(files.has('lit-ts/src/ut-star-rating.ts')).toBe(true)
    expect(files.has('vanilla-js/ut-star-rating.js')).toBe(true)
    const lit = JSON.parse(readFileSync(path.join(STARTER, 'lit-ts/package.json'), 'utf8'))
    expect(Object.keys(lit.scripts)).toEqual(expect.arrayContaining(['dev', 'build', 'package']))
    expect(Object.keys(lit.devDependencies).sort()).toEqual(['esbuild', 'lit', 'typescript'])
    const vanilla = JSON.parse(readFileSync(path.join(STARTER, 'vanilla-js/package.json'), 'utf8'))
    expect(vanilla.dependencies ?? {}).toEqual({})
    expect(vanilla.devDependencies ?? {}).toEqual({})
  })

  it.each(VARIANTS)('%s/manifest.json follows the contract', (variant) => {
    const manifest = JSON.parse(readFileSync(path.join(STARTER, variant, 'manifest.json'), 'utf8')) as FormControlManifest
    expect(manifestProblems(manifest)).toEqual([])
    expect(manifest).toMatchObject({
      tag: 'ut-star-rating',
      version: '1.0.0',
      entry: 'ut-star-rating.js',
      value: { type: 'number', schema: { type: 'number', minimum: 0, maximum: 10 } },
      validation: { reports_validity: true },
      display: { template: '{{value}} of {{props.max}} stars' },
      accessibility: { role: 'radiogroup' },
    })
    expect(manifest.props.map((p) => [p.name, p.type])).toEqual([['max', 'number'], ['allow_clear', 'boolean'], ['size', 'select']])
    const pkg = JSON.parse(readFileSync(path.join(STARTER, variant, 'package.json'), 'utf8'))
    expect(pkg.version).toBe(manifest.version)
  })

  it('the two manifests describe the same control', () => {
    const [lit, vanilla] = VARIANTS.map((v) => JSON.parse(readFileSync(path.join(STARTER, v, 'manifest.json'), 'utf8')))
    delete lit.dependencies
    expect(lit).toEqual(vanilla)
  })

  it('the vanilla module defines the tag and dispatches the contract events', () => {
    const code = readFileSync(path.join(STARTER, 'vanilla-js/ut-star-rating.js'), 'utf8')
    expect(code).toMatch(/const TAG = 'ut-star-rating'/)
    expect(code).toMatch(/customElements\.define\(TAG,/)
    for (const event of ['ut-change', 'ut-blur', 'ut-validity', 'ut-resize']) expect(code).toContain(`'${event}'`)
    expect(code).toContain('bubbles: true, composed: true')
    // One self-contained module: no imports, no dynamic import(), no import.meta assets.
    expect(code).not.toMatch(/^\s*import[\s{*'"]/m)
    expect(code).not.toMatch(/\bimport\s*\(/)
    expect(code).not.toMatch(/import\.meta/)
    expect(Buffer.byteLength(code)).toBeLessThan(PACKAGE_LIMITS.moduleBytes)
  })

  it('the harness copies are identical and point at each variant module', () => {
    const lit = readFileSync(path.join(STARTER, 'lit-ts/harness/harness.js'), 'utf8')
    expect(readFileSync(path.join(STARTER, 'vanilla-js/harness/harness.js'), 'utf8')).toBe(lit)
    expect(readFileSync(path.join(STARTER, 'lit-ts/harness/index.html'), 'utf8')).toContain('content="../dist/ut-star-rating.js"')
    expect(readFileSync(path.join(STARTER, 'vanilla-js/harness/index.html'), 'utf8')).toContain('content="../ut-star-rating.js"')
    // The harness's reserved names and the upload checks match the contract.
    for (const variant of VARIANTS) {
      const checks = readFileSync(path.join(STARTER, variant, 'scripts/checks.mjs'), 'utf8')
      for (const name of RESERVED_ELEMENT_PROPERTIES) expect(checks, name).toContain(`'${name}'`)
      for (const name of RESERVED_ELEMENT_PROPERTIES) expect(lit, name).toContain(`'${name}'`)
    }
  })
})
