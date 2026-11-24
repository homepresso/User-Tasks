/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ success: true, id: 'msg-1' })) }))
vi.mock('@/lib/providers/email', () => ({ getEmailProviderWithOptions: vi.fn(async () => ({ provider: { id: 'console' }, options: {} })) }))

import { writeAudit } from '@/lib/audit-log'
import { sendEmail } from '@/lib/email'
import type { ServiceContext } from '@/lib/services/context'
import * as templates from '@/lib/services/email-templates'
import { prepareTemplateHtml } from '@/lib/email-editor/save'
import { validateNode } from '@/lib/workflow-validation'
import { unmappedTemplateVariables, validateWorkflowWiring } from '@/lib/workflow-wiring'
import { previewValueFor } from '@/components/automations/email-template-mapping'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ALL = ['workflows.view', 'workflows.create', 'workflows.edit']

function seed() {
  return createMemorySupabase({
    email_templates: [{
      id: 'tpl-1', tenant_id: 'tenant-a', name: 'Approval', description: null, is_default: true,
      subject: 'Approval: {{request_title}}', html_body: '<p>{{requester}} asks — <a href="{{task_url}}">open</a></p>', text_body: 'x',
      variables: [{ name: 'request_title', label: 'Request', required: true, sample: 'Laptop' }],
      created_at: '2026-01-01', updated_at: '2026-01-01',
    }],
    users: [{ id: 'user-1', email: 'me@example.com' }, { id: 'user-2', email: 'two@example.com' }, { id: 'user-3', email: 'three@example.com' }, { id: 'user-noemail', email: null }],
  })
}

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[] = ALL, actorId: string | null = 'user-1'): ServiceContext {
  return { supabase: supabase as unknown as ServiceContext['supabase'], tenantId: 'tenant-a', actorId, permissions: new Set(permissions), authKind: 'session', source: 'ui' } as ServiceContext
}

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(sendEmail).mockClear()
  vi.mocked(sendEmail).mockResolvedValue({ success: true, id: 'msg-1' })
})

describe('email template variables in the service', () => {
  it('keeps declarations for used variables on save; undeclared names are detected, not stored', async () => {
    const supabase = seed()
    const created = await templates.createEmailTemplate(context(supabase), {
      name: 'Digest', subject: 'Summary for {{period}}', html_body: '<p>{{open_count}} open — {{user_task_title}} {{form.x}}</p>',
      variables: [{ name: 'period', label: 'Period', required: true }, { name: 'stale', label: 'Gone' }],
    })
    expect(created.variables).toEqual([{ name: 'period', label: 'Period', required: true }])
    expect((await templates.getEmailTemplateVariables(context(supabase), created.id)).variables.map((v) => v.name)).toEqual(['period', 'open_count', 'user_task_title', 'form.x'])
    expect(supabase.tables.email_templates.find((r) => r.id === created.id)?.variables).toEqual(created.variables)
  })

  it('a content update re-detects and keeps stored declarations', async () => {
    const supabase = seed()
    const updated = await templates.updateEmailTemplate(context(supabase), 'tpl-1', { html_body: '<p>{{request_title}} by {{owner}}</p>' })
    expect(updated.variables).toEqual([{ name: 'request_title', label: 'Request', required: true, sample: 'Laptop' }])
  })

  it('serves the merged variable list for the workflow designer', async () => {
    const result = await templates.getEmailTemplateVariables(context(seed()), 'tpl-1')
    expect(result.variables.map((v) => [v.name, v.source, !!v.required])).toEqual([
      ['request_title', 'custom', true], ['requester', 'custom', false], ['task_url', 'auto', false],
    ])
  })

  it('treats a database without the variables column as having no declarations', async () => {
    const supabase = seed()
    const original = supabase.from.bind(supabase)
    ;(supabase as any).from = (table: string) => {
      const query = original(table)
      const select = query.select.bind(query)
      const update = query.update.bind(query)
      query.select = (columns: string, ...rest: unknown[]) => (columns === 'id, variables'
        ? { eq: () => ({ in: async () => ({ data: null, error: { code: '42703', message: 'column email_templates.variables does not exist' } }) }) }
        : select(columns, ...rest))
      query.update = (values: Record<string, unknown>) => ('variables' in values && Object.keys(values).length === 1
        ? { eq: () => ({ eq: async () => ({ error: { code: 'PGRST204', message: "Could not find the 'variables' column" } }) }) }
        : update(values))
      return query
    }
    const ctx = context(supabase)
    await expect(templates.getEmailTemplate(ctx, 'tpl-1')).resolves.toMatchObject({ variables: [] })
    const created = await templates.createEmailTemplate(ctx, { name: 'N', subject: '{{a}}', html_body: '<p>b</p>' })
    expect(created.variables).toEqual([])
  })
})

describe('save: inliner then sanitiser', () => {
  it('inlines <style> rules and strips active content', () => {
    const out = prepareTemplateHtml('<style>p{color:#111}</style><p onclick="x()">Hi</p><script>bad()</script>', { inline: true })
    expect(out.html).toBe('<p style="color:#111">Hi</p>')
    expect(out.inlined).toBe(1)
  })

  it('without inlining only sanitises', () => {
    expect(prepareTemplateHtml('<style>p{color:#111}</style><p>Hi</p>', { inline: false }).html).toBe('<style>p{color:#111}</style><p>Hi</p>')
  })
})

