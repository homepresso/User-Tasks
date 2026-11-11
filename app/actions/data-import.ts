'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError } from '@/lib/services/context'
import { runAction } from '@/lib/actions/run-action'
import type { ActionResult } from '@/lib/action-result'
import { createDataTable, type DataColumnInput } from '@/lib/services/data-tables'

/*
 * Import wizard (components/data/import-wizard.tsx): "Create from file"
 * makes the table with the columns inferred from the file; the rows are
 * then imported by the `data.import` background job (startJobAction), the
 * same service as POST /api/v1/data-tables/{id}/rows/import.
 */

export interface CreateTableFromFileInput {
  name: string
  description?: string | null
  columns: DataColumnInput[]
}

export type CreateTableFromFileResult =
  | { id: string; name: string; columns: Array<{ key: string; name: string; type: string; options?: string[] }> }
  | { exists: true; name: string }

export async function createTableFromFileAction(input: CreateTableFromFileInput): Promise<ActionResult<CreateTableFromFileResult>> {
  return runAction('createTableFromFile', 'Could not create the table.', async () => {
    const ctx = await fromSession()
    try {
      const table = await createDataTable(ctx, { name: input.name, description: input.description ?? null, columns: input.columns })
      revalidatePath('/data')
      return { id: String(table.id), name: String(table.name), columns: (table.columns ?? []) as Array<{ key: string; name: string; type: string; options?: string[] }> }
    } catch (error) {
      if (isServiceError(error) && error.status === 409) return { exists: true as const, name: input.name }
      throw error
    }
  })
}
