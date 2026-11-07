/**
 * CSV import / export end to end against a LOCAL Supabase stack
 * (EVENT_STREAM_DB_URL + the local service-role key): plan writes nothing,
 * apply writes attributes, managers (including a swap that is only valid
 * once both rows apply), CSV org units and teams; a re-import is all
 * unchanged; export round-trips; org.manage is required.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'
import type { ServiceContext } from '@/lib/services/context'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `0c5c0000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const TENANT = id(0xa)
// Distinct first 8 characters: personal workspaces are slugged personal-<first 8 of the id>.
const CEO = '0c5c0001-0000-4000-8000-000000000001'
const CTO = '0c5c0002-0000-4000-8000-000000000002'
const DEV = '0c5c0003-0000-4000-8000-000000000003'
const USERS = [CEO, CTO, DEV]
const tag = Math.random().toString(36).slice(2, 8)
// Distinct domains: the auth trigger derives each personal workspace's slug from the address.
const email = (u: string) => { const who = u === CEO ? 'ceo' : u === CTO ? 'cto' : 'dev'; return `${who}@${who}-${tag}.orgimport.test` }

describe.skipIf(!DB_URL)('org CSV import (local stack)', () => {
  const pg = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const ctx = (perms: string[]): ServiceContext => ({
    db: admin as any, supabase: admin as any, tenantId: TENANT, actorId: CEO, permissions: new Set(perms), authKind: 'api_key', source: 'api',
  })

  async function cleanup() {
    await pg.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
    await pg.query('DELETE FROM auth.users WHERE id = ANY($1)', [USERS])
    await pg.query(`DELETE FROM public.tenants WHERE slug = ANY($1)`, [USERS.map((u) => `personal-${u.slice(0, 8)}`)])
  }

  beforeAll(async () => {
    await pg.connect()
    await cleanup()
    await pg.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Org Import', $2)`, [TENANT, `org-import-${tag}`])
    for (const u of USERS) {
      await pg.query(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [u, email(u)])
      await pg.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [u, TENANT])
    }
    // cto → ceo today.
    await pg.query(`UPDATE public.user_memberships SET manager_user_id = $1 WHERE tenant_id = $2 AND user_id = $3`, [CEO, TENANT, CTO])
  }, 30_000)

  afterAll(async () => {
    await cleanup()
    await pg.end()
  })

  const csv = () => [
    'Email,Manager,Title,Dept,Division,Team',
    `${email(CEO)},${email(CTO)},Chief Executive,,,Leadership`,
    `${email(CTO)},-,CTO,Engineering,Product,Leadership; Platform`,
    `${email(DEV)},${email(CTO)},Engineer,Engineering,Product,Platform`,
    `stranger.${tag}@orgimport.test,,,,,`,
  ].join('\n')

  it('needs org.manage', async () => {
    const { planOrgCsvImport } = await import('@/lib/services/org-import')
    await expect(planOrgCsvImport(ctx(['org.view']), { csv: csv() })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('plans without writing, then applies', async () => {
    const { planOrgCsvImport, applyOrgCsvImport } = await import('@/lib/services/org-import')
    const plan = await planOrgCsvImport(ctx(['org.manage', 'org.view']), { csv: csv() })
    expect(plan.summary).toMatchObject({ total: 4, update: 1, create: 2, errors: 1 })
    expect(plan.cycles).toEqual([])
    expect(plan.org_units.create).toEqual(['Product', 'Product / Engineering'])
    expect(plan.teams.create.sort()).toEqual(['Leadership', 'Platform'])
    const { rows: before } = await pg.query('SELECT count(*)::int AS n FROM public.org_units WHERE tenant_id = $1', [TENANT])
    expect(before[0].n).toBe(0)

    const result = await applyOrgCsvImport(ctx(['org.manage', 'org.view']), { csv: csv() })
    expect(result.summary.errors).toBe(1)
    expect(result).toMatchObject({ people_updated: 3, managers_changed: 3, units_created: 2, teams_created: 2, team_memberships_added: 4 })

    const { rows: members } = await pg.query(
      'SELECT user_id, manager_user_id, manager_source, job_title, department, profile_source FROM public.user_memberships WHERE tenant_id = $1 ORDER BY user_id', [TENANT])
    const m = Object.fromEntries(members.map((r: any) => [r.user_id, r]))
    expect(m[CEO]).toMatchObject({ manager_user_id: CTO, manager_source: 'manual', job_title: 'Chief Executive', profile_source: 'manual' })
    expect(m[CTO]).toMatchObject({ manager_user_id: null, department: 'Engineering' })
    expect(m[DEV]).toMatchObject({ manager_user_id: CTO })

    const { rows: units } = await pg.query(
      `SELECT u.name, u.kind, u.source, u.external_id, p.name AS parent FROM public.org_units u LEFT JOIN public.org_units p ON p.id = u.parent_id WHERE u.tenant_id = $1 ORDER BY u.name`, [TENANT])
    expect(units).toEqual([
      { name: 'Engineering', kind: 'department', source: 'csv', external_id: 'division:product/department:engineering', parent: 'Product' },
      { name: 'Product', kind: 'division', source: 'csv', external_id: 'division:product', parent: null },
    ])
    const { rows: unitMembers } = await pg.query(`SELECT count(*)::int AS n FROM public.org_unit_members WHERE tenant_id = $1 AND source = 'csv' AND is_primary`, [TENANT])
    expect(unitMembers[0].n).toBe(2)
  })

  it('re-import and export round trip are unchanged', async () => {
    const { planOrgCsvImport, exportOrgCsv } = await import('@/lib/services/org-import')
    const again = await planOrgCsvImport(ctx(['org.manage', 'org.view']), { csv: csv() })
    expect(again.summary).toMatchObject({ update: 0, create: 0, unchanged: 3, errors: 1 })
    const exported = await exportOrgCsv(ctx(['org.view']))
    expect(exported.rows).toBe(3)
    expect(exported.filename).toMatch(/^org-structure-org-import-/)
    const roundTrip = await planOrgCsvImport(ctx(['org.manage', 'org.view']), { csv: exported.csv })
    expect(roundTrip.summary).toMatchObject({ total: 3, unchanged: 3 })
  })
})
