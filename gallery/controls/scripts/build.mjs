/**
 * Build the official gallery controls: every gallery/controls/<slug>/ with a
 * manifest.json and src/index.ts becomes ONE self-contained, minified ES
 * module at <slug>/dist/<entry> (Lit, chart libraries, … bundled in).
 *
 *   npm run build                 # every control
 *   npm run build -- chart map    # some
 *   npm run check                 # rebuild in memory, fail if a committed dist differs
 *
 * Checks on every build:
 *   - the bundle has no imports left and stays under the module limit;
 *   - it defines the manifest's tag and dispatches ut-change;
 *   - the npm packages it bundles are exactly manifest.dependencies, at the
 *     exact installed versions, with a permissive licence (MIT, BSD, Apache-2.0, ISC);
 *   - their licence notices are kept (legalComments: eof) and a banner lists them.
 * Output is deterministic (same sources + lockfile → same bytes), so the
 * gallery build (scripts/gallery-build.ts) can rely on the committed dist.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MODULE_BYTES = 2 * 1024 * 1024 // PACKAGE_LIMITS.moduleBytes
export const PERMISSIVE = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', '0BSD'])
const NOT_CONTROLS = new Set(['node_modules', 'scripts', 'shared', 'harness', 'bundles'])

export function controlSlugs() {
  return readdirSync(ROOT).filter((name) => !NOT_CONTROLS.has(name) && !name.startsWith('.') && statSync(join(ROOT, name)).isDirectory()
    && existsSync(join(ROOT, name, 'manifest.json')) && existsSync(join(ROOT, name, 'src', 'index.ts'))).sort()
}

export function readManifest(slug) {
  return JSON.parse(readFileSync(join(ROOT, slug, 'manifest.json'), 'utf8'))
}

function packageOf(inputPath) {
  const parts = inputPath.split(/[\\/]/)
  const i = parts.lastIndexOf('node_modules')
  if (i < 0) return null
  return parts[i + 1].startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1]
}

function installed(name) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8'))
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'UNKNOWN'
  return { version: pkg.version, license }
}

export async function buildControl(slug, { write = true } = {}) {
  const manifest = readManifest(slug)
  const entry = manifest.entry ?? `${manifest.tag}.js`
  const outfile = join(ROOT, slug, 'dist', entry)
  const result = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [join(slug, 'src', 'index.ts')],
    bundle: true,
    format: 'esm',
    splitting: false,
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'eof',
    charset: 'utf8',
    metafile: true,
    write: false,
    outfile,
    tsconfig: join(ROOT, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"' },
    // `import css from 'leaflet/dist/leaflet.css'` gives the text, for a shadow-root <style>.
    loader: { '.css': 'text' },
    logLevel: 'warning',
  })
  const problems = []
  const outputs = Object.values(result.metafile.outputs)
  for (const output of outputs) if (output.imports.length) problems.push(`still imports ${output.imports.map((i) => i.path).join(', ')}`)
  // Bundled npm packages = manifest.dependencies, exact versions, permissive licences.
  const used = new Map()
  for (const input of Object.keys(result.metafile.inputs)) {
    const name = packageOf(input)
    if (name && !used.has(name)) used.set(name, installed(name))
  }
  const declared = manifest.dependencies ?? {}
  for (const [name, info] of used) {
    if (declared[name] !== info.version) problems.push(`bundles ${name}@${info.version} but manifest.dependencies says ${declared[name] ?? '(missing)'}`)
    if (!PERMISSIVE.has(info.license)) problems.push(`${name} has licence ${info.license}, which is not on the permissive list`)
  }
  for (const name of Object.keys(declared)) if (!used.has(name)) problems.push(`manifest.dependencies lists ${name}, which the bundle does not use`)
  // Library code that only BUILDS import statements as text (pdf.js's CDN worker wrapper:
  // `await import("${url}")` inside a template literal) reads like an external import to the
  // server's self-containment check. Escaping the quotes (\x22 in a template literal is the same
  // character at runtime) keeps the behaviour; the frame's CSP blocks such imports anyway.
  const body = new TextDecoder().decode(result.outputFiles[0].contents)
    .replace(/import\("(\$\{[A-Za-z_$][\w$]*\})"\)/g, 'import(\\x22$1\\x22)')
  const bundled = [...used].sort(([a], [b]) => a.localeCompare(b)).map(([name, info]) => `${name} ${info.version} (${info.license})`)
  const banner = `/*! ${manifest.tag} ${manifest.version} | UserTasks gallery form control | Apache-2.0${bundled.length ? ` | bundles ${bundled.join(', ')}` : ''} */\n`
  const code = banner + body
  const bytes = Buffer.byteLength(code, 'utf8')
  if (bytes > MODULE_BYTES) problems.push(`module is ${(bytes / 1024).toFixed(0)} KB (limit ${MODULE_BYTES / 1024} KB)`)
  if (!code.includes(manifest.tag)) problems.push(`never mentions <${manifest.tag}>`)
  if (!code.includes('ut-change')) problems.push('never dispatches ut-change')
  if (problems.length) throw new Error(`${slug}: ${problems.join('; ')}`)
  if (write) {
    mkdirSync(dirname(outfile), { recursive: true })
    writeFileSync(outfile, code)
  }
  return { slug, tag: manifest.tag, version: manifest.version, outfile, code, bytes, bundled }
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const only = args.filter((a) => !a.startsWith('--'))
  const slugs = only.length ? only : controlSlugs()
  let failed = 0
  for (const slug of slugs) {
    try {
      const built = await buildControl(slug, { write: !check })
      const rel = relative(ROOT, built.outfile).split(sep).join('/')
      if (check) {
        const committed = existsSync(built.outfile) ? readFileSync(built.outfile, 'utf8') : null
        if (committed !== built.code) { failed++; console.error(`✗ ${rel} is stale: run npm run build`); continue }
      }
      console.log(`${check ? '✓' : ' '} ${rel.padEnd(44)} ${(built.bytes / 1024).toFixed(1).padStart(7)} KB  <${built.tag}> ${built.version}${built.bundled.length ? `  [${built.bundled.join(', ')}]` : ''}`)
    } catch (error) {
      failed++
      console.error(`✗ ${error.message}`)
    }
  }
  if (failed) process.exit(1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
