import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describePlannedOp, dryRunTableChanges, normalizeTableChanges, planTableChanges, summarizeTableChanges, tableChangesProblem, TABLE_CHANGES_LIMITS,
  type TableChangesConfig,
} from '@/lib/forms/table-changes'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import type { DataTableChangeSet } from '@/lib/forms/data-table'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001'
const ACTOR = 'aaaaaaaa-0000-4000-8000-000000000002'
const TABLE = 'aaaaaaaa-0000-4000-8000-000000000003'
const WF = 'aaaaaaaa-0000-4000-8000-000000000004'
const now = new Date('2026-10-31T12:00:00Z')

const CHANGES: DataTableChangeSet = {
  added: [{ vendor_id: 'V-9', name: 'Nine', payment_terms: 15 }],
  updated: [
    { key: 'V-1', before: { vendor_id: 'V-1', name: 'One', payment_terms: 30 }, after: { payment_terms: 45 }, changed_fields: ['payment_terms'] },
    { key: 'V-2', before: { vendor_id: 'V-2', name: 'Two', payment_terms: 60 }, after: { name: 'Deux' }, changed_fields: ['name'] },
  ],
  deleted: [{ key: 'V-3', before: { vendor_id: 'V-3', name: 'Three', payment_terms: 7 } }],
}

const rule = (over: Partial<TableChangesConfig> = {}): TableChangesConfig => normalizeTableChanges({
  field: 'vendors', target: 'table', table_id: TABLE, operation: 'auto', match_column: 'vendor_id',
  mapping: { vendor_id: '{{row.vendor_id}}', name: '{{row.name}}', payment_terms: '{{row.payment_terms}}', note: 'by {{user.email}} on {{today}} from {{form.reason}}' },
  ...over,
})

