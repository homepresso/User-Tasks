import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCommandSpecs, type OpenApiDoc } from '../src/build-specs'
import { COMMAND_SPECS } from '../src/generated/commands'
import { buildProgram } from '../src/main'
import { Runtime } from '../src/runtime'
import { harness, ok } from './helpers'

const doc = JSON.parse(readFileSync(resolve(__dirname, '../../sdk/openapi.json'), 'utf8')) as OpenApiDoc
const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }

describe('generated command table', () => {
  it('is up to date with openapi.json', () => {
    expect(COMMAND_SPECS).toEqual(buildCommandSpecs(doc))
  })

  it('covers every operation that has x-usertasks-cli metadata', () => {
    const withCli = Object.values(doc.paths).flatMap((item) => Object.values(item).filter((op) => op?.['x-usertasks-cli']))
    expect(withCli.length).toBeGreaterThan(40)
    expect(COMMAND_SPECS.map((s) => s.operationId).sort()).toEqual(withCli.map((op) => op!.operationId).sort())
  })

  const REPLACED = new Set(['packages create', 'packages assets'])
  it('registers a `<resource> <verb>` command for every spec', () => {
    const program = buildProgram(new Runtime(harness().io))
    for (const spec of COMMAND_SPECS) {
      const group = program.commands.find((c) => c.name() === spec.resource)
      expect(group, spec.resource).toBeDefined()
      const leaf = group!.commands.find((c) => c.name() === spec.verb)
      expect(leaf, `${spec.resource} ${spec.verb}`).toBeDefined()
      // Hand-written replacements (commands/package-authoring) may add optional arguments.
      const args = leaf!.registeredArguments.filter((a) => !(REPLACED.has(`${spec.resource} ${spec.verb}`) && !a.required))
      expect(args.map((a) => a.name())).toEqual([...spec.positional, ...(spec.bodyPositional ?? [])])
    }
  })

  it('marks DELETE and revoke/delete verbs destructive, and list endpoints paginated', () => {
    expect(COMMAND_SPECS.find((s) => s.operationId === 'deleteAgent')?.destructive).toBe(true)
    expect(COMMAND_SPECS.find((s) => s.operationId === 'getAgent')?.destructive).toBe(false)
    expect(COMMAND_SPECS.find((s) => s.operationId === 'listWorkflows')).toMatchObject({ paginated: true, listKey: 'workflows' })
    expect(COMMAND_SPECS.find((s) => s.operationId === 'listWorkflows')?.query.map((q) => q.name)).toEqual(['active'])
  })

  it('exposes integrations, references, objects and connectors commands', () => {
    const commands = new Set(COMMAND_SPECS.map((s) => `${s.resource} ${s.verb}`))
    for (const command of [
      'integrations list', 'integrations create', 'integrations get', 'integrations update', 'integrations delete',
      'integrations test', 'integrations import-openapi',
      'references list', 'references create', 'references get', 'references update', 'references delete',
      'references bulk-delete', 'references execute',
      'objects list', 'objects create', 'objects get', 'objects delete',
      'connectors catalog', 'connectors list', 'connectors create', 'connectors get', 'connectors update',
      'connectors delete', 'connectors test', 'connectors enable', 'connectors disable', 'connectors regenerate-references',
    ]) expect(commands.has(command), command).toBe(true)
    expect(COMMAND_SPECS.find((s) => s.operationId === 'updateIntegration')?.method).toBe('PATCH')
    expect(COMMAND_SPECS.find((s) => s.operationId === 'bulkDeleteReferences')?.destructive).toBe(true)
    expect(COMMAND_SPECS.find((s) => s.operationId === 'importOpenApiIntegration')?.query.map((q) => q.flag)).toEqual(['name', 'base-url', 'auth-type'])
  })

  it('exposes email-templates and activities commands', () => {
    const commands = new Set(COMMAND_SPECS.map((s) => `${s.resource} ${s.verb}`))
    for (const command of [
      'email-templates list', 'email-templates create', 'email-templates get', 'email-templates update',
      'email-templates delete', 'email-templates preview',
      'activities list', 'activities create', 'activities get', 'activities update', 'activities delete',
      'activities export', 'activities import',
    ]) expect(commands.has(command), command).toBe(true)
    expect(COMMAND_SPECS.find((s) => s.operationId === 'importWorkflowActivity')?.query.map((q) => q.flag)).toEqual(['publish'])
  })

  it('exposes tables, rows, decision-table import/export, workflow lifecycle and task update commands', () => {
    const commands = new Set(COMMAND_SPECS.map((s) => `${s.resource} ${s.verb}`))
    for (const command of [
      'tables list', 'tables create', 'tables get', 'tables update', 'tables delete',
      'rows list', 'rows upsert', 'rows get', 'rows update', 'rows delete', 'rows bulk-delete',
      'decision-tables export', 'decision-tables import',
      'workflows delete', 'workflows activate', 'workflows deactivate', 'workflows versions', 'workflows version',
      'tasks update',
    ]) expect(commands.has(command), command).toBe(true)
    expect(COMMAND_SPECS.find((s) => s.operationId === 'updateDataRow')?.positional).toEqual(['id', 'rowId'])
    expect(COMMAND_SPECS.find((s) => s.operationId === 'listDataRows')).toMatchObject({ paginated: true, listKey: 'rows' })
    expect(COMMAND_SPECS.find((s) => s.operationId === 'bulkDeleteDataRows')?.destructive).toBe(true)
  })

  it('rejects duplicate commands and query params that shadow global flags', () => {
    const op = (id: string, extra = {}) => ({ operationId: id, 'x-usertasks-cli': { resource: 'r', verb: 'v' }, ...extra })
    expect(() => buildCommandSpecs({ paths: { '/a': { get: op('a') }, '/b': { get: op('b') } } })).toThrow(/Duplicate/)
    expect(() =>
      buildCommandSpecs({ paths: { '/a': { get: op('a', { parameters: [{ name: 'output', in: 'query' }] }) } } }),
    ).toThrow(/collides/)
  })
})

