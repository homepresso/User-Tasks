/**
 * The branded default email template seeded by
 * supabase/migrations/20261103300000_brand_email_template.sql: the HTML
 * survives the sanitiser untouched, keeps the old default's placeholders, and
 * renders through the template preview (workflow resolver).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { normalizeEmailTemplateContent, sanitizeEmailHtml } from '@/lib/email-templates'
import type { ServiceContext } from '@/lib/services/context'
import * as templates from '@/lib/services/email-templates'
import { createMemorySupabase } from './fixtures/supabase-memory'

const MIGRATION = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261103300000_brand_email_template.sql'), 'utf8')
const copies = [...MIGRATION.matchAll(/\$tpl\$([\s\S]*?)\$tpl\$/g)].map((m) => m[1])
const HTML = copies[0]
const TEXT = 'Action needed: {{user_task_title}}\n\n{{user_task_description}}\n\nOpen UserTasks to review task {{user_task_id}}.'

describe('branded default email template', () => {
  it('uses one HTML for new workspaces (trigger) and existing ones (update)', () => {
    expect(copies).toHaveLength(2)
    expect(copies[1]).toBe(HTML)
  })

  it('keeps every placeholder of the old default and the new brand', () => {
    for (const v of ['{{app_url}}', '{{user_task_title}}', '{{user_task_description}}', '{{user_task_id}}']) expect(HTML).toContain(v)
    expect(HTML).toContain('href="{{app_url}}/tasks/{{user_task_id}}"')
    expect(HTML).toMatch(/<img src="\{\{app_url\}\}\/brand\/mark-192\.png"[^>]* alt="UserTasks logo"/)
    expect(HTML).toContain('user<span style="color:#C7A575;">tasks</span>')
    expect(HTML).toContain('@media (prefers-color-scheme: dark)')
    expect(HTML).not.toMatch(/0f766e|ccfbf1|14b8a6/i)
    // No `{{` beyond the four variables (CSS braces must never form one).
    expect(HTML.replace(/\{\{(app_url|user_task_title|user_task_description|user_task_id)\}\}/g, '')).not.toContain('{{')
    expect(MIGRATION).toContain(`E'${TEXT.replaceAll('\n', '\\n')}'`)
  })

  it('passes the sanitiser and import normalisation unchanged', () => {
    expect(sanitizeEmailHtml(HTML)).toBe(HTML)
    const normalized = normalizeEmailTemplateContent({ name: 'UserTasks Default', subject: 'Action needed: {{user_task_title}}', html_body: HTML, text_body: TEXT })
    expect(normalized.html_body).toBe(HTML)
    expect(normalized.text_body).toBe(TEXT)
  })

  it('renders in the template preview with variables', async () => {
    const supabase = createMemorySupabase({ email_templates: [] })
    const ctx: ServiceContext = {
      supabase: supabase as unknown as ServiceContext['supabase'],
      tenantId: 'tenant-a',
      actorId: 'user-1',
      permissions: new Set(['workflows.view', 'workflows.create', 'workflows.edit']),
      authKind: 'api_key',
      source: 'api',
    }
    const created = await templates.createEmailTemplate(ctx, { name: 'UserTasks Default', subject: 'Action needed: {{user_task_title}}', html_body: HTML, text_body: TEXT })
    expect(created.html_body).toBe(HTML)

    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example')
    try {
      const preview = await templates.previewEmailTemplate(ctx, created.id, {
        variables: { user_task_title: 'Approve PO', user_task_description: 'Check the totals.', user_task_id: 't-42' },
      })
      expect(preview.subject).toBe('Action needed: Approve PO')
      expect(preview.html_body).not.toContain('{{')
      expect(preview.html_body).toContain('<img src="https://app.example/brand/mark-192.png"')
      expect(preview.html_body).toContain('href="https://app.example/tasks/t-42"')
      expect(preview.html_body).toContain('>Approve PO</h1>')
      expect(preview.html_body).toContain('>Check the totals.</p>')
      expect(preview.html_body).toContain('@media (prefers-color-scheme: dark) {')
      expect(preview.text_body).toBe('Action needed: Approve PO\n\nCheck the totals.\n\nOpen UserTasks to review task t-42.')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
