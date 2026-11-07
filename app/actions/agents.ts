'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession, ServiceError } from '@/lib/services/context'
import * as agents from '@/lib/services/agents'
import { findRecentDuplicate } from '@/lib/recent-duplicate'

/*
 * Agent designer actions — thin wrappers over lib/services/agents (field
 * allowlist, tenant validation of the provider / tools, versions, audit,
 * GitHub sync, queued deletes).
 */

export async function createAgent(data: { name: string; description?: string }) {
  const ctx = await fromSession()
  // A repeated submit (double click, retry) opens the agent this user just
  // created instead of adding a second one.
  const recent = ctx.actorId
    ? await findRecentDuplicate<{ id: string }>(ctx.supabase, 'agents', { tenant_id: ctx.tenantId, created_by: ctx.actorId, name: String(data.name ?? '').trim() })
    : null
  if (recent) redirect(`/agents/${recent.id}`)
  const agent = await agents.createAgent(ctx, { name: data.name, description: data.description || null })
  revalidatePath('/agents')
  redirect(`/agents/${agent.id}`)
}

export async function saveAgent(agentId: string, updates: Record<string, unknown>): Promise<ActionResult<{ version: number }>> {
  return runAction('saveAgent', 'Could not save the agent.', async () => {
    const agent = await agents.updateAgent(await fromSession(), agentId, updates as agents.AgentInput)
    revalidatePath('/agents')
    revalidatePath(`/agents/${agentId}`)
    return { version: Number(agent.version) || 1 }
  })
}

export async function deleteAgent(agentId: string) {
  await agents.deleteAgent(await fromSession(), agentId)
  revalidatePath('/agents')
}

export async function bulkDeleteAgents(agentIds: string[]) {
  const ctx = await fromSession()
  const uniqueIds = Array.from(new Set(agentIds.map((id) => id.trim()).filter(Boolean)))
  let queued = 0
  for (const id of uniqueIds) {
    try {
      await agents.deleteAgent(ctx, id)
      queued++
    } catch (error) {
      if (!(error instanceof ServiceError && error.code === 'not_found')) throw error
    }
  }
  revalidatePath('/agents')
  return { queued }
}

export async function restoreAgentVersion(agentId: string, version: number): Promise<ActionResult<{ version: number }>> {
  return runAction('restoreAgentVersion', 'Could not restore that version.', async () => {
    const agent = await agents.restoreAgentVersion(await fromSession(), agentId, version)
    revalidatePath(`/agents/${agentId}`)
    return { version: Number(agent.version) || 1 }
  })
}

export async function saveAgentEvalCase(agentId: string, input: { id?: string | null; name: string; input_message: string; expected?: unknown; is_active?: boolean }): Promise<ActionResult<{ case: any }>> {
  return runAction('saveAgentEvalCase', 'Could not save the test case.', async () => agents.saveEvalCase(await fromSession(), agentId, input))
}

export async function deleteAgentEvalCase(agentId: string, caseId: string): Promise<ActionResult<{ deleted: boolean }>> {
  return runAction('deleteAgentEvalCase', 'Could not delete the test case.', async () => agents.deleteEvalCase(await fromSession(), agentId, caseId))
}

export async function runAgentEvals(agentId: string, caseIds?: string[]): Promise<ActionResult<{ run: any }>> {
  return runAction('runAgentEvals', 'Could not start the evaluation.', async () => agents.startEvalRun(await fromSession(), agentId, { case_ids: caseIds }))
}

/** Upload a knowledge document (FormData `file`); returns the stored file object to add to output_config.knowledge.files. */
export async function uploadAgentKnowledgeFile(formData: FormData): Promise<ActionResult<{ name: string; url: string; path: string; ref?: string; size: number; mime_type: string }>> {
  return runAction('uploadAgentKnowledgeFile', 'Upload failed.', async () => {
    const file = formData.get('file')
    if (!file || typeof file === 'string') throw ServiceError.validation('No file was uploaded')
    const { uploadAgentKnowledgeFile: upload } = await import('@/lib/services/uploads')
    return upload(await fromSession(), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) })
  })
}

/** Agents → Costs & budgets: the workspace's price overrides and budgets (settings.edit). */
export async function saveAgentCostSettings(input: { model_prices?: unknown; budgets?: unknown }) {
  return runAction('saveAgentCostSettings', 'Could not save the prices and budgets.', async () => {
    const result = await agents.saveAgentCostSettings(await fromSession(), input)
    revalidatePath('/agents/costs')
    return result
  })
}