describe('generic resource runner', () => {
  it('tasks complete posts the complete action with outcome and field values', async () => {
    const h = harness({ env, responder: () => ok({ action: 'completed', outcome: 'approved' }) })
    expect(await h.run('tasks', 'complete', 't1', '--outcome', 'approved', '--notes', 'ok', '--set', 'amount:=42', '--set', 'reason=fine')).toBe(0)
    expect(h.requests[0].method).toBe('POST')
    expect(h.requests[0].url.toString()).toBe('https://tasks.test/api/v1/tasks/t1/action')
    expect(h.requests[0].body).toEqual({ action: 'complete', outcome: 'approved', outcome_notes: 'ok', values: { amount: 42, reason: 'fine' } })
  })

  it('maps positional path params and query flags', async () => {
    const h = harness({ env, responder: () => ok({ workflow: { id: 'w1' } }) })
    expect(await h.run('workflows', 'get', 'w1', '--include-logs', 'true', '--run-id', 'r9')).toBe(0)
    expect(h.requests[0].url.toString()).toBe('https://tasks.test/api/v1/workflows/w1?run_id=r9&include_logs=true')
    expect(h.requests[0].headers.Authorization).toBe('Bearer ut_key')
    expect(JSON.parse(h.stdout())).toEqual({ workflow: { id: 'w1' } })
  })

  it('passes --limit/--offset for list commands', async () => {
    const h = harness({ env, responder: () => ok({ runs: [], total: 0 }) })
    expect(await h.run('runs', 'list', '--limit', '5', '--offset', '10', '--status', 'failed')).toBe(0)
    expect(Object.fromEntries(h.requests[0].url.searchParams)).toEqual({ status: 'failed', limit: '5', offset: '10' })
  })

  it('--all fetches every page and prints the items', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: `t${i}` }))
    const h = harness({
      env,
      responder: (req) => {
        const limit = Number(req.url.searchParams.get('limit'))
        const offset = Number(req.url.searchParams.get('offset'))
        return ok({ tasks: rows.slice(offset, offset + limit), total: rows.length })
      },
    })
    expect(await h.run('tasks', 'list', '--all', '-o', 'json')).toBe(0)
    expect(JSON.parse(h.stdout())).toHaveLength(150)
    expect(h.requests).toHaveLength(2)
  })

  it('builds the body from -f (YAML) and --set overrides', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usertasks-body-'))
    const file = join(dir, 'table.yaml')
    writeFileSync(file, 'name: Pricing\ninputs:\n  - name: tier\n')
    const h = harness({ env, responder: () => ({ status: 201, ...ok({ decision_table: { id: 'd1' } }) }) })
    expect(await h.run('decision-tables', 'create', '-f', file, '--set', 'description=Tiered', '--set', 'rules:=[]')).toBe(0)
    expect(h.requests[0].method).toBe('POST')
    expect(h.requests[0].body).toEqual({ name: 'Pricing', inputs: [{ name: 'tier' }], description: 'Tiered', rules: [] })
  })

  it('reads files into body fields with --set key=@file / key:=@file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usertasks-setfile-'))
    const html = join(dir, 'email.html')
    const manifest = join(dir, 'manifest.yaml')
    writeFileSync(html, '<h1>Hi {{name}}</h1>\n')
    writeFileSync(manifest, 'inputs:\n  - name: a\n')
    const h = harness({ env, responder: () => ({ status: 201, ...ok({ email_template: { id: 't1' } }) }) })
    expect(await h.run('email-templates', 'create', '--set', 'name=Welcome', '--set', 'subject=Hi', '--set', `html_body=@${html}`,
      '--set', `meta:=@${manifest}`, '--set', 'handle=\\@me')).toBe(0)
    expect(h.requests[0].body).toEqual({
      name: 'Welcome', subject: 'Hi', html_body: '<h1>Hi {{name}}</h1>\n', meta: { inputs: [{ name: 'a' }] }, handle: '@me',
    })

    const missing = harness({ env })
    expect(await missing.run('email-templates', 'create', '--set', `html_body=@${join(dir, 'nope.html')}`)).toBe(2)
    expect(missing.requests).toHaveLength(0)
  })

  it('reads the body from stdin with -f -', async () => {
    const h = harness({ env, stdin: '{"message":"hi"}', responder: () => ok({}) })
    expect(await h.run('agents', 'execute', 'a1', '-f', '-')).toBe(0)
    expect(h.requests[0].body).toEqual({ message: 'hi' })
  })

  it('returns bare bodies for envelope:false operations', async () => {
    const h = harness({ env, responder: () => ({ body: { sources: [{ id: 'tasks', label: 'Tasks' }] } }) })
    expect(await h.run('reports', 'sources', '-o', 'json')).toBe(0)
    expect(JSON.parse(h.stdout())).toEqual({ sources: [{ id: 'tasks', label: 'Tasks' }] })
  })

  it('prompts before destructive commands on a terminal', async () => {
    const declined = harness({ env, tty: true, confirm: false })
    expect(await declined.run('agents', 'delete', 'a1')).toBe(1)
    expect(declined.confirm).toHaveBeenCalledOnce()
    expect(declined.requests).toHaveLength(0)

    const accepted = harness({ env, tty: true, confirm: true, responder: () => ok({ deleted: true }) })
    expect(await accepted.run('agents', 'delete', 'a1')).toBe(0)
    expect(accepted.requests[0].method).toBe('DELETE')
  })

  it('skips the prompt with --yes or when stdin is not a terminal', async () => {
    const yes = harness({ env, tty: true, responder: () => ok({ deleted: true }) })
    expect(await yes.run('agents', 'delete', 'a1', '--yes')).toBe(0)
    expect(yes.confirm).not.toHaveBeenCalled()

    const piped = harness({ env, tty: false, responder: () => ok({ deleted: true }) })
    expect(await piped.run('agents', 'delete', 'a1')).toBe(0)
    expect(piped.confirm).not.toHaveBeenCalled()
  })

  it('renders list tables on a TTY', async () => {
    const h = harness({ env, tty: true, responder: () => ok({ decision_tables: [{ id: 'd1', name: 'Pricing', rules: [] }], total: 1 }) })
    expect(await h.run('decision-tables', 'list')).toBe(0)
    expect(h.stdout()).toBe('ID  NAME\nd1  Pricing\n')
  })

  it('treats a malformed --set as a usage error', async () => {
    const h = harness({ env })
    expect(await h.run('decision-tables', 'create', '--set', 'novalue')).toBe(2)
    expect(h.requests).toHaveLength(0)
  })
})

