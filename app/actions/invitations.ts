'use server'

import { revalidatePath } from 'next/cache'
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

export async function revokeInvitation(invitationId: string) {
  await invitations.revokeInvitation(await fromSession(), invitationId)
  revalidatePath('/settings/invitations')
}

export async function resendInvitation(invitationId: string) {
  await invitations.resendInvitation(await fromSession(), invitationId)
  revalidatePath('/settings/invitations')
}
