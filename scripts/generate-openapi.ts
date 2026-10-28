/**
 * Generate packages/sdk/openapi.json and the API explorer's endpoint groups
 * (lib/api-schemas/explorer.generated.json) from the /api/v1 endpoint
 * registry, and docs/parity.md (REST / MCP / CLI matrix) from
 * lib/surface-parity.ts.
 *
 * openapi.json is the only checked-in copy of the document; GET
 * /api/v1/openapi.json serves the same serialisation built from the registry
 * at build time. The SDK types and the CLI command table are derived from the
 * file by the packages' own `generate` scripts (run by `npm run openapi:gen`).
 *
 * Usage:
 *   npm run openapi:gen     # write openapi.json + parity.md, regenerate SDK types / CLI commands
 *   npm run openapi:check   # exit 1 if any checked-in artefact is stale
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serializeOpenApiDocument } from '../lib/api-schemas/openapi'
import { API_ENDPOINTS } from '../lib/api-schemas'
import { buildExplorerGroups, ODATA_EXPLORER_GROUP } from '../lib/api-schemas/explorer'
import { renderParityMarkdown } from '../lib/surface-parity'

const root = resolve(__dirname, '..')
const outputs = [
  { label: 'packages/sdk/openapi.json', path: resolve(root, 'packages', 'sdk', 'openapi.json'), content: serializeOpenApiDocument() },
  { label: 'docs/parity.md', path: resolve(root, 'docs', 'parity.md'), content: renderParityMarkdown() },
  // The API explorers render from this JSON so the browser never loads the
  // zod endpoint registry.
  {
    label: 'lib/api-schemas/explorer.generated.json',
    path: resolve(root, 'lib', 'api-schemas', 'explorer.generated.json'),
    content: JSON.stringify([...buildExplorerGroups(API_ENDPOINTS), ODATA_EXPLORER_GROUP], null, 1) + '\n',
  },
]

if (process.argv.includes('--check')) {
  let stale = false
  for (const output of outputs) {
    let current = ''
    try {
      current = readFileSync(output.path, 'utf8')
    } catch {
      // Missing file counts as stale.
    }
    if (current !== output.content) {
      console.error(`${output.label} is out of date. Run \`npm run openapi:gen\` and commit the result.`)
      stale = true
    } else {
      console.log(`${output.label} is up to date.`)
    }
  }
  if (stale) process.exit(1)
} else {
  for (const output of outputs) {
    writeFileSync(output.path, output.content)
    console.log(`Wrote ${output.path}`)
  }
}
