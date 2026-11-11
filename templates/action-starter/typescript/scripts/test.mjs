/**
 * npm test → compiles harness/run.ts (and the vendored @user-tasks/action
 * test runner) to .harness/run.mjs, then runs it against dist/action.js.
 * Arguments after `--` are passed through (a name filter, --verbose).
 */
import { spawnSync } from 'node:child_process'
import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['harness/run.ts'],
  outfile: '.harness/run.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // The sandbox itself: QuickJS compiled to WebAssembly, loaded from node_modules.
  external: ['quickjs-emscripten-core', '@jitl/quickjs-singlefile-cjs-release-sync'],
  logLevel: 'warning',
})
const run = spawnSync(process.execPath, ['.harness/run.mjs', ...process.argv.slice(2)], { stdio: 'inherit' })
process.exit(run.status ?? 1)
