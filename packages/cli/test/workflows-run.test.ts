import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { harness, ok, type Recorded } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }

const schema = {
  workflow_id: 'wf1', workflow_name: 'Onboard', is_active: true, published: true, source: 'published', version_id: 'v3', version_number: 3,
  fields: [
    { key: 'customer', label: 'Customer', type: 'text', required: true, default: null, description: 'Legal name', options: null },
    { key: 'amount', label: 'Amount', type: 'number', required: false, default: 10, description: null, options: null },
    { key: 'urgent', label: 'Urgent', type: 'boolean', required: false, default: false, description: null, options: null },
    { key: 'meta', label: 'Meta', type: 'json', required: false, default: null, description: null, options: null },
  ],
}

function responder(start: unknown = { mode: 'async', job_id: 'job-1', workflow_id: 'wf1' }) {
  return (req: Recorded) => req.url.pathname.endsWith('/inputs') ? ok(schema) : ok(start)
}
const startBody = (requests: Recorded[]) => requests.find((r) => r.url.pathname === '/api/v1/workflows/start')?.body

describe('workflows run', () => {
  it('coerces --input values by type and queues the run', async () => {
    const h = harness({ env, responder: responder() })
    const code = await h.run('workflows', 'run', 'wf1', '--input', 'customer=Acme', '--input', 'amount=42', '--input', 'urgent=yes', '--input', 'meta={"a":1}', '--input', 'extra=x', '--priority', '80', '-o', 'table')
    expect(code).toBe(0)
    expect(h.requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual(['GET /api/v1/workflows/wf1/inputs', 'POST /api/v1/workflows/start'])
    expect(startBody(h.requests)).toEqual({
      workflow_id: 'wf1', async: true, priority: 80,
      variables: { customer: 'Acme', amount: 42, urgent: true, meta: { a: 1 }, extra: 'x' },
    })
    expect(h.stdout()).toContain('Queued "Onboard": job job-1')
  })

  it('reads -f inputs (--input wins) and --wait prints status and outputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ut-run-'))
    const file = join(dir, 'inputs.json')
    writeFileSync(file, JSON.stringify({ customer: 'From file', amount: 1 }))
    const h = harness({ env, responder: responder({ mode: 'sync', run_id: 'run-9', status: 'completed', node_results: { end: { total: 42 } } }) })
    const code = await h.run('workflows', 'run', 'wf1', '-f', file, '--input', 'amount=2', '--wait', '-o', 'table')
    expect(code).toBe(0)
    expect(startBody(h.requests)).toEqual({ workflow_id: 'wf1', async: false, variables: { customer: 'From file', amount: 2 } })
    const out = h.stdout()
    expect(out).toContain('Run run-9 of "Onboard": completed')
    expect(out).toMatch(/STEP\s+OUTPUT/)
    expect(out).toMatch(/end\s+\{"total":42\}/)
  })

  it('prompts on a terminal for missing required inputs', async () => {
    const h = harness({ env, tty: true, answers: ['', 'Prompted Ltd'], responder: responder() })
    const code = await h.run('workflows', 'run', 'wf1', '-o', 'json')
    expect(code).toBe(0)
    expect(h.prompt).toHaveBeenCalledTimes(2)
    expect(h.prompt.mock.calls[0][0]).toContain('Customer [customer (text) — Legal name]')
    expect(h.stderr()).toContain('customer is required.')
    expect(startBody(h.requests)).toMatchObject({ variables: { customer: 'Prompted Ltd' } })
    expect(JSON.parse(h.stdout())).toMatchObject({ mode: 'async', job_id: 'job-1' })
  })

  it('without a terminal lists missing required inputs and exits 2 without starting', async () => {
    const h = harness({ env, responder: responder() })
    const code = await h.run('workflows', 'run', 'wf1', '--input', 'amount=3')
    expect(code).toBe(2)
    expect(h.stderr()).toContain('missing required input for "Onboard"')
    expect(h.stderr()).toContain('  - customer (text) — Legal name')
    expect(h.requests.map((r) => r.url.pathname)).toEqual(['/api/v1/workflows/wf1/inputs'])
  })

  it('rejects a value of the wrong type and a bad --priority as usage errors', async () => {
    let h = harness({ env, responder: responder() })
    expect(await h.run('workflows', 'run', 'wf1', '--input', 'customer=A', '--input', 'amount=lots')).toBe(2)
    expect(h.stderr()).toContain('amount: "lots" is not a number')
    h = harness({ env, responder: responder() })
    expect(await h.run('workflows', 'run', 'wf1', '--priority', '101')).toBe(2)
  })

  it('exits 1 when a --wait run failed, 6 on a server validation error', async () => {
    let h = harness({ env, responder: responder({ mode: 'sync', run_id: 'r', status: 'failed', error: 'boom', node_results: {} }) })
    expect(await h.run('workflows', 'run', 'wf1', '--input', 'customer=A', '--wait', '-o', 'table')).toBe(1)
    expect(h.stdout()).toContain('Error: boom')
    h = harness({
      env,
      responder: (req) => req.url.pathname.endsWith('/inputs') ? ok(schema) : { status: 400, body: { success: false, error: 'Invalid workflow inputs: customer: Customer is required', code: 'validation_error', details: [{ path: 'body.variables.customer', message: 'Customer is required' }] } },
    })
    expect(await h.run('workflows', 'run', 'wf1', '--input', 'customer=A')).toBe(6)
    expect(h.stderr()).toContain('body.variables.customer: Customer is required')
  })

  it('leaves the generated `workflows start` unchanged', async () => {
    const h = harness({ env, responder: () => ok({ mode: 'sync', run_id: 'r1' }) })
    expect(await h.run('workflows', 'start', '--set', 'workflow_id=wf1', '--set', 'variables:={"a":"1"}', '-o', 'json')).toBe(0)
    expect(h.requests[0].body).toEqual({ workflow_id: 'wf1', variables: { a: '1' } })
  })
})
