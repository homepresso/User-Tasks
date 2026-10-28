/**
 * Package history helpers (lib/services/package-events): the channel an
 * event is recorded under, requirement status changes, stored plans (secrets
 * masked, size capped), CSV cells (quoting, formula injection) and the
 * signature label.
 */
import { describe, expect, it } from 'vitest'
import { csvCell, eventChannel, requirementChanges, signatureLabel, storablePlan } from '@/lib/services/package-events'
import type { ServiceContext } from '@/lib/services/context'

const ctx = (source: ServiceContext['source']) => ({ source } as ServiceContext)

describe('eventChannel', () => {
  it('uses the context, and cli when the caller declares it', () => {
    expect(eventChannel(ctx('ui'))).toBe('ui')
    expect(eventChannel(ctx('ui'), 'file')).toBe('ui')
    expect(eventChannel(ctx('api'))).toBe('api')
    expect(eventChannel(ctx('api'), 'cli')).toBe('cli')
    expect(eventChannel(ctx('mcp'))).toBe('mcp')
    expect(eventChannel(ctx('api'), 'mcp')).toBe('mcp')
  })
})

describe('requirementChanges', () => {
  it('lists new, changed and removed requirements only', () => {
    const before = [{ id: 'a', label: 'A', status: 'missing' }, { id: 'b', label: 'B', status: 'met' }, { id: 'gone', label: 'Gone', status: 'met' }]
    const after = [{ id: 'a', label: 'A', status: 'met' }, { id: 'b', label: 'B', status: 'met' }, { id: 'new', label: 'New', status: 'missing' }]
    expect(requirementChanges(before, after)).toEqual([
      { id: 'a', label: 'A', before: 'missing', after: 'met' },
      { id: 'new', label: 'New', before: null, after: 'missing' },
      { id: 'gone', label: 'Gone', before: 'met', after: null },
    ])
    expect(requirementChanges(null, [])).toEqual([])
  })
})

describe('storablePlan', () => {
  it('masks secrets and ciphertext', () => {
    const stored = storablePlan({ plan: { assets: [{ section: 'integrations', diffs: [{ path: 'config.base_url', before: 'a', after: 'b' }] }] }, config: { auth_config: { token: 'tok-live' } }, blob: 'enc:v1:abc' }) as any
    expect(JSON.stringify(stored)).not.toContain('tok-live')
    expect(JSON.stringify(stored)).not.toContain('enc:v1:')
    expect(stored.plan.assets[0].diffs[0].after).toBe('b')
  })

  it('caps diffs per asset, then drops diffs when the plan is still too large', () => {
    const diffs = Array.from({ length: 80 }, (_, i) => ({ path: `p${i}`, after: 'x' }))
    const capped = storablePlan({ plan: { assets: [{ diffs }] } }) as any
    expect(capped.plan.assets[0].diffs).toHaveLength(50)
    expect(capped.plan.assets[0].diffs_truncated).toBe(true)
    const huge = storablePlan({ plan: { assets: Array.from({ length: 30 }, () => ({ name: 'n', diffs: Array.from({ length: 50 }, () => ({ path: 'p', after: 'y'.repeat(1000) })) })) } }) as any
    expect(huge.truncated).toBe(true)
    expect(huge.plan.assets[0].diffs).toBeUndefined()
    expect(huge.plan.assets[0].name).toBe('n')
    expect(storablePlan(null)).toBeNull()
  })
})

describe('csvCell / signatureLabel', () => {
  it('quotes and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell(null)).toBe('')
    expect(csvCell(3)).toBe('3')
  })

  it('labels signatures', () => {
    expect(signatureLabel({ signed: null })).toBe('')
    expect(signatureLabel({ signed: false })).toBe('unsigned')
    expect(signatureLabel({ signed: true, signature_valid: false })).toBe('invalid signature')
    expect(signatureLabel({ signed: true, signature_valid: true, trust: 'instance' })).toBe('signed (this instance)')
    expect(signatureLabel({ signed: true, signature_valid: true, trust: 'untrusted' })).toBe('signed (unknown key)')
  })
})

describe('Packages page access', () => {
  it('needs packages.view at /packages and /settings/packages; the nav entry uses the same permission', async () => {
    const { canAccessPath } = await import('@/lib/route-permissions')
    const { NAV_ITEMS_WORKFLOW } = await import('@/lib/constants')
    for (const path of ['/packages', '/settings/packages']) {
      expect(canAccessPath(path, ['packages.view'])).toBe(true)
      expect(canAccessPath(path, ['workflows.view', 'settings.view'])).toBe(false)
    }
    expect(canAccessPath('/packages-elsewhere', [])).toBe(true) // prefix match is per path segment
    expect(NAV_ITEMS_WORKFLOW.find((item) => item.href === '/packages')?.requiredPermission).toBe('packages.view')
  })
})
