/**
 * Files for a Run Agent step (server only): resolved file values (file
 * objects / lists) → the user-message parts for the model's API and the
 * files behind read_attached_file. Shared by the inline step and the queued
 * mode (the job stores the file values, not their bytes).
 */
import type { ExecuteAgentOptions } from '@/lib/agent-executor'
import { resolveAgentEndpoint } from './provider'
import type { LoadedAgent } from './prepare'

export interface RunAgentFiles {
  attachments: NonNullable<ExecuteAgentOptions['attachments']>
  summary: Array<{ name: string; size: number; mime_type: string; sent_as: string }>
}

export async function loadRunAgentFilesWithSummary(values: unknown[], tenantId: string, loaded: LoadedAgent): Promise<RunAgentFiles> {
  const { loadStepFiles } = await import('@/lib/workflow-files')
  const { buildAgentFileParts, AGENT_FILE_LIMITS } = await import('@/lib/agent-files')
  const loadedFiles = await loadStepFiles(values, { tenantId, maxFiles: AGENT_FILE_LIMITS.maxFiles, maxTotalBytes: AGENT_FILE_LIMITS.maxTotalBytes })
  const endpoint = resolveAgentEndpoint(loaded.integration)
  const shaped = await buildAgentFileParts(loadedFiles, String(loaded.integration.config.base_url ?? ''), endpoint.kind)
  const ids = values.map((v: any) => (v && typeof v === 'object' && typeof v.id === 'string' ? v.id.toLowerCase() : undefined))
  return {
    attachments: { parts: shaped.parts, files: loadedFiles.map((f, i) => ({ id: ids[i], name: f.name, mime_type: f.mime_type, bytes: f.bytes })) },
    summary: shaped.summary,
  }
}

export async function loadRunAgentFiles(values: unknown, tenantId: string, loaded: LoadedAgent): Promise<RunAgentFiles['attachments']> {
  const list = Array.isArray(values) ? values : [values]
  return (await loadRunAgentFilesWithSummary(list, tenantId, loaded)).attachments
}
