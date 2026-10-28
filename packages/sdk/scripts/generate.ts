/**
 * Derive the SDK's generated sources from openapi.json:
 *   - src/generated/schema.ts      openapi-typescript `paths` / `operations` types
 *   - src/generated/operations.ts  runtime table (method, path, envelope, listKey)
 *
 * Usage: npm run generate [-- --check]   (--check exits 1 when stale)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HEADER = '// Generated from openapi.json by scripts/generate.ts. Do not edit.\n'

interface Operation {
  operationId?: string
  'x-usertasks-envelope'?: boolean
  'x-usertasks-async'?: boolean
  'x-usertasks-download'?: boolean
  'x-usertasks-cli'?: { listKey?: string }
}

async function main() {
  const doc = JSON.parse(readFileSync(resolve(root, 'openapi.json'), 'utf8'))

  const ast = await openapiTS(doc, { alphabetize: false })
  const schema = `${HEADER}${astToString(ast)}`

  const operations = Object.entries(doc.paths as Record<string, Record<string, Operation>>).flatMap(([path, item]) =>
    Object.entries(item).map(([method, op]) => ({
      operationId: op.operationId ?? `${method} ${path}`,
      method: method.toUpperCase(),
      path,
      envelope: op['x-usertasks-envelope'] !== false,
      ...(op['x-usertasks-cli']?.listKey ? { listKey: op['x-usertasks-cli'].listKey } : {}),
      ...(op['x-usertasks-async'] ? { async: true } : {}),
      ...(op['x-usertasks-download'] ? { download: true } : {}),
    })),
  )
  const operationsSource = `${HEADER}
export interface OperationInfo {
  operationId: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Path template relative to /api/v1, e.g. \`/workflows/{id}\`. */
  path: string
  /** false = the route returns a bare JSON body (no \`{ success, data }\` envelope). */
  envelope: boolean
  /** Key within the response data holding the item array (list endpoints). */
  listKey?: string
  /** Has an async variant (\`Prefer: respond-async\` → 202 with a background job). */
  async?: boolean
  /** Returns a file, not JSON. */
  download?: boolean
}

export const OPERATIONS: readonly OperationInfo[] = ${JSON.stringify(operations, null, 2)}
`

  const outputs: [string, string][] = [
    [resolve(root, 'src/generated/schema.ts'), schema],
    [resolve(root, 'src/generated/operations.ts'), operationsSource],
  ]

  if (process.argv.includes('--check')) {
    const stale = outputs.filter(([file, content]) => {
      try {
        return readFileSync(file, 'utf8') !== content
      } catch {
        return true
      }
    })
    if (stale.length) {
      console.error(`Stale generated SDK sources: ${stale.map(([file]) => file).join(', ')}. Run \`npm run openapi:gen\`.`)
      process.exit(1)
    }
    console.log('SDK generated sources are up to date.')
    return
  }
  for (const [file, content] of outputs) {
    writeFileSync(file, content)
    console.log(`Wrote ${file}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