describe('completion', () => {
  it.each(['bash', 'zsh', 'fish'])('prints a %s script that mentions resource commands', async (shell) => {
    const h = harness()
    expect(await h.run('completion', shell)).toBe(0)
    expect(h.stdout()).toContain('decision-tables')
    expect(h.stdout()).toContain('workflows')
  })

  it('rejects unknown shells', async () => {
    expect(await harness().run('completion', 'tcsh')).toBe(2)
  })
})

describe('governance, api-keys and webhooks commands', () => {
  it('exposes roles, users, teams, invitations, audit-log, api-keys and webhooks commands', () => {
    const commands = new Set(COMMAND_SPECS.map((s) => `${s.resource} ${s.verb}`))
    for (const command of [
      'roles list', 'roles create', 'roles get', 'roles update', 'roles delete',
      'users list', 'users add-role', 'users remove-role',
      'teams list', 'teams create', 'teams get', 'teams update', 'teams delete', 'teams add-member', 'teams remove-member',
      'invitations list', 'invitations send', 'invitations revoke', 'invitations resend',
      'audit-log list',
      'api-keys list', 'api-keys create', 'api-keys revoke', 'api-keys delete',
      'webhooks list', 'webhooks create', 'webhooks delete', 'webhooks rotate',
    ]) expect(commands.has(command), command).toBe(true)
    expect(COMMAND_SPECS.find((s) => s.operationId === 'assignUserRole')).toMatchObject({ method: 'PUT', positional: ['id', 'roleId'] })
    expect(COMMAND_SPECS.find((s) => s.operationId === 'revokeApiKey')?.destructive).toBe(true)
  })

  it('hints at re-running login with keys:write when an OAuth profile lacks it', async () => {
    const h = harness({
      env,
      responder: () => ({
        status: 403,
        body: {
          success: false, error: "Forbidden: managing API keys with an OAuth token needs the 'keys:write' scope", code: 'insufficient_scope',
          details: { required_scope: 'keys:write', granted_scopes: ['workflows:read', 'config:write'] },
        },
      }),
    })
    expect(await h.run('api-keys', 'create', '--set', 'name=ci', '--set', 'expires_in_days:=30')).toBe(4)
    expect(h.stderr()).toContain('re-run: usertasks login --scopes workflows:read,config:write,keys:write')
  })

  it('prints no scope hint for an ordinary 403', async () => {
    const h = harness({ env, responder: () => ({ status: 403, body: { success: false, error: 'Forbidden', code: 'forbidden' } }) })
    expect(await h.run('api-keys', 'create', '--set', 'name=ci')).toBe(4)
    expect(h.stderr()).not.toContain('re-run:')
  })
})

