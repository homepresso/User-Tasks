/**
 * SQL-level checks for supabase/migrations/20261103300000_brand_email_template.sql:
 * new workspaces get the branded default template; existing workspaces whose
 * default is still one of the historical untouched defaults are upgraded;
 * edited templates are left alone; re-running the migration changes nothing.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/brand-email-template-db.test.ts
 * Everything runs inside one transaction that is rolled back (including the
 * function replacement), so the stack is left as it was.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const MIGRATION = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261103300000_brand_email_template.sql'), 'utf8')
const NEW_HTML = /\$tpl\$([\s\S]*?)\$tpl\$/.exec(MIGRATION)![1]

// The historical untouched defaults, verbatim from the pre-baseline migrations.
/** 20260721_email_templates.sql backfill. */
const OLD_HTML_A = "<!doctype html><html><body style=\"margin:0;background:#f4f7f8;font-family:Inter,Arial,sans-serif;color:#17212b\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f4f7f8;padding:32px 16px\"><tr><td align=\"center\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:620px;background:#ffffff;border:1px solid #dce7e7;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,118,110,.10)\"><tr><td style=\"padding:24px 30px;background:linear-gradient(135deg,#0f766e,#14b8a6);color:#ffffff\"><div style=\"font-size:22px;font-weight:800;letter-spacing:-.4px\">user<span style=\"color:#ccfbf1\">tasks</span></div><div style=\"margin-top:8px;font-size:13px;opacity:.9\">Work that moves forward</div></td></tr><tr><td style=\"padding:34px 30px\"><div style=\"display:inline-block;padding:6px 10px;border-radius:999px;background:#ccfbf1;color:#0f766e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px\">Action required</div><h1 style=\"margin:18px 0 10px;font-size:26px;line-height:1.25;color:#17212b\">{{user_task_title}}</h1><p style=\"margin:0 0 24px;font-size:15px;line-height:1.7;color:#52606d\">{{user_task_description}}</p><a href=\"{{app_url}}/tasks/{{user_task_id}}\" style=\"display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700\">Open task</a></td></tr><tr><td style=\"padding:18px 30px;border-top:1px solid #e7eeee;color:#7a8a97;font-size:11px;line-height:1.5\">This message was sent by a UserTasks workflow. If the button does not work, open UserTasks and visit your task queue.</td></tr></table></td></tr></table></body></html>"
/** 20260722_email_template_defaults.sql backfill. */
const OLD_HTML_B = "<!doctype html><html><body style=\"margin:0;background:#f4f7f8;font-family:Inter,Arial,sans-serif;color:#17212b\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f4f7f8;padding:32px 16px\"><tr><td align=\"center\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:620px;background:#ffffff;border:1px solid #dce7e7;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,118,110,.10)\"><tr><td style=\"padding:24px 30px;background:#0f766e;color:#ffffff\"><div style=\"font-size:22px;font-weight:800;letter-spacing:-.4px\">user<span style=\"color:#ccfbf1\">tasks</span></div><div style=\"margin-top:8px;font-size:13px;opacity:.9\">Work that moves forward</div></td></tr><tr><td style=\"padding:34px 30px\"><div style=\"display:inline-block;padding:6px 10px;border-radius:999px;background:#ccfbf1;color:#0f766e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px\">Action required</div><h1 style=\"margin:18px 0 10px;font-size:26px;line-height:1.25;color:#17212b\">{{user_task_title}}</h1><p style=\"margin:0 0 24px;font-size:15px;line-height:1.7;color:#52606d\">{{user_task_description}}</p><a href=\"{{app_url}}/tasks/{{user_task_id}}\" style=\"display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700\">Open task</a></td></tr><tr><td style=\"padding:18px 30px;border-top:1px solid #e7eeee;color:#7a8a97;font-size:11px;line-height:1.5\">This message was sent by a UserTasks workflow. If the button does not work, open UserTasks and visit your task queue.</td></tr></table></td></tr></table></body></html>"
/** create_default_email_template_for_tenant() up to this migration. */
const OLD_HTML_C = "<div style=\"background:#f4f7f8;padding:32px 16px;font-family:Inter,Arial,sans-serif\"><div style=\"max-width:620px;margin:auto;background:#fff;border:1px solid #dce7e7;border-radius:18px;overflow:hidden\"><div style=\"padding:24px 30px;background:#0f766e;color:#fff;font-size:22px;font-weight:800\">user<span style=\"color:#ccfbf1\">tasks</span></div><div style=\"padding:34px 30px\"><h1 style=\"color:#17212b\">{{user_task_title}}</h1><p style=\"color:#52606d;line-height:1.7\">{{user_task_description}}</p><a href=\"{{app_url}}/tasks/{{user_task_id}}\" style=\"display:inline-block;padding:13px 22px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700\">Open task</a></div></div></div>"
/** 20260721 used a standard string: a literal backslash-n. */
const OLD_TEXT_LITERAL = 'Action needed: {{user_task_title}}\\n\\n{{user_task_description}}\\n\\nOpen UserTasks to review task {{user_task_id}}.'
const TEXT = 'Action needed: {{user_task_title}}\n\n{{user_task_description}}\n\nOpen UserTasks to review task {{user_task_id}}.'

