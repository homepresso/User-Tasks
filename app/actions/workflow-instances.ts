'use server'

import { fromSession, isServiceError, type ServiceContext } from '@/lib/services/context'
import { serviceRoleClient } from '@/lib/services/_shared'
import {
  listLiveInstances,
  migrateInstances,
  planInstanceMigration,
  type InstanceMigrationInput,
  type ListLiveInstancesInput,
  type MigrationOutcome,
  type MigrationPlan,
} from '@/lib/services/workflow-runs'

/*
 * Live instance server actions for the workflow page / run detail / queue:
 * thin wrappers over lib/services/workflow-runs. Listing needs
 * workflows.view_runs, planning and migrating workflows.manage_runs (checked
 * there). The service-role client is used so the open tasks of the migrated
 * runs can be closed whoever they are assigned to; every query is
 * tenant-filtered by the service.
 */

type ActionError = { error: string }

async function sessionCtx(): Promise<ServiceContext> {
  const session = await fromSession()
  return { ...session, supabase: await serviceRoleClient(session) }
}

function failure(error: unknown, fallback: string, label: string): ActionError {
  if (isServiceError(error)) return { error: error.message }
  console.error(`[${label}]`, error)
  return { error: fallback }
}

export type LiveInstancesData = Awaited<ReturnType<typeof listLiveInstances>>

export async function getLiveInstances(workflowId: string, input: ListLiveInstancesInput = {}): Promise<LiveInstancesData | ActionError> {
  try {
    return await listLiveInstances(await sessionCtx(), workflowId, input)
  } catch (error) {
    return failure(error, 'Could not load live instances.', 'getLiveInstances')
  }
}

export async function planLiveInstanceMigration(input: InstanceMigrationInput): Promise<MigrationPlan | ActionError> {
  try {
    return await planInstanceMigration(await sessionCtx(), input)
  } catch (error) {
    return failure(error, 'Could not plan the migration.', 'planLiveInstanceMigration')
  }
}

export async function migrateLiveInstances(input: InstanceMigrationInput): Promise<MigrationOutcome | ActionError> {
  try {
    return await migrateInstances(await sessionCtx(), { ...input, dryRun: false })
  } catch (error) {
    return failure(error, 'Could not migrate the instances.', 'migrateLiveInstances')
  }
}
