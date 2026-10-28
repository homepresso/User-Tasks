import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // 32-byte key so connector credentials really are encrypted at rest here.
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
})

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { buildTenantExport } from '@/lib/portability/export'
import { encryptSensitiveFields, decryptSensitiveFields } from '@/lib/secret-fields'
import type { ServiceContext } from '@/lib/services/context'
import { applyConfig, exportConfig } from '@/lib/services/config'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const A = 'tenant-a'
const B = 'tenant-b'
const ET_DEFAULT_A = 'e0000000-0000-4000-8000-000000000001'
const ET_WELCOME_A = 'e0000000-0000-4000-8000-000000000002'
const ET_DEFAULT_B = 'e0000000-0000-4000-8000-0000000000b1'
const CONN_SLACK_A = 'c0000000-0000-4000-8000-000000000001'
const CONN_OPENAI_A = 'c0000000-0000-4000-8000-000000000002'
const CONN_GH_A = 'c0000000-0000-4000-8000-000000000003'
const INT_SLACK_A = 'c1000000-0000-4000-8000-000000000001'
const INT_OPENAI_A = 'c1000000-0000-4000-8000-000000000002'
const REF_SLACK_A = 'c2000000-0000-4000-8000-000000000001'
const WF_A = 'a0000000-0000-4000-8000-000000000001'

/** Every credential value in the fixtures, encrypted or legacy plaintext. */
const SECRETS = ['xoxb-very-secret', 'sk-legacy-plaintext', 'org-legacy', 'ghp_github_token', 'cfg-client-secret']

function seed() {
  return createMemorySupabase({
    email_templates: [
      { id: ET_DEFAULT_A, tenant_id: A, name: 'UserTasks Default', description: null, subject: '{{task.title}}', html_body: '<p>{{task.title}}</p>', text_body: '{{task.title}}', is_default: true },
      { id: ET_WELCOME_A, tenant_id: A, name: 'Welcome', description: 'Onboarding', subject: 'Welcome {{name}}', html_body: '<p>Hi {{name}}</p>', text_body: 'Hi {{name}}', is_default: false },
      { id: ET_DEFAULT_B, tenant_id: B, name: 'UserTasks Default', description: null, subject: 'B {{task.title}}', html_body: '<p>B</p>', text_body: 'B', is_default: true },
    ],
    tenant_connectors: [
      {
        id: CONN_SLACK_A, tenant_id: A, connector_key: 'slack', display_name: 'Slack', integration_id: INT_SLACK_A, is_enabled: true,
        config: { default_channel: '#ops' }, credentials: encryptSensitiveFields({ bot_token: 'xoxb-very-secret' }),
      },
      {
        // Legacy plaintext row (written before encryption at rest).
        id: CONN_OPENAI_A, tenant_id: A, connector_key: 'openai', display_name: 'OpenAI', integration_id: INT_OPENAI_A, is_enabled: true,
        config: { default_model: 'gpt-4o-mini', client_secret: 'cfg-client-secret' }, credentials: { api_key: 'sk-legacy-plaintext', org_id: 'org-legacy', stray: 'not-a-field' },
      },
      { id: CONN_GH_A, tenant_id: A, connector_key: 'github_sync', is_enabled: true, config: {}, credentials: { token: 'ghp_github_token' } },
    ],
    integrations: [
      { id: INT_SLACK_A, tenant_id: A, name: 'Slack (Connector)', type: 'slack', is_active: true, tags: ['slack'], config: encryptSensitiveFields({ base_url: 'https://slack.com/api', auth_type: 'bearer', auth_config: { token: 'xoxb-very-secret' } }) },
      { id: INT_OPENAI_A, tenant_id: A, name: 'OpenAI (Connector)', type: 'openai', is_active: true, tags: ['openai'], config: { base_url: 'https://api.openai.com/v1', auth_config: { token: 'sk-legacy-plaintext' } } },
    ],
    integration_references: [
      { id: REF_SLACK_A, tenant_id: A, integration_id: INT_SLACK_A, name: 'Slack: Send Message', description: null, tags: null, request_config: { method: 'POST', path_template: '/chat.postMessage' }, inputs: [], outputs: [] },
    ],
    workflows: [{
      id: WF_A, tenant_id: A, name: 'Notify', description: null, trigger_type: 'manual', trigger_config: {}, is_active: false, user_variables: [], swimlanes: [],
      nodes: [
        { id: 't1', type: 'manual', label: 'Manual Trigger', position: { x: 300, y: 20 }, config: {} },
        { id: 'n1', type: 'send_email', label: 'Mail', position: { x: 300, y: 160 }, config: { email_template_id: ET_WELCOME_A, to: 'a@example.com' } },
        { id: 'n2', type: 'integration', label: 'Post', position: { x: 300, y: 300 }, config: { integration_id: INT_SLACK_A, reference_id: REF_SLACK_A } },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'n1' }, { id: 'e2', source: 'n1', target: 'n2' }],
    }],
  }, { uuids: true })
}