describe('planning ("for each changed row")', () => {
  const scope = { values: { reason: 'Q4 review' }, user: { email: 'ada@x.test' }, now }

  it('deletes, then updates, then inserts by default; row templates keep their types', () => {
    const plan = planTableChanges(rule(), CHANGES, scope)
    expect(plan.ops.map((o) => `${o.action}:${o.key}`)).toEqual(['delete:V-3', 'update:V-1', 'update:V-2', 'insert:'])
    expect(plan.ops[1]).toEqual({
      kind: 'updated', key: 'V-1', action: 'update', match: { column: 'vendor_id', value: 'V-1' },
      data: { vendor_id: 'V-1', name: 'One', payment_terms: 45, note: 'by ada@x.test on 2026-10-31 from Q4 review' },
    })
    expect(plan.ops[0].data).toBeUndefined()
    expect(plan.ops[3].data?.payment_terms).toBe(15)
  })

  it('inserts first when asked; kinds and a where filter skip rows', () => {
    expect(planTableChanges(rule({ order: 'inserts_first' }), CHANGES, scope).ops.map((o) => o.kind)).toEqual(['added', 'updated', 'updated', 'deleted'])
    const plan = planTableChanges(rule({ kinds: ['updated'], where: { column: 'payment_terms', operator: 'lt', value: '50' } }), CHANGES, scope, { payment_terms: 'number' })
    expect(plan.ops.map((o) => o.key)).toEqual(['V-1'])
    expect(plan.skipped).toBe(3)
  })

  it('upsert / fixed operations, API calls per row, and a workflow once with the whole change set', () => {
    expect(planTableChanges(rule({ operation: 'upsert' }), CHANGES, scope).ops.every((o) => o.action === 'upsert')).toBe(true)
    const api = planTableChanges(normalizeTableChanges({ field: 'vendors', target: 'reference', reference_id: 'r1', inputs: { vendor_id: '{{key}}', change: '{{change}}', fields: '{{changed_fields}}' } }), CHANGES, scope)
    expect(api.ops[1]).toMatchObject({ action: 'call', key: 'V-1', data: { vendor_id: 'V-1', change: 'updated', fields: ['payment_terms'] } })
    const once = planTableChanges(normalizeTableChanges({ field: 'vendors', target: 'workflow', workflow_id: WF, per: 'once', inputs: { changes: '{{changes}}', who: '{{user.email}}' } }), CHANGES, scope)
    expect(once.ops).toHaveLength(1)
    expect(once.ops[0].data).toEqual({ changes: CHANGES, who: 'ada@x.test' })
  })

  it('caps the rows one run processes', () => {
    const many: DataTableChangeSet = { added: Array.from({ length: TABLE_CHANGES_LIMITS.maxOpsPerRun + 5 }, (_, i) => ({ name: `r${i}` })), updated: [], deleted: [] }
    const plan = planTableChanges(rule(), many, scope)
    expect(plan.ops).toHaveLength(TABLE_CHANGES_LIMITS.maxOpsPerRun)
    expect(plan.over_cap).toBe(true)
  })

  it('designer problems and the dry run', () => {
    const editable = new Set(['vendors'])
    expect(tableChangesProblem(rule({ field: 'other' }), editable)).toMatch(/not an editable Data table/)
    expect(tableChangesProblem(rule({ match_column: undefined }), editable)).toMatch(/matched on/)
    expect(tableChangesProblem(rule({ mapping: undefined }), editable)).toMatch(/map at least one column/)
    expect(tableChangesProblem(rule({ operation: 'delete', mapping: undefined }), editable)).toBeNull()
    expect(tableChangesProblem(normalizeTableChanges({ field: 'vendors', target: 'reference' }), editable)).toMatch(/API reference/)
    const { summary, plan } = dryRunTableChanges(rule(), CHANGES, scope)
    expect(summary.text).toBe('Preview: 1 row deleted, 2 rows updated, 1 row added')
    expect(describePlannedOp(plan.ops[1], rule())).toContain('row V-1: update where vendor_id = V-1')
  })

  it('summaries count successes, failures and rows not attempted', () => {
    const s = summarizeTableChanges(rule(), [
      { kind: 'updated', key: 'a', action: 'update', status: 'ok' }, { kind: 'updated', key: 'b', action: 'update', status: 'ok' },
      { kind: 'updated', key: 'c', action: 'update', status: 'ok' }, { kind: 'deleted', key: 'd', action: 'delete', status: 'failed', error: 'x' },
      { kind: 'added', key: '', action: 'insert', status: 'skipped' },
    ], { stopped: true })
    expect(s.text).toBe('3 rows updated, 1 failed, 1 not attempted')
    expect(s).toMatchObject({ succeeded: 3, failed: 1, skipped: 1, by_kind: { added: 0, updated: 3, deleted: 0 } })
  })
})

/* ── The executor (server) with fakes ───────────────────────────────── */

type Row = Record<string, any>
let runs: Row[]
let targetRows: Array<{ id: string; tenant_id: string; table_id: string; data: Row }>
let calls: { upsert: any[]; update: any[]; del: any[]; ref: any[]; wf: any[] }

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let insertRow: Row | null = null
      let updatePatch: Row | null = null
      const api: any = {
        select() { return api },
        eq(f: string, v: unknown) { filters.push([f, v]); return api },
        in() { return api },
        limit() { return api },
        insert(row: Row) { insertRow = row; return api },
        update(patch: Row) { updatePatch = patch; return api },
        single() { return api },
        maybeSingle() { return api },
        then(resolve: (v: unknown) => unknown) {
          const match = (r: Row) => filters.every(([f, v]) => (f.startsWith('data->>') ? String(r.data?.[f.slice(7)]) === String(v) : String(r[f]) === String(v)))
          if (table === 'form_table_change_runs') {
            if (insertRow) {
              if (runs.some((r) => r.tenant_id === insertRow!.tenant_id && r.idempotency_key === insertRow!.idempotency_key)) return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve)
              const row = { id: `run-${runs.length + 1}`, status: 'running', summary: {}, ...insertRow }
              runs.push(row)
              return Promise.resolve({ data: row, error: null }).then(resolve)
            }
            if (updatePatch) { for (const r of runs.filter(match)) Object.assign(r, updatePatch); return Promise.resolve({ data: null, error: null }).then(resolve) }
            return Promise.resolve({ data: runs.find(match) ?? null, error: null }).then(resolve)
          }
          if (table === 'custom_table_rows') return Promise.resolve({ data: targetRows.filter(match).map((r) => ({ id: r.id })), error: null }).then(resolve)
          if (table === 'users') return Promise.resolve({ data: { id: ACTOR, email: 'ada@x.test', display_name: 'Ada' }, error: null }).then(resolve)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

let db: ReturnType<typeof fakeDb>
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db, audit: async () => undefined }))

