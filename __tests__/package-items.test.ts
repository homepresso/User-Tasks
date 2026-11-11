/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import { describeDependents, dependentsOf, itemDependencyGraph, itemKey, removeFromLists, versionChanges, versionItemRefs } from '@/lib/packages/items'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { createMcpServer } from '@/lib/mcp/server'
import { requiredToolPermission } from '@/lib/mcp/authz'
import { packageItemsTool } from '@/lib/assistants/tools/solution-package'

const W = '00000000-0000-4000-8000-00000000000a'
const F = '00000000-0000-4000-8000-00000000000b'
const T = '00000000-0000-4000-8000-00000000000c'
const I = '00000000-0000-4000-8000-00000000000d'
const R = '00000000-0000-4000-8000-00000000000e'
const C = '00000000-0000-4000-8000-00000000000f'
const A = '00000000-0000-4000-8000-000000000010'
const GI = '00000000-0000-4000-8000-000000000011'
const GR = '00000000-0000-4000-8000-000000000012'

const assets = {
  workflows: [{
    id: W, name: 'Approve',
    nodes: [
      { id: 'n1', config: { form_id: F } },
      { id: 'n2', config: { table_id: T } },
      { id: 'n3', config: { reference_id: R } },
      { id: 'n4', config: { custom_activity_key: 'acme.scan' } },
      { id: 'n5', config: { reference_id: GR } },
    ],
  }],
  forms: [{ id: F, name: 'Request', fields: [] }],
  data_tables: [{ id: T, name: 'Requests' }],
  integrations: [{ id: I, name: 'CRM' }],
  references: [{ id: R, integration_id: I, name: 'Lookup' }],
  connectors: [{ id: C, display_name: 'Slack', generated_integration_id: GI, generated_references: [{ id: GR }] }],
  workflow_activities: [{ id: A, key: 'acme.scan', name: 'Scan' }],
}

describe('package item graph', () => {
  const graph = itemDependencyGraph(assets)

  it('finds direct uses: forms, tables, integrations through references, connectors, custom steps by key', () => {
    expect([...graph.uses.get(`workflow:${W}`)!].sort()).toEqual([`connector:${C}`, `data_table:${T}`, `form:${F}`, `integration:${I}`, `workflow_activity:${A}`].sort())
    expect([...graph.usedBy.get(`form:${F}`)!]).toEqual([`workflow:${W}`])
  })

  it('names what still uses an item being removed', () => {
    const inPackage = new Map([
      [`workflow:${W}`, { type: 'workflow', id: W, name: 'Approve', label: 'Workflow' }],
      [`form:${F}`, { type: 'form', id: F, name: 'Request', label: 'Form' }],
      [`data_table:${T}`, { type: 'data_table', id: T, name: 'Requests', label: 'Data table' }],
    ])
    const dependents = dependentsOf(graph, [{ type: 'form', id: F }], inPackage)
    expect(dependents).toHaveLength(1)
    expect(describeDependents(dependents)).toEqual(['Workflow “Approve” uses form “Request”'])
    // Removing the user too: nothing is left that uses it.
    expect(dependentsOf(graph, [{ type: 'form', id: F }, { type: 'workflow', id: W }], inPackage)).toEqual([])
  })
})

describe('package item lists', () => {
  const lists = { roots: [{ type: 'workflow', id: W }], items: [{ type: 'report', id: R }], excluded: [] }

  it('drops removed items and leaves out the ones something still pulls in', () => {
    const next = removeFromLists(lists, [{ type: 'report', id: R }, { type: 'form', id: F }], new Set([`form:${F}`]))
    expect(next).toEqual({ roots: [{ type: 'workflow', id: W }], items: [], excluded: [{ type: 'form', id: F }] })
  })

  it('promotes added items to roots when the last root goes', () => {
    expect(removeFromLists(lists, [{ type: 'workflow', id: W }], new Set()).roots).toEqual([{ type: 'report', id: R }])
  })

  it('compares the package with the last built version', () => {
    const built = versionItemRefs({ workflows: [{ id: W, name: 'Approve' }], forms: [{ id: F, name: 'Request' }] })
    expect(built.map(itemKey)).toEqual([`form:${F}`, `workflow:${W}`])
    const changes = versionChanges([{ type: 'workflow', id: W, name: 'Approve' }, { type: 'data_table', id: T, name: 'Requests' }], built)
    expect(changes.added.map((a) => a.id)).toEqual([T])
    expect(changes.removed.map((a) => a.id)).toEqual([F])
  })
})

