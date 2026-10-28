import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { writeAudit } from '@/lib/audit-log'
import type { ServiceContext } from '@/lib/services/context'
import { completeOnboarding, isWorkspaceLogoUrl, setWorkspaceLogo } from '@/lib/services/tenant-settings'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { pinDefaultStorageProvider } from './fixtures/pin-storage'

// Supabase Storage path (mocked client / local stack buckets).
pinDefaultStorageProvider()

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const BASE = 'https://proj.supabase.co'
const LOGO = `${BASE}/storage/v1/object/public/logos/tenant-a/logo.png?t=1`

function seed() {
  return createMemorySupabase({
    tenants: [
      { id: 'tenant-a', name: 'A', slug: 'acme', branding: { primary_color: '#123456', logo_url: 'old' }, settings: { event_stream_retention_hours: 24 }, deleted_at: null },
      { id: 'tenant-b', name: 'B', slug: 'taken', branding: {}, settings: {}, deleted_at: null },
    ],
  })
}
type Db = ReturnType<typeof seed>

// authKind 'api_key' → serviceRoleClient() uses ctx.supabase (the memory db).
const ctx = (db: Db, permissions: string[]): ServiceContext => ({
  supabase: db as any, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'ui',
})
const tenant = (db: Db, id = 'tenant-a') => (db.tables.tenants as any[]).find((t) => t.id === id)

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', BASE)
  vi.mocked(writeAudit).mockClear()
})

describe('workspace logo', () => {
  it('requires settings.edit', async () => {
    const db = seed()
    await expect(setWorkspaceLogo(ctx(db, ['settings.view']), LOGO)).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(tenant(db).branding.logo_url).toBe('old')
  })

  it('merges into branding (and removes only logo_url), audited', async () => {
    const db = seed()
    await setWorkspaceLogo(ctx(db, ['settings.edit']), LOGO)
    expect(tenant(db).branding).toEqual({ primary_color: '#123456', logo_url: LOGO })
    await setWorkspaceLogo(ctx(db, ['settings.edit']), null)
    expect(tenant(db).branding).toEqual({ primary_color: '#123456' })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'workspace', objectId: 'tenant-a', tenantId: 'tenant-a' }))
  })

  it('only accepts this workspace’s object in our logos bucket', async () => {
    const db = seed()
    for (const bad of [
      'https://evil.example/logo.png',
      `${BASE}/storage/v1/object/public/logos/tenant-b/logo.png`,
      `${BASE}/storage/v1/object/public/task-files/tenant-a/logo.png`,
      'javascript:alert(1)',
    ]) {
      await expect(setWorkspaceLogo(ctx(db, ['settings.edit']), bad)).rejects.toMatchObject({ code: 'validation_error' })
    }
    expect(isWorkspaceLogoUrl(LOGO, 'tenant-a')).toBe(true)
    expect(isWorkspaceLogoUrl(LOGO, 'tenant-a', 'https://other.supabase.co')).toBe(false)
  })
})

describe('onboarding', () => {
  it('requires settings.edit, validates the slug and rejects taken slugs', async () => {
    const db = seed()
    await expect(completeOnboarding(ctx(db, []), { name: 'X', slug: 'xyz' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(completeOnboarding(ctx(db, ['settings.edit']), { name: 'X', slug: 'taken' })).rejects.toMatchObject({ status: 409 })
    await expect(completeOnboarding(ctx(db, ['settings.edit']), { name: 'X', slug: 'a/b' })).rejects.toMatchObject({ status: 400 })
    expect(await completeOnboarding(ctx(db, ['settings.edit']), { name: 'Acme Ltd', slug: 'Acme-Ltd' })).toEqual({ slug: 'acme-ltd' })
    expect(tenant(db)).toMatchObject({ name: 'Acme Ltd', slug: 'acme-ltd', onboarding_completed: true })
    expect(tenant(db, 'tenant-b').slug).toBe('taken')
  })
})
