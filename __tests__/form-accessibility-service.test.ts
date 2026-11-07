/* eslint-disable @typescript-eslint/no-explicit-any -- memory table rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { createMcpServer } from '@/lib/mcp/server'
import type { ServiceContext } from '@/lib/services/context'
import * as forms from '@/lib/services/forms'
import { checkFormAccessibilityFor, setFormAccessibilitySettings, getFormAccessibilitySettings } from '@/lib/services/form-accessibility'
import { formAccessibilityReportJob } from '@/lib/user-jobs/kinds/forms'
import { getJobKind, isUiJobKind } from '@/lib/user-jobs/kinds'
import { POST as checkRoute } from '@/app/api/v1/forms/[id]/accessibility/route'
import { checkFormAccessibilityEndpoint } from '@/lib/api-schemas/forms'
import { READ_TOOL_PERMISSIONS } from '@/lib/mcp/authz'
import { SURFACE_PARITY } from '@/lib/surface-parity'
import { REPORT_COLUMNS } from '@/lib/forms/accessibility/report'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = 'tenant-a'
const FORM = '44444444-4444-4444-8444-444444444444'
const GOOD = [
  { key: 'reason', label: 'Reason', type: 'textarea' },
  { key: 'days', label: 'Days', type: 'number' },
]
const HEADER = { enabled: true, image: 'none', title: 'Leave' }
const POOR = [
  { key: 'field_1', label: '', type: 'text' },
  { key: 'field_2', label: '', type: 'text', placeholder: 'Email' },
  { key: 'first_name', label: 'First name', type: 'text' },
  { key: 'code', label: 'Code', type: 'text', pattern: '^[A-Z]+$' },
  { key: 'field_3', label: '', type: 'number' },
  { key: 'heading_1', label: '', type: 'heading' },
  { key: 'postcode', label: 'Postcode', type: 'text' },
  { key: 'email_address', label: 'Email address', type: 'text' },
]

function seed(mode?: 'off' | 'warn' | 'block', min = 80) {
  return createMemorySupabase({
    tenants: [{ id: TENANT, name: 'A', settings: mode ? { other: 1, forms: { accessibility: { mode, min_score: min } } } : { other: 1 } }],
    forms: [{ id: FORM, tenant_id: TENANT, name: 'Leave', description: null, tags: [], fields: POOR, layout: null, theme: { source: 'workspace' }, buttons: null, header: HEADER, version: 3, created_at: '2026-01-01', updated_at: '2026-01-01' }],
    form_versions: [],
    form_themes: [],
    workspace_themes: [],
    workflows: [],
    workflow_versions: [],
  }, { uuids: true })
}

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions = ['forms.view', 'forms.edit', 'forms.delete', 'settings.edit']): ServiceContext {
  return { supabase: supabase as any, tenantId: TENANT, actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

describe('pre-publish gate in the forms service', () => {
  it('block: refuses a create below min_score with its top findings; a clean form saves', async () => {
    const supabase = seed('block')
    const err = await forms.createForm(context(supabase), { name: 'Poor', fields: POOR, header: HEADER }).catch((e) => e)
    expect(err).toMatchObject({ code: 'validation_error', status: 400 })
    expect(err.message).toMatch(/Accessibility score \d+ is below this workspace's minimum of 80/)
    expect(err.message).toContain('field_1')
    expect(err.details.accessibility.findings.length).toBeGreaterThan(0)
    expect(supabase.tables.forms).toHaveLength(1)
    const ok = await forms.createForm(context(supabase), { name: 'Good', fields: GOOD, header: HEADER })
    expect(ok.name).toBe('Good')
  })

  it('block: refuses a content update below min_score but not a rename', async () => {
    const supabase = seed('block')
    await expect(forms.updateForm(context(supabase), FORM, { fields: [...POOR, { key: 'x', label: 'X', type: 'text' }] })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(forms.updateForm(context(supabase), FORM, { name: 'Renamed' })).resolves.toMatchObject({ name: 'Renamed' })
  })

  it('warn / off / unset: saves whatever the score', async () => {
    for (const mode of ['warn', 'off', undefined] as const) {
      const supabase = seed(mode)
      await expect(forms.createForm(context(supabase), { name: `Poor ${mode}`, fields: POOR })).resolves.toMatchObject({ version: 1 })
    }
  })

  it('config-as-code / package imports skip the gate', async () => {
    const supabase = seed('block')
    await expect(forms.applyFormManifest(context(supabase), { name: 'Imported', fields: POOR }, null)).resolves.toMatchObject({ name: 'Imported' })
  })

  it('a low min_score lets a poor form through', async () => {
    const supabase = seed('block', 0)
    await expect(forms.createForm(context(supabase), { name: 'Poor', fields: POOR })).resolves.toMatchObject({ version: 1 })
  })
})

describe('workspace setting', () => {
  it('reads defaults, saves with settings.edit (merged into tenants.settings) and validates', async () => {
    const supabase = seed()
    expect(await getFormAccessibilitySettings(context(supabase))).toEqual({ mode: 'warn', min_score: 80 })
    await expect(setFormAccessibilitySettings(context(supabase, ['forms.view']), { mode: 'block' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setFormAccessibilitySettings(context(supabase), { mode: 'strict' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(setFormAccessibilitySettings(context(supabase), { min_score: 101 })).rejects.toMatchObject({ code: 'validation_error' })
    expect(await setFormAccessibilitySettings(context(supabase), { mode: 'block', min_score: 90 })).toEqual({ mode: 'block', min_score: 90 })
    expect(supabase.tables.tenants[0].settings).toEqual({ other: 1, forms: { accessibility: { mode: 'block', min_score: 90 } } })
  })
})

describe('check endpoint / MCP tool / CLI contract', () => {
  beforeEach(() => vi.mocked(validateApiKey).mockReset())

  function authAs(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[]) {
    vi.mocked(validateApiKey).mockResolvedValue({
      success: true, tenantId: TENANT, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: [], table_ids: [] }, permissions,
      supabase: supabase as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    })
  }
  const req = (body?: unknown) => new NextRequest(`https://app.test/api/v1/forms/${FORM}/accessibility`, {
    method: 'POST', headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const params = { params: Promise.resolve({ id: FORM }) }

  it('POST /forms/{id}/accessibility returns the result for the saved form, or for a definition', async () => {
    authAs(seed('warn'), ['forms.view'])
    const res = await checkRoute(req({}), params)
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toMatchObject({ form_id: FORM, form_version: 3, checked: 'saved', policy: { mode: 'warn', min_score: 80, passes: false } })
    expect(data.score).toBeLessThan(80)
    expect(data.findings[0]).toEqual(expect.objectContaining({ id: expect.any(String), rule: expect.any(String), severity: expect.any(String), wcag: expect.any(Array), message: expect.any(String) }))

    authAs(seed('warn'), ['forms.view'])
    const clean = await (await checkRoute(req({ definition: { fields: GOOD, header: HEADER } }), params)).json()
    expect(clean.data).toMatchObject({ checked: 'definition', score: 100, findings: [], policy: { passes: true } })
  })

  it('403 without forms.view; 404 for another workspace\'s form', async () => {
    authAs(seed(), [])
    expect((await checkRoute(req({}), params)).status).toBe(403)
    authAs(seed(), ['forms.view'])
    expect((await checkRoute(req({}), { params: Promise.resolve({ id: '55555555-5555-4555-8555-555555555555' }) })).status).toBe(404)
  })

  it('MCP forms_check_accessibility is a forms.view read with the same result', async () => {
    const supabase = seed('block', 90)
    expect(READ_TOOL_PERMISSIONS.forms_check_accessibility).toBe('forms.view')
    const mcp = (permissions: string[]) => createMcpServer({ tenantId: TENANT, supabase, actingUserId: 'user-1', keyType: 'tenant', permissions })
    expect((await mcp([]).callTool('forms_check_accessibility', { form_id: FORM })).isError).toBe(true)
    const out = await mcp(['forms.view']).callTool('forms_check_accessibility', { form_id: FORM })
    expect(out.isError).toBeFalsy()
    const body = JSON.parse(out.content[0].text)
    expect(body).toMatchObject({ form_id: FORM, policy: { mode: 'block', min_score: 90, passes: false } })
    expect(body.findings.some((f: any) => f.rule === 'input-purpose' && f.fix?.patch?.autocomplete === 'given-name')).toBe(true)
    const direct = await checkFormAccessibilityFor(context(supabase), FORM)
    expect(body.score).toBe(direct.score)
  })

  it('is defined for the API, CLI and parity table', () => {
    expect(checkFormAccessibilityEndpoint).toMatchObject({ method: 'POST', path: '/forms/{id}/accessibility', permission: 'forms.view', cli: { resource: 'forms', verb: 'check-accessibility', positional: ['id'] } })
    const ops = SURFACE_PARITY.find((r) => r.resource === 'forms')!.ops
    expect(ops).toEqual(expect.arrayContaining([expect.objectContaining({ rest: 'POST /forms/{id}/accessibility', mcp: 'forms_check_accessibility', cli: 'forms check-accessibility' })]))
  })
})

describe('report job (form.accessibility_report)', () => {
  function runJob(supabase: ReturnType<typeof createMemorySupabase>, params: any, input?: unknown) {
    const ctx = context(supabase, ['forms.view'])
    return formAccessibilityReportJob.run({
      job: {} as any, ctx, params: formAccessibilityReportJob.params.parse(params), checkpoint: null,
      progress: async () => {}, saveCheckpoint: async () => {}, timeLeft: () => 60_000,
      readInput: async () => (input === undefined ? null : new TextEncoder().encode(JSON.stringify(input))),
      putPart: async () => {}, readParts: async () => [],
    }) as Promise<any>
  }

  it('is a UI job kind needing forms.view', () => {
    expect(getJobKind('form.accessibility_report')).toBe(formAccessibilityReportJob)
    expect(isUiJobKind('form.accessibility_report')).toBe(true)
    expect(() => formAccessibilityReportJob.authorize(context(seed(), []), { format: 'csv', name: 'x' })).toThrow()
  })

  it('CSV: one row per finding (checker + axe from the designer), formula-safe', async () => {
    const axe = { id: 'axe:region:#x', rule: 'axe-region', severity: 'moderate', wcag: ['1.3.1'], level: 'A', message: '=HYPERLINK("x")', help: 'h', source: 'axe', targets: ['#x'] }
    const out = await runJob(seed(), { format: 'csv', name: 'Leave form' }, { definition: { fields: POOR, header: HEADER }, extra_findings: [axe] })
    expect(out.file).toMatchObject({ name: 'Leave-form-accessibility.csv', contentType: 'text/csv; charset=utf-8' })
    const lines = String(out.file.body).trim().split('\r\n')
    expect(lines[0]).toBe(REPORT_COLUMNS.join(','))
    expect(lines.some((l) => l.startsWith('critical,label-missing') || l.startsWith('serious,label-missing'))).toBe(true)
    expect(lines.some((l) => l.includes("'=HYPERLINK"))).toBe(true)
    expect(lines.length - 1).toBe(out.counts.findings)
    expect(out.summary).toMatch(/^Score \d+\/100/)
  })

  it('PDF from a saved form: bytes start with %PDF', async () => {
    const out = await runJob(seed(), { format: 'pdf', name: 'Leave', form_id: FORM })
    expect(out.file.contentType).toBe('application/pdf')
    const bytes = out.file.body as Uint8Array
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('refuses input that is not a definition, and a job with neither input nor form', async () => {
    await expect(runJob(seed(), { format: 'csv', name: 'x' }, { nope: true })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(runJob(seed(), { format: 'csv', name: 'x' })).rejects.toMatchObject({ code: 'validation_error' })
  })
})
