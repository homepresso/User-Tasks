/** `usertasks api <METHOD> <path>`: raw authenticated request, prints the response body. */

import type { Command } from 'commander'
import type { HttpMethod } from '@usertasks/sdk'
import { CliUsageError } from '../exit-codes'
import { buildBody, collect, parseQueryPairs } from '../input'
import type { Runtime } from '../runtime'

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/** `/api/v1/workflows?x=1` or `workflows` → `{ path: '/workflows', query }`. */
export function splitApiPath(input: string): { path: string; query: Record<string, string | string[]> } {
  const [rawPath, rawQuery = ''] = input.split('?', 2)
  let path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`
  path = path.replace(/^\/api\/v1(?=\/|$)/, '') || '/'
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of new URLSearchParams(rawQuery)) {
    const existing = query[key]
    query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value]
  }
  return { path, query }
}

export function registerApiCommand(program: Command, runtime: Runtime) {
  program
    .command('api <method> <path>')
    .description('Make an authenticated request to /api/v1 and print the raw JSON response')
    .option('-q, --query <key=value>', 'Query parameter (repeatable)', collect, [])
    .option('--set <assignment>', 'Set a body field (repeatable): key=value, key:=<json>, key=@file (text), key:=@file (JSON/YAML)', collect, [])
    .addHelpText('after', '\nExamples:\n  usertasks api GET /workflows -q active=false\n  usertasks api POST /decision-tables/<id>/test -f input.json')
    .action(async (method: string, rawPath: string, opts: { query: string[]; set: string[] }, self: Command) => {
      const verb = method.toUpperCase() as HttpMethod
      if (!METHODS.includes(verb)) throw new CliUsageError(`Unsupported method "${method}" (expected ${METHODS.join(', ')})`)
      const flags = runtime.flags(self)
      const { path, query } = splitApiPath(rawPath)
      Object.assign(query, parseQueryPairs(opts.query))
      if (flags.limit !== undefined) query.limit = flags.limit
      if (flags.offset !== undefined) query.offset = flags.offset
      const body = await buildBody(flags.file, opts.set, runtime.io.readStdin)

      if (verb === 'DELETE' && !(await runtime.confirm(self, `DELETE ${path}?`))) throw new Error('Aborted.')

      const response = await runtime.client(self).raw(verb, path, { query, ...(body !== undefined ? { body } : {}) })
      if (response.body === null) return
      // Raw bodies default to JSON; a table only when asked for explicitly.
      const explicit = flags.output ?? runtime.io.env.USERTASKS_OUTPUT
      if (explicit) runtime.print(self, response.body)
      else runtime.io.stdout.write(`${JSON.stringify(response.body, null, 2)}\n`)
    })
}
