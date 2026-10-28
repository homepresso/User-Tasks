/**
 * Build src/generated/commands.ts (the CLI resource command table) from the
 * `x-usertasks-cli` metadata in ../sdk/openapi.json.
 *
 * Usage: npm run generate [-- --check]   (--check exits 1 when stale)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCommandSpecs } from '../src/build-specs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(root, 'src/generated/commands.ts')
const doc = JSON.parse(readFileSync(resolve(root, '../sdk/openapi.json'), 'utf8'))

const content = `// Generated from packages/sdk/openapi.json by scripts/generate.ts. Do not edit.
import type { CommandSpec } from '../spec'

export const COMMAND_SPECS: readonly CommandSpec[] = ${JSON.stringify(buildCommandSpecs(doc), null, 2)}
`

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(outputPath, 'utf8')
  } catch {
    // Missing file counts as stale.
  }
  if (current !== content) {
    console.error('packages/cli/src/generated/commands.ts is stale. Run `npm run openapi:gen`.')
    process.exit(1)
  }
  console.log('CLI command table is up to date.')
} else {
  writeFileSync(outputPath, content)
  console.log(`Wrote ${outputPath}`)
}