describe('workspace-theme commands', () => {
  const theme = { meta: { name: 'Acme', mode: 'auto', schemaVersion: 1 } }

  it('get / presets / apply-preset <preset_id> / upload-font map to the REST endpoints', async () => {
    const h = harness({ env, responder: () => ok({ workspace_theme: theme, version: 2 }) })
    expect(await h.run('workspace-theme', 'get', '-o', 'json')).toBe(0)
    expect(h.requests[0]).toMatchObject({ method: 'GET' })
    expect(h.requests[0].url.pathname).toBe('/api/v1/workspace-theme')

    expect(await h.run('workspace-theme', 'presets')).toBe(0)
    expect(h.requests[1].url.pathname).toBe('/api/v1/workspace-theme/presets')

    expect(await h.run('workspace-theme', 'apply-preset', 'lagoon', '--set', 'expected_version:=2')).toBe(0)
    expect(h.requests[2]).toMatchObject({ method: 'POST', body: { preset_id: 'lagoon', expected_version: 2 } })
    expect(h.requests[2].url.pathname).toBe('/api/v1/workspace-theme/apply-preset')

    expect(await h.run('workspace-theme', 'upload-font', '--set', 'file_name=Brand.woff2', '--set', 'content_base64=d09GMg==')).toBe(0)
    expect(h.requests[3]).toMatchObject({ method: 'POST', body: { file_name: 'Brand.woff2', content_base64: 'd09GMg==' } })
  })

  it('update -f sends a file saved with `get -o json` unchanged (PUT)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usertasks-theme-'))
    const file = join(dir, 'theme.json')
    writeFileSync(file, JSON.stringify({ workspace_theme: theme, version: 2, contrast: [] }))
    const h = harness({ env, responder: () => ok({ workspace_theme: theme, version: 3 }) })
    expect(await h.run('workspace-theme', 'update', '-f', file)).toBe(0)
    expect(h.requests[0]).toMatchObject({ method: 'PUT', body: { workspace_theme: theme, version: 2, contrast: [] } })
    expect(h.requests[0].url.pathname).toBe('/api/v1/workspace-theme')
  })
})
