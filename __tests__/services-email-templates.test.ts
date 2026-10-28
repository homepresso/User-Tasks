import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { createMcpServer } from '@/lib/mcp/server'
import type { ServiceContext } from '@/lib/services/context'
import * as templates from '@/lib/services/email-templates'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ALL = ['workflows.view', 'workflows.create', 'workflows.edit']
const page = { limit: 50, offset: 0 }

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[] = ALL): ServiceContext {
  return {
    supabase: supabase as unknown as ServiceContext['supabase'],
    tenantId: 'tenant-a',
    actorId: 'user-1',
    permissions: new Set(permissions),
    authKind: 'api_key',
    source: 'api',
  }
}

function seed() {
  return createMemorySupabase({
    email_templates: [
      {
        id: 'tpl-default', tenant_id: 'tenant-a', name: 'UserTasks Default', description: null, is_default: true,
        subject: 'Action needed: {{user_task_title}}',
        html_body: '<a href="{{app_url}}/tasks/{{user_task_id}}">Open {{user_task_title}}</a>',
        text_body: 'Task {{user_task_id}}', created_at: '2026-01-01', updated_at: '2026-01-01',
      },
      {
        id: 'tpl-b', tenant_id: 'tenant-b', name: 'Foreign', description: null, is_default: true,
        subject: 'x', html_body: '<p>x</p>', text_body: 'x', created_at: '2026-01-01', updated_at: '2026-01-01',
      },
    ],
  })
}

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
})

describe('email template services: permissions', () => {
  it.each([
    ['list', (ctx: ServiceContext) => templates.listEmailTemplates(ctx, {}, page)],
    ['get', (ctx: ServiceContext) => templates.getEmailTemplate(ctx, 'tpl-default')],
    ['create', (ctx: ServiceContext) => templates.createEmailTemplate(ctx, { name: 'A', subject: 's', html_body: '<p>b</p>' })],
    ['update', (ctx: ServiceContext) => templates.updateEmailTemplate(ctx, 'tpl-default', { name: 'B' })],
    ['delete', (ctx: ServiceContext) => templates.deleteEmailTemplate(ctx, 'tpl-default')],
    ['preview', (ctx: ServiceContext) => templates.previewEmailTemplate(ctx, 'tpl-default', {})],
  ])('%s throws 403 without its workflows.* permission and touches nothing', async (_name, call) => {
    const supabase = seed()
    await expect(call(context(supabase, []))).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(supabase.calls).toEqual([])
  })

  it('create needs workflows.create; edit alone is not enough', async () => {
    await expect(templates.createEmailTemplate(context(seed(), ['workflows.edit']), { name: 'A', subject: 's', html_body: '<p>b</p>' }))
      .rejects.toMatchObject({ status: 403 })
  })
})

