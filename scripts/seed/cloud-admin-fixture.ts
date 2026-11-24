/**
 * LOCAL-ONLY fixture for verifying the Cloud admin app (internal/packages/cloud-admin):
 * several fictional workspaces with people, invitations, runs, tasks, AI usage
 * (USD), storage, trials and a locked (suspended) account. Refuses to run
 * against anything but a local stack (127.0.0.1 / localhost).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55621 SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx tsx scripts/seed/cloud-admin-fixture.ts --out <file.json> [--password …]
 *
 * Writes the people's ids, a user API key each for the instance admin and a
 * workspace owner, and the password to --out. Not re-runnable (use a fresh stack).
 */
import { createHash, randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture writes untyped tables */

function arg(name: string, fallback?: string): string | undefined {
  const argv = process.argv.slice(2)
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
function fail(message: string): never {
  console.error(`cloud-admin-fixture: ${message}`)
  process.exit(1)
}

const DAY = 86_400_000
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString()
const ahead = (days: number) => new Date(Date.now() + days * DAY).toISOString()
let seed = 7
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)]

interface Ws { key: string; name: string; slug: string; plan: string; created: number; industry: string; size: string; people: Array<[string, string, string, number | null]>; runs: number; failRate: number; ai: number; storageMb: number }

const WORKSPACES: Ws[] = [
  { key: 'hq', name: 'Cloud HQ', slug: 'cloud-hq', plan: 'business_enterprise', created: 200, industry: 'Software', size: '11-50', runs: 40, failRate: 0.02, ai: 10, storageMb: 40,
    people: [['ops@cloudadmin.example', 'Morgan Ops', 'owner', 0], ['support@cloudadmin.example', 'Sam Support', 'admin', 1]] },
  { key: 'acme', name: 'Acme Robotics', slug: 'acme-robotics', plan: 'business_team', created: 120, industry: 'Manufacturing', size: '51-200', runs: 220, failRate: 0.06, ai: 120, storageMb: 820,
    people: [['ada@acme-robotics.example', 'Ada Lovell', 'owner', 0], ['ben@acme-robotics.example', 'Ben Carter', 'admin', 2], ['cara@acme-robotics.example', 'Cara Diaz', 'member', 5], ['dev@acme-robotics.example', 'Dev Patel', 'member', 40], ['eli@acme-robotics.example', 'Eli Novak', 'viewer', null]] },
  { key: 'northwind', name: 'Northwind Bakeries', slug: 'northwind-bakeries', plan: 'personal_pro', created: 75, industry: 'Food & beverage', size: '11-50', runs: 90, failRate: 0.03, ai: 30, storageMb: 120,
    people: [['ines@northwind-bakeries.example', 'Ines Marsh', 'owner', 1], ['olu@northwind-bakeries.example', 'Olu Ade', 'member', 3]] },
  { key: 'bluefin', name: 'Bluefin Logistics', slug: 'bluefin-logistics', plan: 'business_team', created: 20, industry: 'Logistics', size: '201-500', runs: 140, failRate: 0.04, ai: 60, storageMb: 300,
    people: [['rae@bluefin-logistics.example', 'Rae Okafor', 'owner', 0], ['tom@bluefin-logistics.example', 'Tomás Reyes', 'manager', 6]] },
  { key: 'quarry', name: 'Quarry Ridge Builders', slug: 'quarry-ridge', plan: 'business_team', created: 50, industry: 'Construction', size: '51-200', runs: 180, failRate: 0.35, ai: 15, storageMb: 210,
    people: [['ops@quarryridge.example', 'Quinn Hale', 'owner', 2], ['site@quarryridge.example', 'Sid Moreno', 'member', 9]] },
  { key: 'lumen', name: 'Lumen Clinics', slug: 'lumen-clinics', plan: 'business_enterprise', created: 160, industry: 'Healthcare', size: '501-1000', runs: 260, failRate: 0.02, ai: 400, storageMb: 1500,
    people: [['finance@lumenclinics.example', 'Lena Fischer', 'owner', 0], ['it@lumenclinics.example', 'Ivo Brandt', 'admin', 1], ['nurse@lumenclinics.example', 'Nia Cole', 'member', 4]] },
  { key: 'fernhill', name: 'Fernhill Schools', slug: 'fernhill-schools', plan: 'personal_free', created: 8, industry: 'Education', size: '11-50', runs: 30, failRate: 0.1, ai: 90, storageMb: 25,
    people: [['it@fernhill.example', 'Felix Grant', 'owner', 0]] },
  { key: 'cobalt', name: 'Cobalt Studio', slug: 'cobalt-studio', plan: 'personal_free', created: 95, industry: 'Design', size: '1-10', runs: 0, failRate: 0, ai: 0, storageMb: 5,
    people: [['mia@cobaltstudio.example', 'Mia Laurent', 'owner', 60]] },
]

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!url || !serviceKey) fail('set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local stack)')
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) fail('local stacks only')
  const out = arg('out') ?? fail('--out <file> is required')
  const password = arg('password', `Local-${randomBytes(6).toString('hex')}!A1`)!
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const from = (t: string) => (db as any).from(t)
  const must = async <T,>(p: PromiseLike<{ data: T; error: any }>, what: string): Promise<T> => { const { data, error } = await p; if (error) fail(`${what}: ${error.message}`); return data }

  const ids: Record<string, string> = {}
  const tenants: Record<string, string> = {}
  for (const ws of WORKSPACES) {
    const t: any = await must(from('tenants').insert({ name: ws.name, slug: ws.slug, plan: ws.plan, industry: ws.industry, company_size: ws.size, onboarding_completed: true, created_at: ago(ws.created) }).select('id').single(), `tenant ${ws.slug}`)
    tenants[ws.key] = t.id
    const roles: any[] = await must(from('roles').select('id, slug').eq('tenant_id', t.id).eq('is_system', true), 'roles')
    const roleId = new Map(roles.map((r) => [r.slug, r.id]))
    for (const [email, name, role, seen] of ws.people) {
      const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } })
      if (error || !data.user) fail(`auth ${email}: ${error?.message}`)
      const id = data.user.id
      ids[email] = id
      await must(from('users').upsert({ id, email, display_name: name, tenant_id: t.id, current_tenant_id: t.id, role, last_seen_at: seen === null ? null : ago(seen, 3), created_at: ago(Math.max(1, ws.created - 2)) }, { onConflict: 'id' }), `user ${email}`)
      await from('user_memberships').delete().eq('user_id', id).neq('tenant_id', t.id)
      await from('user_roles').delete().eq('user_id', id).neq('tenant_id', t.id)
      const { data: m } = await from('user_memberships').select('id').eq('user_id', id).eq('tenant_id', t.id).maybeSingle()
      const membership = { user_id: id, tenant_id: t.id, role, is_active: true, is_home: true, joined_at: ago(Math.max(1, ws.created - 2)) }
      if (m) await must(from('user_memberships').update(membership).eq('id', m.id), 'membership'); else await must(from('user_memberships').insert(membership), 'membership')
      await from('user_roles').delete().eq('user_id', id).eq('tenant_id', t.id)
      await must(from('user_roles').insert({ tenant_id: t.id, user_id: id, role_id: roleId.get(role) }), `role ${email}`)
    }
    // Activity: workflows, runs, tasks, agent runs, AI requests, files.
    const owner = ids[ws.people[0][0]]
    const wf: any = await must(from('workflows').insert({ tenant_id: t.id, name: `${ws.name} intake`, trigger_type: 'form_submitted', nodes: [], edges: [], is_active: true, created_by: owner }).select('id').single(), 'workflow')
    await must(from('forms').insert({ tenant_id: t.id, name: `${ws.name} request form` }), 'form')
    const runs = Array.from({ length: ws.runs }, () => {
      const d = rand() * 60
      return { tenant_id: t.id, workflow_id: wf.id, status: rand() < ws.failRate ? 'failed' : pick(['completed', 'completed', 'completed', 'running']), started_at: ago(d), completed_at: ago(d - 0.01) }
    })
    for (let i = 0; i < runs.length; i += 200) await must(from('workflow_runs').insert(runs.slice(i, i + 200)), 'runs')
    const tasks = Array.from({ length: Math.ceil(ws.runs / 3) }, (_, i) => ({ tenant_id: t.id, title: `Fixture task ${i + 1}`, status: pick(['todo', 'in_progress', 'completed', 'completed']), created_at: ago(rand() * 60) }))
    if (tasks.length) await must(from('tasks').insert(tasks), 'tasks')
    const agent: any = ws.ai ? await must(from('agents').insert({ tenant_id: t.id, name: `${ws.name} assistant`, is_active: true }).select('id').single(), 'agent') : null
    const models = ['claude-sonnet-4-5', 'gpt-4.1-mini', 'claude-haiku-4-5']
    const agentRuns = Array.from({ length: ws.ai }, () => {
      const inT = Math.floor(500 + rand() * 4000); const outT = Math.floor(100 + rand() * 900)
      const failed = ws.key === 'fernhill' ? rand() < 0.4 : rand() < 0.03
      return { tenant_id: t.id, agent_id: agent?.id, model: pick(models), status: failed ? 'failed' : 'completed', input_tokens: inT, output_tokens: outT, total_tokens: inT + outT, cost_amount: Math.round((inT * 0.000003 + outT * 0.000015) * 1e6) / 1e6, cost_currency: 'USD', cost_status: 'priced', started_at: ago(rand() * 45), caller_type: 'workflow_node' }
    })
    for (let i = 0; i < agentRuns.length; i += 200) await must(from('agent_runs').insert(agentRuns.slice(i, i + 200)), 'agent runs')
    if (ws.ai) await must(from('assistant_usage').insert(Array.from({ length: Math.ceil(ws.ai / 4) }, () => ({ tenant_id: t.id, user_id: owner, capability: 'form', provider: 'anthropic', model: 'claude-sonnet-4-5', status: 'completed', prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500, cost_amount: 0.0081, cost_currency: 'USD', cost_status: 'priced', created_at: ago(rand() * 30) }))), 'assistant usage')
    const bytes = ws.storageMb * 1_048_576
    await must(from('form_files').insert({ tenant_id: t.id, storage_key: `${t.id}/fixture.bin`, name: 'fixture.bin', size: bytes, mime_type: 'application/octet-stream', checksum_sha256: createHash('sha256').update(ws.key).digest('hex'), context_kind: 'form', field_key: 'file', status: 'bound' }), 'files')
    await must(from('object_audit_log').insert({ tenant_id: t.id, actor_id: owner, object_type: 'workflow', object_id: wf.id, action: 'update', summary: 'Fixture change', metadata: { via: 'ui' } }), 'audit')
  }

  // Invitations: pending, expired, accepted.
  const inv = (ws: string, email: string, role: string, invitedBy: string, state: 'pending' | 'expired' | 'accepted') => ({
    tenant_id: tenants[ws], email, role, invited_by: ids[invitedBy], token: randomBytes(16).toString('hex'),
    created_at: state === 'expired' ? ago(12) : ago(2), expires_at: state === 'expired' ? ago(5) : ahead(5), accepted_at: state === 'accepted' ? ago(1) : null,
  })
  await must(from('invitations').insert([
    inv('acme', 'frank@acme-robotics.example', 'member', 'ada@acme-robotics.example', 'pending'),
    inv('acme', 'gwen@acme-robotics.example', 'manager', 'ada@acme-robotics.example', 'expired'),
    inv('northwind', 'pat@northwind-bakeries.example', 'member', 'ines@northwind-bakeries.example', 'pending'),
    inv('bluefin', 'controller@bluefin-logistics.example', 'admin', 'rae@bluefin-logistics.example', 'expired'),
    inv('lumen', 'ward@lumenclinics.example', 'member', 'finance@lumenclinics.example', 'accepted'),
  ]), 'invitations')

  // Licences and trials.
  await must(from('tenant_entitlements').insert([
    { tenant_id: tenants.bluefin, extension_id: 'sharepoint', source: 'trial', status: 'active', starts_at: ago(20), ends_at: ahead(6) },
    { tenant_id: tenants.fernhill, extension_id: 'sharepoint', source: 'trial', status: 'active', starts_at: ago(8), ends_at: ahead(22) },
    { tenant_id: tenants.quarry, extension_id: 'infrastructure', source: 'admin', status: 'active', starts_at: ago(80), ends_at: ago(3) },
    { tenant_id: tenants.lumen, extension_id: 'sharepoint', source: 'licence', status: 'active', starts_at: ago(150), ends_at: ahead(200) },
  ]), 'entitlements')

  // A locked (suspended) account: Supabase Auth ban.
  await db.auth.admin.updateUserById(ids['dev@acme-robotics.example'], { ban_duration: '24h' })

  // User API keys: the instance admin and Acme's owner.
  const mint = async (tenant: string, user: string, name: string) => {
    const key = `ut_${randomBytes(32).toString('hex')}`
    await must(from('api_keys').insert({ tenant_id: tenants[tenant], name, key_prefix: key.slice(0, 8), key_hash: await bcrypt.hash(key, 10), key_type: 'user', user_id: ids[user], permissions: null, created_by: ids[user] }), `key ${name}`)
    return key
  }
  const keys = { admin: await mint('hq', 'ops@cloudadmin.example', 'Fixture: instance admin'), acme_owner: await mint('acme', 'ada@acme-robotics.example', 'Fixture: Acme owner') }
  writeFileSync(out, JSON.stringify({ tenants, ids, keys, password }, null, 2), { mode: 0o600 })
  console.log(`cloud-admin fixture: ${WORKSPACES.length} workspaces, ${Object.keys(ids).length} people → ${out}`)
}

main().catch((e) => fail(String(e?.message ?? e)))
