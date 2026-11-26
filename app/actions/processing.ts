'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { configureProcessing, loadProcessingStatus, recoverStuckJob, type ProcessingStatusView, type RecoverStuckJobResult } from '@/lib/admin/processing-status'

/*
 * Settings → Infrastructure → Processing (instance admins, as the page):
 * refresh the status, and Retry / Cancel / Force-cancel processing jobs on
 * any workspace (audited in the job's workspace).
 */

async function admin() {
  const { user } = await getSessionDbWithUser()
  if (!user || !(await viewerCanSeeInfrastructure(user))) return null
  return user
}

export async function refreshProcessingStatus(): Promise<{ ok: true; status: ProcessingStatusView } | { ok: false; error: string }> {
  if (!(await admin())) return { ok: false, error: 'Only instance administrators can see processing.' }
  return { ok: true, status: await loadProcessingStatus() }
}

export async function recoverProcessingJob(jobId: string, action: 'retry' | 'cancel', force = false): Promise<RecoverStuckJobResult> {
  const user = await admin()
  if (!user) return { ok: false, status: 403, error: 'Only instance administrators can recover jobs.' }
  if (action !== 'retry' && action !== 'cancel') return { ok: false, status: 400, error: 'action must be retry or cancel' }
  return recoverStuckJob({ jobId, action, force, actorId: user.id, via: 'ui' })
}

/**
 * The Processing add-on's switches on the Settings card: processing mode
 * (web app / separate workers) and designer test runs on workers. Instance
 * admins only; the add-on must be in the build and licensed (core refuses
 * otherwise, whatever the page showed); the add-on refuses workers while none
 * is online and settings locked by the environment.
 */
export async function configureProcessingSettings(changes: { mode?: 'web' | 'workers'; test_runs_on_workers?: boolean }): Promise<{ ok: true; status: ProcessingStatusView } | { ok: false; status: number; error: string }> {
  if (!(await admin())) return { ok: false, status: 403, error: 'Only instance administrators can change processing.' }
  const clean: { mode?: 'web' | 'workers'; test_runs_on_workers?: boolean } = {}
  if (changes?.mode !== undefined) clean.mode = changes.mode
  if (changes?.test_runs_on_workers !== undefined) clean.test_runs_on_workers = changes.test_runs_on_workers
  if (!Object.keys(clean).length) return { ok: false, status: 400, error: 'Nothing to change' }
  const result = await configureProcessing(clean)
  if (!result.ok) return result
  return { ok: true, status: await loadProcessingStatus() }
}