const { runTableChanges, tableChangesDeps } = await import('@/lib/services/form-table-changes')

const FIELDS = normalizeTaskFields([
  { key: 'reason', label: 'Reason', type: 'text' },
  { key: 'vendors', label: 'Vendors', type: 'data_table', data_table: { source: 'table', table_id: TABLE, mode: 'edit', key_column: 'vendor_id', allow_add: true, allow_delete: true, columns: [{ key: 'vendor_id', label: 'Vendor', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'payment_terms', label: 'Terms', type: 'number' }] } },
])

const ctx = (perms: string[] = ['data.manage_rows', 'forms.submit']): ServiceContext => ({ supabase: db as any, tenantId: TENANT, actorId: ACTOR, permissions: new Set(perms), authKind: 'session', source: 'ui' })

beforeEach(() => {
  db = fakeDb()
  runs = []
  calls = { upsert: [], update: [], del: [], ref: [], wf: [] }
  targetRows = [
    { id: 'row-1', tenant_id: TENANT, table_id: TABLE, data: { vendor_id: 'V-1' } },
    { id: 'row-2', tenant_id: TENANT, table_id: TABLE, data: { vendor_id: 'V-2' } },
    { id: 'row-2b', tenant_id: TENANT, table_id: TABLE, data: { vendor_id: 'V-2' } },
    { id: 'row-3', tenant_id: TENANT, table_id: TABLE, data: { vendor_id: 'V-3' } },
  ]
  tableChangesDeps.now = () => now
  tableChangesDeps.dataTables = async () => ({
    upsertRows: async (_c: any, table: string, rows: any[]) => { calls.upsert.push({ table, rows }); return [{ row_id: `new-${calls.upsert.length}`, action: 'created', row: {} }] },
    updateRow: async (_c: any, table: string, id: string, cells: any) => { calls.update.push({ table, id, cells }); return {} },
    deleteRows: async (_c: any, table: string, ids: string[]) => { calls.del.push({ table, ids }); return { deleted: ids.length, ids } },
  }) as any
  tableChangesDeps.executeReference = async (opts: any) => {
    calls.ref.push(opts)
    return opts.inputValues.vendor_id === 'V-2' ? { status: 500, data: { error: 'boom' }, error_message: 'Server error' } : { status: 200, data: { ok: true, id: opts.inputValues.vendor_id } }
  }
  tableChangesDeps.startWorkflow = (async (_c: any, input: any) => { calls.wf.push(input); return { mode: 'async', job_id: `job-${calls.wf.length}` } }) as any
})

const run = (config: TableChangesConfig, key = 'submit:s1:0', c = ctx()) =>
  runTableChanges(c, { config, fields: FIELDS, values: { reason: 'Q4', vendors: CHANGES }, idempotencyKey: key, origin: 'submit', form: { id: TENANT, name: 'Vendors form' }, submissionId: null })

