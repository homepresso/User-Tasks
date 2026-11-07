import { apiRoute } from '@/lib/api/route'
import { queryTaskDataTableEndpoint } from '@/lib/api-schemas/tasks'
import { queryDataTable } from '@/lib/services/form-data-table'

/** POST /api/v1/tasks/{id}/data-table — rows of a Data table field of the task's form. */
export const POST = apiRoute(queryTaskDataTableEndpoint, async ({ ctx, params, body }) =>
  queryDataTable(ctx, { task_id: params.id }, body))
