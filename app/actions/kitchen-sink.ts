'use server'

import { fromSession, isServiceError, requirePerm } from '@/lib/services/context'
import { serviceRoleClient } from '@/lib/services/_shared'
import { applyConfig } from '@/lib/services/config'
import { publishWorkflow } from '@/lib/services/workflows'
import { buildKitchenSink, KITCHEN_SINK_IDS } from '@/lib/kitchen-sink/build'

/*
 * "Install the kitchen sink self-test" (Workflows page, admins): imports the
 * kitchen sink bundle (lib/kitchen-sink/build.ts — the same manifest as
 * examples/kitchen-sink/kitchen-sink.bundle.json) through the normal config
 * import (applyConfig), so every section is permission-gated with the
 * signed-in user's permissions exactly as Workflows → Import is.
 * Idempotent: the bundle's fixed source ids are mapped to the local assets on
 * the first install, and adopt_by_name picks up assets of the same name, so
 * installing again updates in place instead of duplicating.
 * Both workflows are then published (Run uses the published version) when
 * they have no published version yet or the import changed them.
 */

export type InstallKitchenSinkResult =
  | { ok: true; workflow_id: string | null; created: number; updated: number; errors: string[] }
  | { ok: false; error: string }

export async function installKitchenSinkAction(): Promise<InstallKitchenSinkResult> {
  try {
    const session = await fromSession()
    // Admin-only: settings.edit on top of the per-section permissions the import checks.
    requirePerm(session, 'settings.edit')
    requirePerm(session, 'workflows.create')
    requirePerm(session, 'workflows.activate')
    const ctx = { ...session, supabase: await serviceRoleClient(session) }
    const result = await applyConfig(ctx, {
      manifest: buildKitchenSink().bundle,
      dry_run: false,
      adopt_by_name: true,
      source_label: 'kitchen-sink',
    })
    const sum = (counts: Record<string, number> | undefined) => Object.values(counts ?? {}).reduce((a, b) => a + b, 0)
    const changed = sum(result.result?.created) + sum(result.result?.updated) > 0
    const workflowId = result.id_map?.workflow?.[KITCHEN_SINK_IDS.workflow] ?? null
    if (!result.result?.errors?.length) {
      for (const sourceId of [KITCHEN_SINK_IDS.subWorkflow, KITCHEN_SINK_IDS.workflow]) {
        const localId = result.id_map?.workflow?.[sourceId]
        if (!localId) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped service client
        const { data: row } = await (ctx.supabase as any).from('workflows').select('published_version_id').eq('id', localId).eq('tenant_id', ctx.tenantId).maybeSingle()
        if (changed || !row?.published_version_id) await publishWorkflow(ctx, localId, 'Kitchen sink self-test installed')
      }
    }
    return {
      ok: true,
      workflow_id: workflowId,
      created: sum(result.result?.created),
      updated: sum(result.result?.updated),
      errors: (result.result?.errors ?? []).map((e) => `${e.asset_type}: ${e.error}`),
    }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}
