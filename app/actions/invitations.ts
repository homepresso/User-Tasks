'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { ensureTenantInvitation, INVITABLE_ROLES } from '@/lib/invitations'
import { fromSession } from '@/lib/services/context'
import * as invitations from '@/lib/services/invitations'

/*
 * Invitation server actions: thin wrappers over lib/services/invitations
 * (shared with /api/v1/invitations and MCP). A failed email keeps the
 * invitation, which can be resent.
 */

export async function createInvitation(formData: FormData) {
  await invitations.sendInvitation(await fromSession(), {
    email: String(formData.get('email') ?? ''),
    role: (formData.get('role') as string) || 'member',
  })
  revalidatePath('/settings/invitations')
  revalidatePath('/team')
}

/** Invite an external assignee (task redirect). No-op when an invitation is already pending. */
export async function inviteByEmail(email: string, tenantId: string, invitedBy: string, role: string = 'viewer') {
  const supabase = await createClient()
  const safeRole = (INVITABLE_ROLES as readonly string[]).includes(role) ? (role as (typeof INVITABLE_ROLES)[number]) : 'viewer'
  await ensureTenantInvitation({ supabase: supabase as unknown as Parameters<typeof ensureTenantInvitation>[0]['supabase'], tenantId, email, invitedBy, role: safeRole })
}

export async function revokeInvitation(invitationId: string) {
  await invitations.revokeInvitation(await fromSession(), invitationId)
  revalidatePath('/settings/invitations')
}

export async function resendInvitation(invitationId: string) {
  await invitations.resendInvitation(await fromSession(), invitationId)
  revalidatePath('/settings/invitations')
}