describe('runTableChanges (server executor)', () => {
  it('writes to a data table as the submitter: delete, update, insert; a match on several rows fails and stops', async () => {
    const summary = await run(rule())
    expect(calls.del).toEqual([{ table: TABLE, ids: ['row-3'] }])
    expect(calls.update).toEqual([{ table: TABLE, id: 'row-1', cells: { vendor_id: 'V-1', name: 'One', payment_terms: 45, note: 'by ada@x.test on 2026-10-31 from Q4' } }])
    // V-2 matches two rows: failed, and (stop on error) the insert is not attempted.
    expect(calls.upsert).toEqual([])
    expect(summary).toMatchObject({ succeeded: 2, failed: 1, skipped: 1, stopped: true })
    expect(summary.results[2]).toMatchObject({ key: 'V-2', status: 'failed', error: 'Several rows match vendor_id = V-2' })
    expect(summary.text).toBe('1 row deleted, 1 row updated, 1 failed, 1 not attempted')
    expect(runs[0]).toMatchObject({ status: 'partial', origin: 'submit', field_key: 'vendors', actor_id: ACTOR })
  })

  it('continue on error processes every row', async () => {
    const summary = await run(rule({ on_error: 'continue' }))
    expect(calls.upsert).toHaveLength(1)
    expect(summary).toMatchObject({ succeeded: 3, failed: 1, skipped: 0 })
  })

  it('is idempotent per key: a repeat returns the first summary without writing again', async () => {
    const first = await run(rule({ on_error: 'continue' }))
    const writes = calls.update.length + calls.del.length + calls.upsert.length
    const again = await run(rule({ on_error: 'continue' }))
    expect(again.replayed).toBe(true)
    expect(again.text).toBe(first.text)
    expect(calls.update.length + calls.del.length + calls.upsert.length).toBe(writes)
    // Another submitter can't replay someone else's key.
    await expect(run(rule(), 'submit:s1:0', { ...ctx(), actorId: 'someone-else' })).rejects.toThrow(/already used/)
  })

  it('a run still in progress is refused', async () => {
    runs.push({ id: 'r0', tenant_id: TENANT, idempotency_key: 'submit:busy:0', status: 'running', actor_id: ACTOR, summary: {} })
    await expect(run(rule(), 'submit:busy:0')).rejects.toThrow(/already being applied/)
  })

  it('table writes need data.manage_rows', async () => {
    await expect(run(rule(), 'k-perm-0000', ctx(['forms.submit']))).rejects.toThrow(/data.manage_rows/)
    expect(runs).toHaveLength(0)
  })

  it('calls an API per row and captures each result', async () => {
    const summary = await run(normalizeTableChanges({ field: 'vendors', target: 'reference', reference_id: 'ref-1', inputs: { vendor_id: '{{key}}', terms: '{{row.payment_terms}}' }, on_error: 'continue' }))
    expect(calls.ref.map((c) => c.inputValues)).toEqual([{ vendor_id: 'V-3', terms: 7 }, { vendor_id: 'V-1', terms: 45 }, { vendor_id: 'V-2', terms: 60 }, { vendor_id: null, terms: 15 }])
    expect(calls.ref[0]).toMatchObject({ referenceId: 'ref-1', expectedTenantId: TENANT, caller: { callerType: 'form_submit' } })
    expect(summary.results[2]).toMatchObject({ status: 'failed', http_status: 500, error: 'The API answered 500: Server error' })
    expect(summary.results[1]).toMatchObject({ status: 'ok', http_status: 200, response: { ok: true, id: 'V-1' } })
    expect(summary.text).toBe('3 rows sent to the API, 1 failed')
  })

  it('starts a workflow per row, or once with the whole change set', async () => {
    await run(normalizeTableChanges({ field: 'vendors', target: 'workflow', workflow_id: WF, inputs: { vendor: '{{key}}' } }))
    expect(calls.wf.map((w) => w.variables.vendor)).toEqual(['V-3', 'V-1', 'V-2', null])
    calls.wf = []
    const once = await run(normalizeTableChanges({ field: 'vendors', target: 'workflow', workflow_id: WF, per: 'once', inputs: { all: '{{changes}}' } }), 'submit:s2:0')
    expect(calls.wf).toHaveLength(1)
    expect(calls.wf[0].variables.all).toEqual(CHANGES)
    expect(once.text).toBe('Started a workflow')
  })

  it('nothing to do: no run row, a plain summary', async () => {
    const summary = await runTableChanges(ctx(), { config: rule(), fields: FIELDS, values: { vendors: null }, idempotencyKey: 'submit:s3:0', origin: 'submit' })
    expect(summary.text).toBe('No table changes to apply')
    expect(runs).toHaveLength(0)
  })

  it('refuses a rule on a field that is not an editable Data table (targets only from the definition)', async () => {
    await expect(run(rule({ field: 'reason' }))).rejects.toThrow(/not an editable Data table/)
  })
})
