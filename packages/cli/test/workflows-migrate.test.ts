import { describe, expect, it } from 'vitest'
import { harness } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const ok = (data: unknown) => ({ body: { success: true, data } })

const item = (run: string, extra: Record<string, unknown> = {}) => ({
  run_id: run, ok: true, blocked_reason: null, warnings: [], from_version_number: 1,
  source_node_id: 'A', source_node_label: 'Approve', target_node_id: 'A', target_node_label: 'Approve', target_node_type: 'user_task',
  close: { open_task_ids: ['t1'], queued_job_ids: [] }, create: { creates_task: true, defaulted_variables: [] }, ...extra,
})
const plan = {
  dry_run: true,
  plan: {
    to_version: { id: 'v2', version_number: 2 },
    items: [item('11111111-aaaa'), item('22222222-bbbb', { ok: false, blocked_reason: 'Run is completed; only waiting or paused runs can be migrated' })],
    summary: { total: 2, ready: 1, blocked: 1, with_warnings: 0 },
    truncated: false,
  },
  results: [],
  summary: { migrated: 0, skipped: 1, failed: 0 },
}

describe('workflows migrate-instances', () => {
  it('--dry-run prints a readable plan table from the flags', async () => {
    const h = harness({ env, responder: () => ok(plan) })
    const code = await h.run('workflows', 'migrate-instances', 'wf1', '--to', 'v2', '--run', 'r1', '--run', 'r2', '--map', 'A=B', '--map', 'old=A', '--target', 'done', '--dry-run', '-o', 'table')
    expect(code).toBe(0)
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].url.pathname).toBe('/api/v1/workflows/wf1/instances/migrate')
    expect(h.requests[0].body).toEqual({ to_version_id: 'v2', run_ids: ['r1', 'r2'], node_map: { A: 'B', old: 'A' }, default_target_node_id: 'done', dry_run: true })
    const out = h.stdout()
    expect(out).toMatch(/RUN\s+FROM\s+CURRENT NODE\s+TARGET NODE \(v2\)\s+ACTION\s+NOTES/)
    expect(out).toMatch(/11111111\s+v1\s+Approve \(A\)\s+Approve \(A\) \[new task\]\s+close \+1 task/)
    expect(out).toMatch(/BLOCKED\s+Run is completed/)
    expect(out).toMatch(/Plan: 1 of 2 instances ready to migrate to v2, 1 blocked\./)
  })

  it('plans, confirms, then migrates only the planned-ready instances (--all)', async () => {
    const h = harness({
      env, confirm: true, tty: true,
      responder: (req) => (req.body as { dry_run: boolean }).dry_run
        ? ok(plan)
        : ok({ ...plan, dry_run: false, results: [{ run_id: '11111111-aaaa', ok: true, new_run_id: 'new-run-1', new_status: 'waiting_for_event', target_node_id: 'A' }], summary: { migrated: 1, skipped: 1, failed: 0 } }),
    })
    const code = await h.run('workflows', 'migrate-instances', 'wf1', '--to', 'v2', '--all', '-o', 'table')
    expect(code).toBe(0)
    expect(h.requests.map((r) => r.body)).toEqual([
      { to_version_id: 'v2', all_active: true, dry_run: true },
      { to_version_id: 'v2', run_ids: ['11111111-aaaa'], dry_run: false },
    ])
    expect(h.confirm).toHaveBeenCalledWith('Migrate 1 instance to v2?')
    expect(h.stdout()).toMatch(/11111111\s+migrated\s+new-run-1\s+A\s+waiting_for_event/)
    expect(h.stdout()).toMatch(/Migrated 1, skipped 1, failed 0\./)
  })

  it('declining the prompt migrates nothing; no selection is a usage error', async () => {
    const h = harness({ env, confirm: false, tty: true, responder: () => ok(plan) })
    expect(await h.run('workflows', 'migrate-instances', 'wf1', '--to', 'v2', '--from', 'v1')).not.toBe(0)
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0].body).toEqual({ to_version_id: 'v2', from_version_id: 'v1', dry_run: true })
    const usage = harness({ env })
    expect(await usage.run('workflows', 'migrate-instances', 'wf1', '--to', 'v2')).toBe(2)
    expect(usage.stderr()).toMatch(/--run <run-id>, --from <version> or --all/)
    expect(await usage.run('workflows', 'migrate-instances', 'wf1', '--to', 'v2', '--all', '--map', 'broken')).toBe(2)
  })

  it('-o json prints the raw API data', async () => {
    const h = harness({ env, responder: () => ok(plan) })
    await h.run('workflows', 'migrate-instances', 'wf1', '--to', 'v2', '--run', 'r1', '--dry-run', '-o', 'json')
    expect(JSON.parse(h.stdout())).toEqual(plan)
  })

  it('workflows instances lists live instances as a table with per-version counts', async () => {
    const data = {
      instances: [{ run_id: 'aaaaaaaa-1111', title: 'Onboard Contoso', status: 'waiting_for_event', version_number: 4, current_node_id: 'review', current_node_label: 'Review', waiting_since: '2026-10-24T09:30:00Z', open_task: { assignee_name: 'Ada', team_name: null } }],
      total: 1, versions: [{ version_id: 'v4', version_number: 4, is_published: false, instances: 1 }], on_older_versions: 1, published_version_id: 'v5',
    }
    const h = harness({ env, responder: () => ok(data) })
    await h.run('workflows', 'instances', 'wf1', '--version-id', 'v1', '--status', 'paused', '-o', 'table')
    expect(h.requests[0].url.pathname).toBe('/api/v1/workflows/wf1/instances')
    expect(Object.fromEntries(h.requests[0].url.searchParams)).toEqual({ version_id: 'v1', status: 'paused' })
    expect(h.stdout()).toMatch(/aaaaaaaa\s+Onboard Contoso\s+v4\s+Review \(review\)\s+waiting\s+2026-10-24 09:30\s+Ada/)
    expect(h.stdout()).toMatch(/1 live instance, 1 on older versions — v4: 1\./)
  })
})