describe('email template services: behaviour', () => {
  it('lists and reads only the caller tenant', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const { email_templates: rows, total } = await templates.listEmailTemplates(ctx, {}, page)
    expect(rows.map((row) => row.id)).toEqual(['tpl-default'])
    expect(total).toBe(1)
    await expect(templates.getEmailTemplate(ctx, 'tpl-b')).rejects.toMatchObject({ status: 404 })
    await expect(templates.updateEmailTemplate(ctx, 'tpl-b', { name: 'pwn' })).rejects.toMatchObject({ status: 404 })
    await expect(templates.deleteEmailTemplate(ctx, 'tpl-b')).rejects.toMatchObject({ status: 404 })
    expect(supabase.tables.email_templates.find((row) => row.id === 'tpl-b')?.name).toBe('Foreign')
  })

  it('sanitises HTML and derives the text body on create', async () => {
    const supabase = seed()
    const created = await templates.createEmailTemplate(context(supabase), {
      name: ' Welcome ',
      subject: 'Hi {{name}}',
      html_body: '<p onclick="steal()">Hello</p><script>alert(1)</script><a href="javascript:evil()">x</a><iframe src="x"></iframe>',
    })
    expect(created.name).toBe('Welcome')
    expect(created.html_body).not.toMatch(/script|onclick|javascript:|iframe/i)
    expect(created.html_body).toContain('<p>Hello</p>')
    expect(created.text_body).toBe('Hello\nx')
    expect(created.is_default).toBe(false)
    expect(supabase.tables.email_templates.find((row) => row.id === created.id)).toMatchObject({ tenant_id: 'tenant-a', created_by: 'user-1' })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'email_template', action: 'create', objectId: created.id }))
    // Email templates are a GitHub-sync / config-as-code asset.
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'email_template', assetId: created.id, action: 'save' }))
  })

  it('rejects content that sanitises to nothing', async () => {
    await expect(templates.createEmailTemplate(context(seed()), { name: 'X', subject: 's', html_body: '<script>x</script>' }))
      .rejects.toMatchObject({ status: 400, message: 'HTML body is required' })
  })

  it('keeps at most one default per tenant', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const created = await templates.createEmailTemplate(ctx, { name: 'New default', subject: 's', html_body: '<p>b</p>', is_default: true })
    const defaults = () => supabase.tables.email_templates.filter((row) => row.tenant_id === 'tenant-a' && row.is_default).map((row) => row.id)
    expect(created.is_default).toBe(true)
    expect(defaults()).toEqual([created.id])

    await templates.updateEmailTemplate(ctx, 'tpl-default', { is_default: true })
    expect(defaults()).toEqual(['tpl-default'])
    // Other tenants' defaults are untouched.
    expect(supabase.tables.email_templates.find((row) => row.id === 'tpl-b')?.is_default).toBe(true)
  })

  it('refuses to delete the default, deletes others', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await expect(templates.deleteEmailTemplate(ctx, 'tpl-default')).rejects.toMatchObject({ status: 409, code: 'conflict' })
    const other = await templates.createEmailTemplate(ctx, { name: 'Other', subject: 's', html_body: '<p>b</p>' })
    await expect(templates.deleteEmailTemplate(ctx, other.id)).resolves.toEqual({ deleted: true, id: other.id })
    expect(supabase.tables.email_templates.some((row) => row.id === other.id)).toBe(false)
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', objectId: other.id }))
  })

  it('a new html_body regenerates the text body; explicit text wins', async () => {
    const ctx = context(seed())
    const updated = await templates.updateEmailTemplate(ctx, 'tpl-default', { html_body: '<p>Fresh</p>' })
    expect(updated.text_body).toBe('Fresh')
    const explicit = await templates.updateEmailTemplate(ctx, 'tpl-default', { html_body: '<p>Again</p>', text_body: 'Plain' })
    expect(explicit.text_body).toBe('Plain')
    await expect(templates.updateEmailTemplate(ctx, 'tpl-default', {})).rejects.toMatchObject({ status: 400 })
  })

  it('previews with the workflow resolver (variables, functions, task, app_url default)', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example')
    try {
      const preview = await templates.previewEmailTemplate(ctx, 'tpl-default', {
        variables: { user_task_title: 'Approve PO', user_task_id: 't-42' },
      })
      expect(preview).toEqual({
        id: 'tpl-default',
        name: 'UserTasks Default',
        subject: 'Action needed: Approve PO',
        html_body: '<a href="https://app.example/tasks/t-42">Open Approve PO</a>',
        text_body: 'Task t-42',
      })
      // Preview never writes.
      expect(supabase.calls).toEqual([])

      const fn = await templates.createEmailTemplate(ctx, { name: 'Fn', subject: '{{=UPPER("hi")}} {{task.title}} {{missing}}!', html_body: '<p>x</p>' })
      const rendered = await templates.previewEmailTemplate(ctx, fn.id, { task: { title: 'Ship' } })
      expect(rendered.subject).toBe('HI Ship !')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('MCP email template tools', () => {
  const parse = (result: { content?: Array<{ text?: string }> }) => JSON.parse(result?.content?.[0]?.text ?? 'null')

  function server(supabase: ReturnType<typeof createMemorySupabase>, permissions?: string[]) {
    return createMcpServer({
      tenantId: 'tenant-a',
      supabase: supabase as never,
      actingUserId: 'user-1',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
      ...(permissions ? { permissions } : {}),
    })
  }

  it('creates, lists, previews, sets default and deletes', async () => {
    const supabase = seed()
    const mcp = server(supabase, ALL)
    const created = parse(await mcp.callTool('email_templates_create', { name: 'Reminder', subject: 'Re: {{topic}}', html_body: '<p onload="x()">Hi {{name}}</p>' }))
    expect(created).toMatchObject({ created: true, email_template: { name: 'Reminder', html_body: '<p>Hi {{name}}</p>', is_default: false } })
    const id = created.email_template.id

    const list = parse(await mcp.callTool('email_templates_list', {}))
    expect(list.email_templates.map((row: { id: string }) => row.id).sort()).toEqual([id, 'tpl-default'].sort())

    const preview = parse(await mcp.callTool('email_templates_preview', { email_template_id: id, variables: { topic: 'Budget', name: 'Ana' } }))
    expect(preview.preview).toMatchObject({ subject: 'Re: Budget', html_body: '<p>Hi Ana</p>', text_body: 'Hi Ana' })

    const updated = parse(await mcp.callTool('email_templates_update', { email_template_id: id, is_default: true }))
    expect(updated).toMatchObject({ updated: true, email_template: { id, is_default: true } })

    const refused = await mcp.callTool('email_templates_delete', { email_template_id: id })
    expect(refused.isError).toBe(true)
    expect(refused.content[0].text).toContain('default')

    const deleted = parse(await mcp.callTool('email_templates_delete', { email_template_id: 'tpl-default' }))
    expect(deleted).toEqual({ deleted: true, email_template_id: 'tpl-default' })
    // Audited once, by the service (not again by the MCP authz wrapper).
    expect(vi.mocked(writeAudit).mock.calls.filter(([entry]) => entry.objectId === 'tpl-default')).toHaveLength(1)
  })

  it('gates mutations on workflows.* and reads/preview on workflows.view', async () => {
    const supabase = seed()
    const mcp = server(supabase, ['workflows.view'])
    const denied = await mcp.callTool('email_templates_create', { name: 'X', subject: 's', html_body: '<p>b</p>' })
    expect(denied.isError).toBe(true)
    expect(denied.content[0].text).toContain('workflows.create')
    const del = await mcp.callTool('email_templates_delete', { email_template_id: 'tpl-default' })
    expect(del.content[0].text).toContain('workflows.edit')

    const none = server(supabase, [])
    expect((await none.callTool('email_templates_get', { email_template_id: 'tpl-default' })).content[0].text).toContain('workflows.view')
    expect((await none.callTool('email_templates_preview', { email_template_id: 'tpl-default' })).isError).toBe(true)

    const readOnly = server(supabase, ['workflows.view'])
    expect(parse(await readOnly.callTool('email_templates_get', { email_template_id: 'tpl-default' })).email_template.id).toBe('tpl-default')
    expect((await readOnly.callTool('email_templates_preview', { email_template_id: 'tpl-default' })).isError).not.toBe(true)
    expect((await readOnly.callTool('email_templates_get', { email_template_id: 'tpl-b' })).isError).toBe(true)
  })
})
