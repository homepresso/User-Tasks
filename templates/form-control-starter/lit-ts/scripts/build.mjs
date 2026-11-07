/** npm run build → dist/<entry>: one minified ES module with Lit bundled in. */
import { readFileSync } from 'node:fs'
import * as esbuild from 'esbuild'
import { checkModule, readManifest } from './checks.mjs'
import { esbuildOptions } from './options.mjs'

const manifest = readManifest()
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (pkg.version !== manifest.version) {
  throw new Error(`package.json version ${pkg.version} and manifest.json version ${manifest.version} differ: bump both`)
}
const options = esbuildOptions(manifest)
const result = await esbuild.build(options)
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  if (output.imports.length) throw new Error(`${file} still imports ${output.imports.map((i) => i.path).join(', ')}: bundle everything`)
}
const bytes = checkModule(readFileSync(options.outfile, 'utf8'), manifest.tag)
console.log(`${options.outfile}  ${(bytes / 1024).toFixed(1)} KB  <${manifest.tag}> ${manifest.version}`)
