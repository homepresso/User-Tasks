// Bundles scripts/worker.ts into one CommonJS file for the Docker image, where the
// standalone server has no tsx and no TypeScript sources:
//
//   node scripts/build-worker.mjs [outfile]      (default .next/standalone/worker.cjs)
//
// App code (@/…, relative imports, the @usertasks/* workspace packages that
// ship as TypeScript) is bundled; a package stays external only when the
// standalone node_modules next to the output can load it, otherwise it is
// bundled too (scripts/standalone-externals.mjs).
import { build } from 'esbuild'
import path from 'node:path'
import { importMetaUrlShim, standaloneExternals } from './standalone-externals.mjs'

const outfile = process.argv[2] ?? '.next/standalone/worker.cjs'

await build({
  entryPoints: [path.resolve('scripts/worker.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  // CommonJS: externals such as next/server have no exports map, which ESM resolution would reject.
  format: 'cjs',
  target: 'node20',
  tsconfig: 'tsconfig.json',
  // next/* is bundled: the standalone copy of next holds only the server's traced files.
  plugins: [standaloneExternals(path.dirname(path.resolve(outfile)), { bundleAlways: ['next'] })],
  ...importMetaUrlShim,
  logLevel: 'warning',
})
console.log(`worker bundled to ${outfile}`)
