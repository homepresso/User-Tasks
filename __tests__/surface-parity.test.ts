import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { createMcpServer } from '@/lib/mcp/server'
import { CRUD_OPS, renderParityMarkdown, SURFACE_PARITY } from '@/lib/surface-parity'
import { COMMAND_SPECS as COMMANDS } from '../packages/cli/src/generated/commands'

/**
 * REST / MCP / CLI parity. Every resource in lib/surface-parity.ts must have
 * list/get/create/update/delete (or a note saying why not) and every entry
 * must exist on the surface it names, so removing or renaming an endpoint,
 * tool or command without updating the matrix fails here.
 */

const ROOT = join(__dirname, '..')
const restOps = new Set(API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`))
const mcpTools = new Set(createMcpServer({ tenantId: 't1', supabase: {} }).getRegisteredTools().map((tool) => tool.name))
// Hand-written CLI commands (packages/cli/src/commands) alongside the generated table.
const HAND_WRITTEN_CLI = ['tasks complete', 'config export', 'config apply', 'config diff', 'config new', 'logs tail', 'logs export', 'packages add', 'packages remove', 'packages show', 'packages set-data', 'packages build', 'packages download', 'packages inspect', 'packages install', 'packages upgrade', 'packages complete', 'packages uninstall', 'packages installs', 'packages history']
const cliCommands = new Set([...COMMANDS.map((spec) => `${spec.resource} ${spec.verb}`), ...HAND_WRITTEN_CLI])

describe('surface parity matrix', () => {
  for (const resource of SURFACE_PARITY) {
    describe(resource.resource, () => {
      it('covers list/get/create/update/delete on every surface, or says why not', () => {
        for (const name of CRUD_OPS) {
          const entry = resource.ops.find((op) => op.op === name)
          expect(entry, `${resource.resource}: no ${name} entry`).toBeDefined()
          if (!entry!.rest || !entry!.mcp || !entry!.cli) expect(entry!.note, `${resource.resource} ${name}: missing surface without a note`).toBeTruthy()
          // A gap must be a gap everywhere (an operation REST has, MCP and CLI have too).
          const present = [entry!.rest, entry!.mcp, entry!.cli].filter(Boolean).length
          expect([0, 3], `${resource.resource} ${name}: offered on only some surfaces`).toContain(present)
        }
      })

      it('names REST endpoints, MCP tools and CLI commands that exist', () => {
        for (const entry of resource.ops) {
          if (entry.rest) expect(restOps.has(entry.rest), `REST ${entry.rest}`).toBe(true)
          if (entry.mcp) expect(mcpTools.has(entry.mcp), `MCP ${entry.mcp}`).toBe(true)
          if (entry.cli) expect(cliCommands.has(entry.cli), `CLI ${entry.cli}`).toBe(true)
        }
      })

      it('offers every extra operation on all three surfaces', () => {
        for (const entry of resource.ops.filter((op) => !(CRUD_OPS as readonly string[]).includes(op.op))) {
          expect([entry.rest, entry.mcp, entry.cli].every(Boolean), `${resource.resource} ${entry.op}`).toBe(true)
        }
      })
    })
  }

  it('maps each CLI command to the REST endpoint it calls', () => {
    const byCommand = new Map(COMMANDS.map((spec) => [`${spec.resource} ${spec.verb}`, `${spec.method} ${spec.path}`]))
    for (const resource of SURFACE_PARITY) {
      for (const entry of resource.ops) {
        if (entry.cli && entry.rest && byCommand.has(entry.cli)) expect(byCommand.get(entry.cli), entry.cli).toBe(entry.rest)
      }
    }
  })

  it('gives every update endpoint with a matching GET the round-trip body handling', () => {
    for (const endpoint of API_ENDPOINTS.filter((e) => (e.method === 'PATCH' || e.method === 'PUT') && e.body && e.path.endsWith('{id}'))) {
      const hasGet = API_ENDPOINTS.some((e) => e.method === 'GET' && e.path === endpoint.path)
      if (hasGet) expect(endpoint.roundTrip, `${endpoint.method} ${endpoint.path}`).toBeDefined()
    }
  })

  it('docs/parity.md is the rendered matrix (run `npm run openapi:gen`)', () => {
    expect(readFileSync(join(ROOT, 'docs', 'parity.md'), 'utf8')).toBe(renderParityMarkdown())
  })
})
