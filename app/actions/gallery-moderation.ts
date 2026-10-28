'use server'

import { revalidatePath } from 'next/cache'
import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { isServiceError } from '@/lib/services/context'
import {
  decideSubmission, isGalleryModerator, resolveAbuseReport, setPackageListed, verifySubmission, withdrawSubmission,
} from '@/lib/services/gallery-community'

/*
 * Community gallery moderation (Settings → Gallery review) and the
 * submitter's own withdraw. Every action re-checks the caller in
 * lib/services/gallery-community (instance admins only for moderation);
 * server actions are POST-only and same-origin.
 */

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string }

async function viewer() {
  const { user } = await getSessionDbWithUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const data = await fn()
    revalidatePath('/settings/gallery-review')
    revalidatePath('/gallery')
    return { ok: true, data }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error('[gallery moderation]', error)
    return { ok: false, error: 'Something went wrong' }
  }
}

export async function canModerateGalleryAction(): Promise<boolean> {
  try {
    const user = await viewer()
    return user ? await isGalleryModerator(user) : false
  } catch {
    return false
  }
}

export async function approveSubmissionAction(id: string, note?: string) {
  return run(async () => decideSubmission(await viewer(), id, { decision: 'approve', reason: note ?? null }))
}

export async function rejectSubmissionAction(id: string, reason: string) {
  return run(async () => decideSubmission(await viewer(), id, { decision: 'reject', reason }))
}

export async function verifySubmissionAction(id: string) {
  return run(async () => verifySubmission(await viewer(), id))
}

export async function resolveAbuseReportAction(id: string, action: 'dismiss' | 'unlist') {
  return run(async () => resolveAbuseReport(await viewer(), id, action))
}

export async function setCommunityPackageListedAction(packageId: string, listed: boolean) {
  return run(async () => setPackageListed(await viewer(), packageId, listed))
}

export async function withdrawSubmissionAction(id: string) {
  return run(async () => {
    const user = await viewer()
    if (!user) throw new Error('Sign in')
    await withdrawSubmission(user, id)
  })
}