describe('send test email', () => {
  const draft = { name: 'Approval', subject: 'Approval: {{request_title}}', html_body: '<p onclick="x()">{{request_title}}</p>', variables: { request_title: 'Laptop' } }

  it('sends the rendered, sanitised draft to the signed-in person only, and audits', async () => {
    const result = await templates.sendEmailTemplateTest(context(seed()), { ...draft, template_id: 'tpl-1' })
    expect(result).toMatchObject({ sent: true, to: 'me@example.com' })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'me@example.com', subject: '[Test] Approval: Laptop', body: '<p>Laptop</p>' }))
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'email_template', objectId: 'tpl-1', action: 'test_send' }))
  })

  it('needs workflows.create or workflows.edit and a person', async () => {
    await expect(templates.sendEmailTemplateTest(context(seed(), ['workflows.view']), draft)).rejects.toMatchObject({ status: 403 })
    await expect(templates.sendEmailTemplateTest(context(seed(), ALL, null), draft)).rejects.toMatchObject({ status: 400 })
    await expect(templates.sendEmailTemplateTest(context(seed(), ALL, 'user-noemail'), draft)).rejects.toMatchObject({ status: 400 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('is rate-limited per person', async () => {
    const ctx = context(seed(), ALL, 'user-2')
    for (let i = 0; i < templates.TEST_SEND_LIMITS.perActor.max; i++) await templates.sendEmailTemplateTest(ctx, draft)
    await expect(templates.sendEmailTemplateTest(ctx, draft)).rejects.toMatchObject({ status: 429, code: 'rate_limited' })
    expect(sendEmail).toHaveBeenCalledTimes(templates.TEST_SEND_LIMITS.perActor.max)
  })

  it('reports provider errors in friendly terms with the raw detail', async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: 'The example.com domain is not verified. Please, add and verify your domain on https://resend.com/domains' })
    const result = await templates.sendEmailTemplateTest(context(seed(), ALL, 'user-3'), draft)
    expect(result).toMatchObject({ sent: false, error: expect.stringContaining('not verified'), detail: expect.stringContaining('resend.com/domains') })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'test_send', metadata: expect.objectContaining({ success: false }) }))
  })

  it('maps common provider failures', () => {
    expect(templates.friendlyEmailError('Email service not configured. Set RESEND_API_KEY in .env.local')).toMatch(/not set up/)
    expect(templates.friendlyEmailError('API key is invalid')).toMatch(/credentials/)
    expect(templates.friendlyEmailError('connect ECONNREFUSED 127.0.0.1:25')).toMatch(/reach the mail server/)
    expect(templates.friendlyEmailError('Too many requests')).toMatch(/limiting/)
  })
})

describe('workflow steps using a template', () => {
  const snapshot = [
    { name: 'request_title', label: 'Request', source: 'custom', required: true },
    { name: 'amount', label: 'Amount', source: 'custom' },
    { name: 'task_url', label: 'Task link', source: 'auto' },
  ]
  const sendEmailNode = (config: Record<string, unknown>) => ({ id: 'mail', type: 'send_email', label: 'Mail', position: { x: 0, y: 0 }, config: { to: 'a@example.com', email_template_id: 'tpl-1', ...config } }) as any

  it('validation: a required template variable needs a mapping; older steps (no snapshot) are unchanged', () => {
    expect(validateNode(sendEmailNode({ _template_variables: snapshot }))).toEqual(['Template variable "Request" needs a value'])
    expect(validateNode(sendEmailNode({ _template_variables: snapshot, template_variables: { request_title: '{{form.title}}' } }))).toEqual([])
    expect(validateNode(sendEmailNode({}))).toEqual([])
    const task = { id: 't', type: 'user_task', label: 'Approve', position: { x: 0, y: 0 }, config: { task_title: 'x', assignee_id: 'u', notification_template_id: 'tpl-1', _notification_template_variables: snapshot } } as any
    expect(validateNode(task)).toContain('Notification template variable "Request" needs a value')
  })

  it('wiring: unmapped custom variables the run does not set are warned about; same-named run values count as mapped', () => {
    const trigger = { id: 'trg', type: 'form_submitted', label: 'Form', position: { x: 0, y: 0 }, config: { form_id: 'f', fields: [{ key: 'amount', label: 'Amount', type: 'number' }] } }
    const mail = sendEmailNode({ _template_variables: snapshot, template_variables: { request_title: 'Laptop' } })
    const warnings = validateWorkflowWiring({ nodes: [trigger, mail], edges: [{ source: 'trg', target: 'mail' }] }).filter((w) => w.kind === 'template_variable')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ key: 'template_variables.amount', suggestion: '{{form.amount}}' })
    expect(unmappedTemplateVariables(mail).map((v) => v.name)).toEqual(['amount'])
    const mapped = sendEmailNode({ _template_variables: snapshot, template_variables: { request_title: 'Laptop', amount: '{{form.amount}}' } })
    expect(validateWorkflowWiring({ nodes: [trigger, mapped], edges: [{ source: 'trg', target: 'mail' }] }).filter((w) => w.kind === 'template_variable')).toEqual([])
  })

  it('mapping preview: literal text as written, expressions as samples', () => {
    expect(previewValueFor({ name: 'a', label: 'A', sample: 'S' }, 'Literal')).toBe('Literal')
    expect(previewValueFor({ name: 'a', label: 'A', sample: 'S' }, '{{form.a}}')).toBe('S')
    expect(previewValueFor({ name: 'a', label: 'A' }, '{{form.a}}')).toBe('[form.a]')
    expect(previewValueFor({ name: 'a', label: 'A' }, undefined)).toBe('[A]')
  })
})