type Db = ReturnType<typeof seed>

function ctx(db: Db, tenantId = A, permissions: readonly string[] = PERMISSION_KEYS): ServiceContext {
  return { supabase: db as unknown as ServiceContext['supabase'], tenantId, actorId: null, permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

const rows = (db: Db, table: string, tenantId: string) => (db.tables[table] ?? []).filter((r) => r.tenant_id === tenantId)
const exportFiles = async (db: Db, tenantId = A) => (await exportConfig(ctx(db, tenantId))).files!
const withCredential = (files: Array<{ path: string; content: string }>, token: string) => files.map((f) => f.path.startsWith('connectors/slack')
  ? { ...f, content: f.content.replace('"bot_token": "__SECRET__"', `"bot_token": ${JSON.stringify(token)}`) }
  : f)

beforeEach(() => {
  vi.mocked(recordAssetChange).mockClear()
})

describe('config sections: email templates and connectors (export)', () => {
  it('never exports a connector credential, encrypted or plaintext', async () => {
    const db = seed()
    const files = await exportFiles(db)
    const text = files.map((f) => f.content).join('\n')
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
    expect(text).not.toContain('enc:v1:')
    expect(text).not.toContain('not-a-field') // only the definition's credential keys travel

    const tenant = JSON.stringify(await buildTenantExport(db, A))
    for (const secret of SECRETS) expect(tenant, secret).not.toContain(secret)
    expect(tenant).not.toContain('enc:v1:')
  })

  it('exports connectors with masked credentials and leaves their generated integrations out', async () => {
    const result = await exportConfig(ctx(seed()), { format: 'manifest' })
    const manifest = result.manifest!
    expect(manifest.connectors.map((c: any) => c.connector_key).sort()).toEqual(['openai', 'slack']) // never github_sync
    const slack = manifest.connectors.find((c: any) => c.connector_key === 'slack')
    expect(slack).toMatchObject({
      id: CONN_SLACK_A, name: 'Slack', config: { default_channel: '#ops' }, credentials: { bot_token: '__SECRET__' }, is_enabled: true,
      generated_integration_id: INT_SLACK_A, generated_references: [{ id: REF_SLACK_A, name: 'Slack: Send Message' }],
    })
    expect(manifest.connectors.find((c: any) => c.connector_key === 'openai').credentials).toEqual({ api_key: '__SECRET__', org_id: '__SECRET__' })
    expect(manifest.integrations).toBeUndefined()
    expect(manifest.references).toBeUndefined()
    expect(manifest.email_templates.map((t: any) => t.name).sort()).toEqual(['UserTasks Default', 'Welcome'])
    const files = (await exportConfig(ctx(seed()))).files!.map((f) => f.path)
    expect(files).toEqual(expect.arrayContaining(['email-templates/welcome-e0000000.json', 'connectors/slack-c0000000.json']))
  })

  it('gates each section by its own view permission', async () => {
    const result = await exportConfig(ctx(seed(), A, ['workflows.view']), { types: ['email_templates', 'connectors'], format: 'manifest' })
    expect(result.skipped.map((s) => s.section)).toEqual(['connectors'])
    expect(result.manifest!.email_templates).toHaveLength(2)
  })
})

describe('config sections: email templates and connectors (apply)', () => {
  it('re-applying the same tenant export is all unchanged', async () => {
    const db = seed()
    const plan = await applyConfig(ctx(db), { files: await exportFiles(db), dry_run: true })
    // + the workspace theme (default on both sides)
    expect(plan.plan.summary).toEqual({ create: 0, update: 0, unchanged: 6, error: 0 })
  })

  it('promotes to another tenant: connector without credentials is created disabled, ids remap, second apply is unchanged', async () => {
    const db = seed()
    const files = await exportFiles(db)

    const dry = await applyConfig(ctx(db, B), { files, dry_run: true })
    expect(dry.plan.assets.find((a) => a.section === 'email_templates' && a.name === 'UserTasks Default')).toMatchObject({ action: 'update', matched_by: 'name', local_id: ET_DEFAULT_B })
    expect(dry.warnings.map((w) => w.warning)).toEqual(expect.arrayContaining([expect.stringContaining('Connector "Slack" needs credentials (bot_token)')]))

    const first = await applyConfig(ctx(db, B), { files, source_label: 'dev' })
    expect(first.result!.errors).toEqual([])
    expect(first.result!.warnings.map((w) => w.warning)).toEqual(expect.arrayContaining([expect.stringContaining('needs credentials (bot_token); created disabled')]))

    const slack = rows(db, 'tenant_connectors', B).find((c) => c.connector_key === 'slack')!
    expect(slack).toMatchObject({ display_name: 'Slack', is_enabled: false, config: { default_channel: '#ops' } })
    expect(slack.credentials).toEqual({})
    const slackIntegration = rows(db, 'integrations', B).find((i) => i.id === slack.integration_id)!
    expect(slackIntegration).toMatchObject({ name: 'Slack (Connector)', is_active: false })
    const sendMessage = rows(db, 'integration_references', B).find((r) => r.integration_id === slack.integration_id && r.name === 'Slack: Send Message')!
    expect(sendMessage).toBeTruthy()
    expect(JSON.stringify(rows(db, 'tenant_connectors', B))).not.toContain('__SECRET__')

    // Email templates: B keeps exactly one default (its own, adopted by name).
    const templates = rows(db, 'email_templates', B)
    expect(templates.map((t) => t.name).sort()).toEqual(['UserTasks Default', 'Welcome'])
    expect(templates.filter((t) => t.is_default).map((t) => t.id)).toEqual([ET_DEFAULT_B])
    const welcome = templates.find((t) => t.name === 'Welcome')!

    // The workflow's email template and connector reference point at B's copies.
    const workflow = rows(db, 'workflows', B)[0]
    expect(workflow.nodes[1].config.email_template_id).toBe(welcome.id)
    expect(workflow.nodes[2].config).toMatchObject({ integration_id: slack.integration_id, reference_id: sendMessage.id })
    // No integration of its own was created for the connector's.
    expect(rows(db, 'integrations', B)).toHaveLength(2)

    const again = await applyConfig(ctx(db, B), { files, source_label: 'dev' })
    expect(again.plan.summary).toEqual({ create: 0, update: 0, unchanged: 6, error: 0 })
    expect(again.warnings.map((w) => w.warning)).toEqual(expect.arrayContaining([expect.stringContaining('stays disabled')]))
    expect(rows(db, 'tenant_connectors', B)).toHaveLength(2)
    expect(rows(db, 'email_templates', B)).toHaveLength(2)

    // Credentials supplied later (e.g. ${env:SLACK_BOT_TOKEN}) → update, enabled, never echoed.
    const withToken = withCredential(files, 'xoxb-from-env')
    const rotate = await applyConfig(ctx(db, B), { files: withToken, source_label: 'dev' })
    expect(rotate.plan.assets.find((a) => a.section === 'connectors' && a.name === 'Slack')).toMatchObject({ action: 'update' })
    expect(JSON.stringify(rotate)).not.toContain('xoxb-from-env')
    const enabled = rows(db, 'tenant_connectors', B).find((c) => c.connector_key === 'slack')!
    expect(enabled.is_enabled).toBe(true)
    expect(enabled.credentials.bot_token).toMatch(/^enc:v1:/)
    expect(decryptSensitiveFields(enabled.credentials).bot_token).toBe('xoxb-from-env')
    expect(rows(db, 'integrations', B).find((i) => i.id === enabled.integration_id)!.is_active).toBe(true)
    // Reference ids survive the update (workflows point at them).
    expect(rows(db, 'integration_references', B).some((r) => r.id === sendMessage.id)).toBe(true)

    // And with the sentinel again, the stored credential is kept.
    const keep = await applyConfig(ctx(db, B), { files, source_label: 'dev' })
    expect(keep.plan.summary).toMatchObject({ update: 0, create: 0 })
    expect(decryptSensitiveFields(rows(db, 'tenant_connectors', B).find((c) => c.connector_key === 'slack')!.credentials).bot_token).toBe('xoxb-from-env')
  })

  it('creates a connector enabled when real credentials are supplied', async () => {
    const db = seed()
    const files = withCredential(await exportFiles(db), 'xoxb-new')
    const result = await applyConfig(ctx(db, B), { files })
    expect(result.result!.warnings.filter((w) => w.warning.includes('"Slack"'))).toEqual([])
    const slack = rows(db, 'tenant_connectors', B).find((c) => c.connector_key === 'slack')!
    expect(slack.is_enabled).toBe(true)
    expect(slack.credentials.bot_token).toMatch(/^enc:v1:/)
  })

  it('shows field diffs for edited templates and connector config', async () => {
    const db = seed()
    const files = (await exportFiles(db)).map((f) => f.path.startsWith('email-templates/welcome')
      ? { ...f, content: f.content.replace('Welcome {{name}}', 'Hello {{name}}') }
      : f.path.startsWith('connectors/slack') ? { ...f, content: f.content.replace('#ops', '#alerts') } : f)
    const plan = await applyConfig(ctx(db), { files, dry_run: true })
    expect(plan.plan.summary).toMatchObject({ update: 2, unchanged: 4 })
    expect(plan.plan.assets.find((a) => a.section === 'email_templates' && a.action === 'update')).toMatchObject({ diffs: [{ path: 'subject', before: 'Welcome {{name}}', after: 'Hello {{name}}' }] })
    expect(plan.plan.assets.find((a) => a.section === 'connectors' && a.action === 'update')).toMatchObject({ diffs: [{ path: 'config.default_channel', before: '#ops', after: '#alerts' }] })
    await applyConfig(ctx(db), { files })
    expect(rows(db, 'tenant_connectors', A).find((c) => c.id === CONN_SLACK_A)!.config).toEqual({ default_channel: '#alerts' })
    expect(decryptSensitiveFields(rows(db, 'tenant_connectors', A).find((c) => c.id === CONN_SLACK_A)!.credentials).bot_token).toBe('xoxb-very-secret')
  })

  it('sanitises imported HTML and keeps a single default', async () => {
    const db = seed()
    const files = (await exportFiles(db)).filter((f) => f.path.startsWith('email-templates/')).map((f) => f.path.startsWith('email-templates/welcome')
      ? { ...f, content: f.content.replace('<p>Hi {{name}}</p>', '<p onclick=\\"x()\\">Hi {{name}}</p><script>alert(1)</script>').replace('"is_default": false', '"is_default": true') }
      : f)
    await applyConfig(ctx(db, B), { files })
    const templates = rows(db, 'email_templates', B)
    const welcome = templates.find((t) => t.name === 'Welcome')!
    expect(welcome.html_body).toBe('<p>Hi {{name}}</p>')
    // The incoming default ("UserTasks Default") is B's own; Welcome also asks — first one wins.
    expect(templates.filter((t) => t.is_default)).toHaveLength(1)
    // Sanitised content compares clean next time.
    const again = await applyConfig(ctx(db, B), { files, dry_run: true })
    expect(again.plan.summary).toMatchObject({ create: 0, update: 0 })
  })

  it('requires the connector and template write permissions on a real apply', async () => {
    const db = seed()
    const files = await exportFiles(db)
    const noIntegrationCreate = PERMISSION_KEYS.filter((p) => p !== 'integrations.create')
    await expect(applyConfig(ctx(db, B, noIntegrationCreate), { files })).rejects.toMatchObject({
      status: 403, details: { missing: [{ section: 'connectors', permission: 'integrations.create' }] },
    })
    expect(rows(db, 'tenant_connectors', B)).toHaveLength(0)
  })

  it('queues GitHub sync for connectors and templates from their services', async () => {
    const { createEmailTemplate } = await import('@/lib/services/email-templates')
    const { setConnectorEnabled } = await import('@/lib/services/connectors')
    const db = seed()
    const created = await createEmailTemplate(ctx(db), { name: 'New', subject: 'S', html_body: '<p>x</p>' })
    await setConnectorEnabled(ctx(db), CONN_SLACK_A, false)
    expect(vi.mocked(recordAssetChange).mock.calls.map(([p]) => `${p.assetType}:${p.assetId}`)).toEqual([`email_template:${created.id}`, `connector:${CONN_SLACK_A}`])
  })
})