const T = {
  a: '0e000000-0000-4000-8000-0000000000a1',
  b: '0e000000-0000-4000-8000-0000000000b1',
  c: '0e000000-0000-4000-8000-0000000000c1',
  custom: '0e000000-0000-4000-8000-0000000000d1',
  customText: '0e000000-0000-4000-8000-0000000000e1',
  fresh: '0e000000-0000-4000-8000-0000000000f1',
}
const COPY_ID = '0e000010-0000-4000-8000-000000000001'

describe.skipIf(!DB_URL)('brand email template migration (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const def = async (tenant: string) =>
    (await db.query<{ name: string; description: string; subject: string; html_body: string; text_body: string; updated_at: Date }>(
      `SELECT name, description, subject, html_body, text_body, updated_at FROM public.email_templates WHERE tenant_id = $1 AND is_default`, [tenant],
    )).rows[0]
  const setDefault = (tenant: string, html: string, text: string) =>
    db.query(`UPDATE public.email_templates SET html_body = $2, text_body = $3, updated_at = '2026-01-01' WHERE tenant_id = $1 AND is_default`, [tenant, html, text])

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    const pre = Object.entries(T).filter(([k]) => k !== 'fresh')
    for (const [key, id] of pre) {
      await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, $2, $3)`, [id, `Brand ${key}`, `brand-email-${key.toLowerCase()}`])
    }
    // Whatever the stack's trigger seeded, pin each default to a known state.
    await setDefault(T.a, OLD_HTML_A, OLD_TEXT_LITERAL)
    await setDefault(T.b, OLD_HTML_B, TEXT)
    await setDefault(T.c, OLD_HTML_C, TEXT)
    await setDefault(T.custom, OLD_HTML_C.replace('Open task', 'Review now'), TEXT)
    await setDefault(T.customText, OLD_HTML_C, 'Custom text {{user_task_id}}')
    // A non-default copy of the old default is not "the default template".
    await db.query(
      `INSERT INTO public.email_templates (id, tenant_id, name, subject, html_body, text_body, is_default) VALUES ($1, $2, 'Copy', 's', $3, $4, false)`,
      [COPY_ID, T.c, OLD_HTML_C, TEXT],
    )
    await db.query(MIGRATION)
  })

  afterAll(async () => {
    await db.query('ROLLBACK')
    await db.end()
  })

  it('upgrades each historical untouched default and normalises its text body', async () => {
    for (const tenant of [T.a, T.b, T.c]) {
      const row = await def(tenant)
      expect(row.html_body).toBe(NEW_HTML)
      expect(row.text_body).toBe(TEXT)
      expect(row.name).toBe('UserTasks Default')
      expect(row.subject).toBe('Action needed: {{user_task_title}}')
      expect(row.updated_at.getTime()).toBeGreaterThan(new Date('2026-01-02').getTime())
    }
  })

  it('leaves customised templates and non-default copies unchanged', async () => {
    expect((await def(T.custom)).html_body).toBe(OLD_HTML_C.replace('Open task', 'Review now'))
    const customText = await def(T.customText)
    expect(customText.html_body).toBe(OLD_HTML_C)
    expect(customText.text_body).toBe('Custom text {{user_task_id}}')
    const { rows } = await db.query(`SELECT html_body FROM public.email_templates WHERE id = $1`, [COPY_ID])
    expect(rows[0].html_body).toBe(OLD_HTML_C)
  })

  it('seeds a new workspace with the branded default', async () => {
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Brand fresh', 'brand-email-fresh')`, [T.fresh])
    const row = await def(T.fresh)
    expect(row).toMatchObject({
      name: 'UserTasks Default',
      description: 'A polished UserTasks-branded email for workflow messages and task assignments.',
      subject: 'Action needed: {{user_task_title}}',
      html_body: NEW_HTML,
      text_body: TEXT,
    })
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.email_templates WHERE tenant_id = $1 AND is_default`, [T.fresh])
    expect(rows[0].n).toBe(1)
  })

  it('is a no-op when re-run', async () => {
    const snapshot = async () =>
      // ctid moves on any UPDATE, even one that writes identical values.
      (await db.query(`SELECT id, ctid::text, html_body, text_body, updated_at FROM public.email_templates WHERE tenant_id = ANY($1) ORDER BY id`, [Object.values(T)])).rows
    const before = await snapshot()
    await db.query('SAVEPOINT rerun')
    await db.query(MIGRATION)
    expect(await snapshot()).toEqual(before)
    await db.query('RELEASE SAVEPOINT rerun')
  })
})
