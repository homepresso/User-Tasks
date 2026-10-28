/**
 * Reusable task forms and form themes against a LOCAL Supabase stack
 * (migration 20261115000000_forms.sql), through the service-role REST client:
 *  - tenant isolation: tenant B cannot read, update, duplicate or delete A's
 *    form or theme through the service, and end-user clients (role
 *    authenticated) cannot write the tables directly (42501);
 *  - config export (with_dependencies from a workflow) → apply into another
 *    tenant: the linked form and its saved theme (and the start form's saved
 *    theme on the trigger node) come along, every id is remapped, versions
 *    stay per workspace and published pins never reach a draft; a second dry
 *    run plans nothing;
 *  - a package built from the workflow carries the form and themes, installs
 *    into a third tenant with remapped ids, and uninstalls (workflow, then
 *    form, then themes).
 *
 * Runs only when EVENT_STREAM_DB_URL is set, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/forms-db.test.ts
 * API: LOCKDOWN_SUPABASE_URL / LOCKDOWN_SERVICE_ROLE_KEY, defaulting to the
 * standard local stack and its public demo key.
 */
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client } from 'pg'
import { createClient } from './helpers/db-test-client'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import * as forms from '@/lib/services/forms'
import { applyConfig, exportConfig } from '@/lib/services/config'
import { buildPackageVersion, createPackage, getPackageContents } from '@/lib/services/packages'
import { installPackage, uninstallPackage } from '@/lib/services/package-installs'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.LOCKDOWN_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.LOCKDOWN_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const id = (n: number) => `f0f0f500-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const A = id(0xa)
const B = id(0xb)
const C = id(0xc)
const WORKFLOW = id(0x101)
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const page = { limit: 50, offset: 0 }

const FIELDS = [
  { key: 'decision', label: 'Decision', type: 'choice', required: true, options: ['Approve', 'Reject'] },
  { key: 'comments', label: 'Comments', type: 'textarea' },
]

describe.skipIf(!DB_URL)('forms (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  const admin = createClient(API_URL, SERVICE_KEY, opts)
  const ctx = (tenantId: string, permissions: string[] | null = null): ServiceContext => ({ supabase: admin, tenantId, actorId: null, permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api' })
  const prev = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, signing: process.env.PACKAGE_SIGNING_KEY }
  let formId = ''
  let themeId = ''
  let startThemeId = ''

  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0]
  const rows = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows

  async function cleanup() {
    for (const t of [A, B, C]) {
      for (const table of ['package_installs', 'packages', 'workflow_runs', 'workflow_versions', 'workflows', 'forms', 'form_themes', 'object_audit_log', 'github_sync_asset_map', 'github_sync_queue', 'deletion_queue']) {
        await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [t]).catch(() => undefined)
      }
      await db.query('DELETE FROM public.tenants WHERE id = $1', [t])
    }
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = API_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY
    process.env.PACKAGE_SIGNING_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    await db.connect()
    await cleanup()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Forms A', 'forms-a-test'), ($2, 'Forms B', 'forms-b-test'), ($3, 'Forms C', 'forms-c-test')`, [A, B, C])

    themeId = (await forms.createFormTheme(ctx(A), { name: 'Forms brand', overrides: { radius: 10, density: 'compact' } })).id
    startThemeId = (await forms.createFormTheme(ctx(A), { name: 'Forms start', overrides: { radius: 4 } })).id
    const form = await forms.createForm(ctx(A), { name: 'Forms review', tags: ['finance'], fields: FIELDS, theme: { source: 'saved', theme_id: themeId } })
    formId = form.id
    // Version 2 in A: versions never travel, B starts at 1.
    await forms.updateForm(ctx(A), formId, { fields: [...FIELDS, { key: 'amount', label: 'Amount', type: 'number' }] })

    const nodes = [
      { id: 'trigger', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: { start_form: { layout: null, theme: { source: 'saved', theme_id: startThemeId } } } },
      { id: 'review', type: 'user_task', label: 'Review', position: { x: 0, y: 100 }, config: { title: 'Review', form_id: formId, form_name: 'Forms review', fields: FIELDS } },
    ]
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type, trigger_config, nodes, edges, is_active) VALUES ($1, $2, 'Forms approval', 'manual', '{}', $3, $4, false)`,
      [WORKFLOW, A, JSON.stringify(nodes), JSON.stringify([{ id: 'e1', source: 'trigger', target: 'review' }])])
  }, 60_000)

  afterAll(async () => {
    await cleanup().catch(() => undefined)
    await db.end()
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key
    process.env.PACKAGE_SIGNING_KEY = prev.signing
  })

  it('keeps each workspace to its own forms and themes through the service', async () => {
    const other = ctx(B)
    expect((await forms.listForms(other, {}, page)).forms).toEqual([])
    expect((await forms.listFormThemes(other, {}, page)).form_themes).toEqual([])
    await expect(forms.getForm(other, formId)).rejects.toMatchObject({ status: 404 })
    await expect(forms.listFormVersions(other, formId, page)).rejects.toMatchObject({ status: 404 })
    await expect(forms.getFormVersion(other, formId, 1)).rejects.toMatchObject({ status: 404 })
    await expect(forms.updateForm(other, formId, { name: 'pwned' })).rejects.toMatchObject({ status: 404 })
    await expect(forms.duplicateForm(other, formId)).rejects.toMatchObject({ status: 404 })
    await expect(forms.deleteForm(other, formId)).rejects.toMatchObject({ status: 404 })
    await expect(forms.updateFormTheme(other, themeId, { name: 'pwned' })).rejects.toMatchObject({ status: 404 })
    await expect(forms.deleteFormTheme(other, themeId)).rejects.toMatchObject({ status: 404 })
    // B cannot point a form at A's saved theme.
    await expect(forms.createForm(other, { name: 'Sneaky', fields: FIELDS, theme: { source: 'saved', theme_id: themeId } })).rejects.toMatchObject({ status: 400 })
    expect(await one('SELECT name, version FROM public.forms WHERE id = $1', [formId])).toEqual({ name: 'Forms review', version: 2 })
    expect(await one('SELECT name FROM public.form_themes WHERE id = $1', [themeId])).toEqual({ name: 'Forms brand' })

    // Usages in A: the linked step; delete is refused while it is linked.
    expect((await forms.getFormUsages(ctx(A), formId)).map((u) => u.node_id)).toEqual(['review'])
    await expect(forms.deleteForm(ctx(A), formId)).rejects.toMatchObject({ status: 409 })
    await expect(forms.deleteFormTheme(ctx(A), themeId)).rejects.toMatchObject({ status: 409 })
    await expect(forms.deleteFormTheme(ctx(A), startThemeId)).rejects.toMatchObject({ status: 409 })
  })

  it('denies direct end-user writes (no client grants), whatever the tenant', async () => {
    const attempts: Array<[string, unknown[]]> = [
      ['INSERT INTO public.forms (tenant_id, name) VALUES ($1, \'direct\')', [A]],
      ['UPDATE public.forms SET name = \'direct\' WHERE id = $1', [formId]],
      ['DELETE FROM public.forms WHERE id = $1', [formId]],
      ['INSERT INTO public.form_versions (tenant_id, form_id, version, name) VALUES ($1, $2, 99, \'direct\')', [A, formId]],
      ['DELETE FROM public.form_versions WHERE form_id = $1', [formId]],
      ['INSERT INTO public.form_themes (tenant_id, name) VALUES ($1, \'direct\')', [A]],
      ['UPDATE public.form_themes SET name = \'direct\' WHERE id = $1', [themeId]],
      ['DELETE FROM public.form_themes WHERE id = $1', [themeId]],
    ]
    for (const role of ['anon', 'authenticated']) {
      for (const [sql, params] of attempts) {
        await db.query('BEGIN')
        try {
          await db.query(`SET LOCAL ROLE ${role}`)
          await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id(0xdead), role })])
          await expect(db.query(sql, params), `${role}: ${sql}`).rejects.toMatchObject({ code: '42501' })
        } finally {
          await db.query('ROLLBACK')
        }
      }
    }
    expect(await one('SELECT count(*)::int AS n FROM public.form_versions WHERE form_id = $1', [formId])).toEqual({ n: 2 })
  })

  it('exports a workflow with its form and saved themes and applies them into another workspace with remapped ids', async () => {
    const exported = await exportConfig(ctx(A), { ids: [WORKFLOW], with_dependencies: true, format: 'manifest' })
    const manifest = exported.manifest!
    expect(manifest.forms.map((f: any) => f.id)).toEqual([formId])
    expect(manifest.forms[0]).not.toHaveProperty('version')
    expect(manifest.forms[0]).toMatchObject({ name: 'Forms review', tags: ['finance'], theme: { source: 'saved', theme_id: themeId } })
    expect(manifest.forms[0].fields.map((f: any) => f.key)).toEqual(['decision', 'comments', 'amount'])
    expect(manifest.form_themes.map((t: any) => t.id).sort()).toEqual([themeId, startThemeId].sort())

    // A published pin in the files never reaches the imported draft.
    const review = manifest.workflows[0].nodes.find((n: any) => n.id === 'review')
    review.config.form_version = 2

    const applied = await applyConfig(ctx(B), { manifest })
    expect(applied.result?.errors ?? []).toEqual([])
    const map = applied.id_map!
    const localForm = map.form[formId]
    const localTheme = map.form_theme[themeId]
    const localStartTheme = map.form_theme[startThemeId]
    const localWorkflow = map.workflow[WORKFLOW]
    for (const local of [localForm, localTheme, localStartTheme, localWorkflow]) expect(local).toBeTruthy()
    expect(localForm).not.toBe(formId)
    expect(localTheme).not.toBe(themeId)

    const formRow = await one('SELECT tenant_id, name, version, theme, fields FROM public.forms WHERE id = $1', [localForm])
    expect(formRow).toMatchObject({ tenant_id: B, name: 'Forms review', version: 1, theme: { source: 'saved', theme_id: localTheme } })
    expect(formRow.fields).toHaveLength(3)
    expect(await rows('SELECT version FROM public.form_versions WHERE form_id = $1', [localForm])).toEqual([{ version: 1 }])
    expect(await one('SELECT tenant_id, overrides FROM public.form_themes WHERE id = $1', [localTheme])).toEqual({ tenant_id: B, overrides: { radius: 10, density: 'compact' } })

    const wf = await one('SELECT nodes FROM public.workflows WHERE id = $1 AND tenant_id = $2', [localWorkflow, B])
    const nodes = new Map<string, any>(wf.nodes.map((n: any) => [n.id, n]))
    expect(nodes.get('review').config.form_id).toBe(localForm)
    expect(nodes.get('review').config).not.toHaveProperty('form_version')
    expect(nodes.get('trigger').config.start_form.theme).toEqual({ source: 'saved', theme_id: localStartTheme })
    expect((await forms.getFormUsages(ctx(B), localForm)).map((u) => u.workflow_id)).toEqual([localWorkflow])

    // Re-applying the same files changes nothing.
    const again = await applyConfig(ctx(B), { manifest, dry_run: true })
    expect(again.plan.summary).toMatchObject({ create: 0, update: 0, error: 0 })

    // A content change in A becomes version 2 in B; a pinned published version keeps its snapshot.
    await forms.updateForm(ctx(A), formId, { fields: FIELDS })
    const next = (await exportConfig(ctx(A), { ids: [formId], format: 'manifest' })).manifest!
    const update = await applyConfig(ctx(B), { manifest: next })
    expect(update.plan.assets.find((a) => a.section === 'forms')).toMatchObject({ action: 'update', local_id: localForm })
    expect(await one('SELECT version FROM public.forms WHERE id = $1', [localForm])).toEqual({ version: 2 })
    expect((await forms.getFormVersion(ctx(B), localForm, 1)).fields).toHaveLength(3)
  })

  it('packages a workflow with its form and themes; installs with remapped ids and uninstalls in order', async () => {
    const { package: pkg } = await createPackage(ctx(A), { name: 'Forms approval pkg', roots: [{ type: 'workflow', id: WORKFLOW }] })
    const contents = await getPackageContents(ctx(A), pkg.id)
    expect(contents.items.map((i) => `${i.type}:${i.included_as}`).sort()).toEqual(['form:dependency', 'form_theme:dependency', 'form_theme:dependency', 'workflow:root'])

    const built = await buildPackageVersion(ctx(A), pkg.id, { include_file: true })
    const installed = await installPackage(ctx(C), { file: built.file_base64!, keep_incomplete: true })
    const installId = installed.install!.id
    const localOf = async (section: string, sourceId: string) => (await one('SELECT local_id FROM public.package_install_assets WHERE tenant_id = $1 AND section = $2 AND source_id = $3', [C, section, sourceId]))?.local_id
    const localForm = await localOf('forms', formId)
    const localTheme = await localOf('form_themes', themeId)
    const localWorkflow = await localOf('workflows', WORKFLOW)
    expect(localForm && localTheme && localWorkflow).toBeTruthy()
    expect(await one('SELECT tenant_id, theme FROM public.forms WHERE id = $1', [localForm])).toEqual({ tenant_id: C, theme: { source: 'saved', theme_id: localTheme } })
    const wf = await one('SELECT nodes FROM public.workflows WHERE id = $1', [localWorkflow])
    expect(wf.nodes.find((n: any) => n.id === 'review').config.form_id).toBe(localForm)

    const dry = await uninstallPackage(ctx(C), installId, { dry_run: true })
    const order = dry.plan.filter((p) => p.action === 'delete').map((p) => p.section)
    expect(order).toEqual(['workflows', 'forms', 'form_themes', 'form_themes'])
    const done = await uninstallPackage(ctx(C), installId, {})
    expect(done.errors).toEqual([])
    expect(await rows('SELECT id FROM public.forms WHERE tenant_id = $1', [C])).toEqual([])
    expect(await rows('SELECT id FROM public.form_themes WHERE tenant_id = $1', [C])).toEqual([])
  })
})