describe('package item surfaces (REST ↔ MCP parity)', () => {
  const rest = new Map(API_ENDPOINTS.map((e) => [`${e.method} ${e.path}`, e]))
  const tools = new Set(createMcpServer({ tenantId: 't1', supabase: {} }).getRegisteredTools().map((t) => t.name))
  const pairs: Array<[string, string, string]> = [
    ['GET /packages/{id}/items', 'packages_items_list', 'packages.view'],
    ['POST /packages/{id}/items', 'packages_items_add', 'packages.manage'],
    ['POST /packages/{id}/items/remove', 'packages_items_remove', 'packages.manage'],
    ['POST /package-installs/{id}/detach', 'packages_install_detach', 'packages.install'],
    ['POST /package-installs/{id}/adopt', 'packages_install_adopt', 'packages.install'],
  ]
  for (const [op, tool, permission] of pairs) {
    it(`${op} ↔ ${tool} (${permission})`, () => {
      expect(rest.get(op)?.permission).toBe(permission)
      expect(tools.has(tool)).toBe(true)
      expect(requiredToolPermission(tool)).toBe(permission)
    })
  }
  it('build takes update_install on both surfaces', () => {
    const build = rest.get('POST /packages/{id}/versions')!
    expect(Object.keys((build.body as any).shape)).toContain('update_install')
  })
})

describe('Agent package_items tool', () => {
  const P = '00000000-0000-4000-8000-0000000000aa'
  const make = (install = true) => {
    const calls: Array<[string, any]> = []
    const call = async (name: string, args: any): Promise<any> => {
      calls.push([name, args])
      if (name === 'packages_list') return { packages: [{ id: P, name: 'Purchase requests', slug: 'purchase-requests', latest_version: '1.0.0' }] }
      if (name === 'packages_items_add') return args.dry_run
        ? { adding: [{ type: 'workflow', id: W, name: 'Expense', label: 'Workflow' }], dependencies: [{ type: 'form', id: F, name: 'Expense form', label: 'Form' }] }
        : { dependencies_added: 1 }
      if (name === 'packages_items_remove') return args.dry_run
        ? { removing: [{ type: 'form', id: F, name: 'Request', label: 'Form' }], warnings: ['Workflow “Approve” uses form “Request”'] }
        : { removing: [] }
      if (name === 'packages_build') return { version: { version: '1.1.0' }, install_sync: { status: 'upgraded', note: 'The install here is now 1.1.0' } }
      return { error: `unexpected ${name}` }
    }
    return { calls, tool: packageItemsTool({ call, access: { manage: true, install, share: false } }) }
  }
  const args = { package: 'Purchase requests', add: [{ kind: 'workflow', id: W }], remove: [{ kind: 'form', id: F }] }

  it('shows the dependencies an add brings and what still uses a removed item on the card', async () => {
    const { tool } = make()
    const card = await tool.confirm!(args)
    expect(card.lines.join('\n')).toMatch(/Adds: workflow “Expense”/)
    expect(card.lines.join('\n')).toMatch(/With what they use: form “Expense form”/)
    expect(card.warnings?.join('\n')).toMatch(/Workflow “Approve” uses form “Request” — confirming removes it anyway/)
    expect(card.confirm_label).toBe('Remove anyway')
  })

  it('applies the change, then builds the next minor version and updates the install here', async () => {
    const { tool, calls } = make()
    const out = await tool.run(args, { emit: () => {}, toolCallId: 't' } as any)
    expect(out.ok).not.toBe(false)
    const writes = calls.filter(([name, a]) => name !== 'packages_list' && !a.dry_run)
    expect(writes.map(([n]) => n)).toEqual(['packages_items_add', 'packages_items_remove', 'packages_build'])
    expect(writes[1][1].force).toBe(true)
    expect(writes[2][1]).toMatchObject({ bump: 'minor', update_install: true })
  })

  it('refuses without the Manage packages permission', async () => {
    const tool = packageItemsTool({ call: async () => ({}), access: { manage: false, install: false, share: false } })
    await expect(tool.confirm!(args)).rejects.toThrow(/packages\.manage/)
  })
})
