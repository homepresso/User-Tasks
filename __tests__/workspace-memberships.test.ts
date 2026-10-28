/**
 * Org switcher with a membership whose workspace isn't readable: the
 * memberships read embeds `tenant: null` for it, which used to crash the
 * switcher (`null.id` in `memberships.find`).
 */
import { describe, expect, it } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { switcherLabel, usableMemberships, workspaceInitials } from '@/lib/workspace-memberships'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const tenantA = { id: 'tenant-a', name: 'Acme Corp', slug: 'acme', branding: {} }
const rows = () => [
  { id: 'mb1', user_id: 'user-1', tenant_id: 'tenant-a', is_active: true, is_home: true, tenant: tenantA },
  { id: 'mb2', user_id: 'user-1', tenant_id: 'tenant-gone', is_active: true, is_home: false, tenant: null },
]

function ctx(db: any): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(), authKind: 'session', source: 'ui' }
}

describe('memberships with an unreadable workspace', () => {
  it('the memberships read skips rows whose tenant embed is null', async () => {
    const db = createMemorySupabase({ user_memberships: rows() })
    const result = await runUiRead(ctx(db), { name: 'settings.memberships' }) as any
    expect(result.ok).toBe(true)
    expect(result.data.map((m: any) => m.id)).toEqual(['mb1'])
  })

  it('usableMemberships drops null / missing tenants (client-side guard)', () => {
    expect(usableMemberships(rows() as any).map((m) => m.id)).toEqual(['mb1'])
    expect(usableMemberships([null, undefined, { id: 'x', tenant: { id: '' } } as any])).toEqual([])
    expect(usableMemberships(undefined)).toEqual([])
  })

  it('the switcher label never dereferences a missing tenant', () => {
    const raw = rows() as any
    // Unfiltered data (an older cache entry) must not throw either.
    expect(() => switcherLabel(raw, 'tenant-gone')).not.toThrow()
    expect(switcherLabel(raw, 'tenant-gone')).toEqual({ kind: 'unavailable' })
    expect(switcherLabel(raw, 'tenant-a')).toMatchObject({ kind: 'workspace', membership: { id: 'mb1' } })
    expect(switcherLabel(raw, null)).toEqual({ kind: 'all' })
    // While memberships load, the neutral label is shown.
    expect(switcherLabel(undefined, 'tenant-a')).toEqual({ kind: 'all' })
  })

  it('initials tolerate empty names', () => {
    expect(workspaceInitials('Acme Corp')).toBe('AC')
    expect(workspaceInitials('')).toBe('?')
    expect(workspaceInitials(null)).toBe('?')
  })
})
