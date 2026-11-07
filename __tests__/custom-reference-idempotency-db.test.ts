/**
 * The idempotency ledger of custom reference writes (migration
 * 20261216000000) against a LOCAL Supabase stack: claim → replay, busy while
 * running, release on failure, no client access.
 *
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=… \
 *   npx vitest run __tests__/custom-reference-idempotency-db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { claimIdempotencyKey, completeIdempotencyKey, releaseIdempotencyKey } from '@/lib/custom-references/idempotency'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const READY = !!DB_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY && /127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')

const TENANT = '0e000000-0000-4000-8000-0000000000c1'
const INTEGRATION = '0e000001-0000-4000-8000-0000000000c1'
const REFERENCE = '0e000002-0000-4000-8000-0000000000c1'

describe.skipIf(!READY)('custom reference idempotency ledger (local Supabase)', () => {
  const db = new Client({ connectionString: DB_URL })
  beforeAll(async () => {
    await db.connect()
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'CRW idem', 'crw-idem') ON CONFLICT (id) DO NOTHING`, [TENANT])
    await db.query(`INSERT INTO public.integrations (id, tenant_id, name, type, config) VALUES ($1, $2, 'Helpdesk', 'rest_api', '{}') ON CONFLICT (id) DO NOTHING`, [INTEGRATION, TENANT])
    await db.query(`INSERT INTO public.integration_references (id, tenant_id, integration_id, name) VALUES ($1, $2, $3, 'Create ticket') ON CONFLICT (id) DO NOTHING`, [REFERENCE, TENANT, INTEGRATION])
  })
  afterAll(async () => {
    await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT])
    await db.end()
  })

  it('claim → busy while running → replay after success; release frees the key', async () => {
    const key = `k-${Date.now()}`
    const first = await claimIdempotencyKey({ tenantId: TENANT, referenceId: REFERENCE, key })
    expect(first.kind).toBe('claimed')
    expect((await claimIdempotencyKey({ tenantId: TENANT, referenceId: REFERENCE, key })).kind).toBe('busy')
    await completeIdempotencyKey((first as { id: string }).id, { status: 201, data: { status: 201, affected_rows: 1, id: 9 } })
    const replay = await claimIdempotencyKey({ tenantId: TENANT, referenceId: REFERENCE, key })
    expect(replay).toEqual({ kind: 'replay', result: { status: 201, data: { status: 201, affected_rows: 1, id: 9 } } })

    const other = await claimIdempotencyKey({ tenantId: TENANT, referenceId: REFERENCE, key: `${key}-b` })
    await releaseIdempotencyKey((other as { id: string }).id)
    expect((await claimIdempotencyKey({ tenantId: TENANT, referenceId: REFERENCE, key: `${key}-b` })).kind).toBe('claimed')
    // Only the hash of the key is stored.
    const stored = await db.query('SELECT key_hash FROM public.custom_reference_writes WHERE tenant_id = $1', [TENANT])
    expect(stored.rows.every((r) => /^[0-9a-f]{64}$/.test(r.key_hash) && !r.key_hash.includes(key))).toBe(true)
  })

  it('signed-in clients have no access to the ledger', async () => {
    const r = await db.query(`SELECT has_table_privilege('authenticated', 'public.custom_reference_writes', 'SELECT') AS s, has_table_privilege('anon', 'public.custom_reference_writes', 'INSERT') AS i`)
    expect(r.rows[0]).toEqual({ s: false, i: false })
  })
})
