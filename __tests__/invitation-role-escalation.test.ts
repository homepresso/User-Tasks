/**
 * Inviting someone as Admin or Owner gives them that role when they accept
 * (lib/providers/auth/provisioning.ts assigns the invited role), so it needs
 * team.change_roles, like assigning a role. A Manager (team.invite without
 * team.change_roles) could otherwise invite an accomplice as Owner: a
 * privilege escalation within the workspace (found during the Nov 2026 QA
 * pass; same path for the invitations page, REST, MCP and the Import people
 * wizard).
 */
import { describe, expect, it, vi } from 'vitest'

const inserted = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/invitations', async (orig) => ({ ...(await orig() as object), sendInvitationEmail: async () => ({ success: true }) }))
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), audit: async () => undefined }))

const supabase = {
  from: (table: string) => {
    const q: any = {}
    q.select = () => q; q.eq = () => q; q.is = () => q
    q.maybeSingle = async () => ({ data: null, error: null })
    q.insert = (row: unknown) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'inv-1', ...(row as object), accepted_at: null }, error: null }) }) } }
    return q
  },
}
const ctx = (perms: string[]) => ({ supabase, tenantId: 't1', actorId: 'u-manager', permissions: new Set(perms), authKind: 'session', source: 'ui' }) as never
const { sendInvitation } = await import('@/lib/services/invitations')

describe('invitation roles', () => {
  it('team.invite alone cannot invite an Owner or Admin', async () => {
    for (const role of ['owner', 'admin']) {
      await expect(sendInvitation(ctx(['team.invite']), { email: `x-${role}@acme.test`, role })).rejects.toThrow()
    }
    expect(inserted).toHaveLength(0)
  })

  it('team.invite can invite Manager, Member and Viewer; team.change_roles also Admin and Owner', async () => {
    for (const role of ['manager', 'member', 'viewer']) await sendInvitation(ctx(['team.invite']), { email: `y-${role}@acme.test`, role })
    for (const role of ['admin', 'owner']) await sendInvitation(ctx(['team.invite', 'team.change_roles']), { email: `z-${role}@acme.test`, role })
    expect((inserted as Array<{ role: string }>).map((r) => r.role)).toEqual(['manager', 'member', 'viewer', 'admin', 'owner'])
  })
})
