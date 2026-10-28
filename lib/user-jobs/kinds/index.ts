import type { JobKind } from '../define'
import { configApplyJob, configExportJob } from './config'
import { reportExportJob } from './reports'
import { packageBuildJob, packageCompleteJob, packageDownloadJob, packageHistoryCsvJob, packageInstallJob, packageUninstallJob } from './packages'
import { bulkDeleteJob, connectorRegenerateJob, objectPermissionsJob, referencesAddTagJob, rolesBulkJob, workflowsSetActiveJob } from './bulk'
import { instancesMigrateJob, queueBulkJob } from './workflows'
import { directorySyncJob, syncWatchJob } from './sync'
import { API_JOB_KINDS } from './api'
import { formSubmissionsCsvJob } from './forms'

/** Every job kind, by name (lib/user-jobs/runner.ts looks kinds up here). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each kind has its own params type
export const JOB_KINDS: ReadonlyArray<JobKind<any>> = [
  configExportJob,
  configApplyJob,
  reportExportJob,
  packageBuildJob,
  packageDownloadJob,
  packageInstallJob,
  packageCompleteJob,
  packageUninstallJob,
  packageHistoryCsvJob,
  formSubmissionsCsvJob,
  bulkDeleteJob,
  workflowsSetActiveJob,
  objectPermissionsJob,
  referencesAddTagJob,
  rolesBulkJob,
  connectorRegenerateJob,
  instancesMigrateJob,
  queueBulkJob,
  syncWatchJob,
  directorySyncJob,
  ...API_JOB_KINDS,
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see JOB_KINDS
const BY_NAME = new Map<string, JobKind<any>>(JOB_KINDS.map((kind) => [kind.kind, kind]))

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see JOB_KINDS
export function getJobKind(name: string): JobKind<any> | undefined {
  return BY_NAME.get(name)
}

/** Kinds the browser may start with startJobAction (the API variants start from their routes). */
export function isUiJobKind(name: string): boolean {
  return BY_NAME.has(name) && !name.startsWith('api.')
}
