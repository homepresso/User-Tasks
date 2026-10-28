import { apiRoute } from '@/lib/api/route'
import { migrateWorkflowInstancesEndpoint } from '@/lib/api-schemas/workflows'
import { migrateInstancesHandler } from '@/lib/user-jobs/kinds/api'

/** POST /api/v1/workflows/{id}/instances/migrate — move live instances to another version (dry_run plans only; async variant: 202 job). */
export const POST = apiRoute(migrateWorkflowInstancesEndpoint, migrateInstancesHandler)
