/**
 * npm run build → dist/action.js: one ES module with every dependency
 * bundled in (src/action.ts, or src/action.js in the JavaScript kit).
 */
import { existsSync, readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'
import { checkModule, readManifest } from './checks.mjs'

const manifest = readManifest()
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.version !== manifest.version) {
  throw new Error(`package.json version ${pkg.version} and manifest.json version ${manifest.version} differ: bump both`)
}
const outfile = manifest.entry ?? 'dist/action.js'
const result = await esbuild.build({
  entryPoints: [existsSync('src/action.ts') ? 'src/action.ts' : 'src/action.js'],
  outfile,
  bundle: true, // npm dependencies are inlined: the sandbox cannot load other files
  format: 'esm',
  splitting: false,
  platform: 'neutral', // no Node or browser built-ins exist in the sandbox
  target: 'es2020',
  // Readable code (stack traces and run logs point at real names); syntax-only
  // minification folds constants so unused library code is tree-shaken away.
  minifySyntax: true,
  banner: { js: `/* ${manifest.key} ${manifest.version} — ${manifest.name}. A UserTasks custom workflow action (built with the action starter kit). */` },
  legalComments: 'eof',
  metafile: true,
  logLevel: 'warning',
})
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  if (output.imports.length) throw new Error(`${file} still imports ${output.imports.map((i) => i.path).join(', ')}: bundle everything`)
}
const bytes = checkModule(readFileSync(outfile, 'utf8'), manifest)
console.log(`${outfile}  ${(bytes / 1024).toFixed(1)} KB  ${manifest.key} ${manifest.version}  (${manifest.operations.map((op) => op.id).join(', ')})`)
