import { z } from 'zod'

/** Any JSON object; used where a route accepts or returns free-form records. */
export const looseObject = z.looseObject({})

export const idParams = z.object({ id: z.string().describe('Resource id') })

/** limit/offset as parsed by parsePagination (limit 1–100, default 50; 0 = no limit). */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(0).optional().describe('Page size (1-100, default 50; 0 = no limit)'),
  offset: z.coerce.number().int().min(0).optional().describe('Rows to skip (default 0)'),
})

/** Comma-separated list filter, e.g. `status=todo,in_progress`. */
export const csvFilter = (description: string) => z.string().optional().describe(`${description} (comma-separated)`)

export const booleanFlag = (description: string) => z.enum(['true', 'false']).optional().describe(description)

/** `{ <key>: [...], total }` list payload. */
export function listResponse(key: string, item: z.ZodType = looseObject) {
  return z.looseObject({ [key]: z.array(item), total: z.number().int() })
}

/** `{ <key>: {...} }` single-resource payload. */
export function itemResponse(key: string, item: z.ZodType = looseObject) {
  return z.looseObject({ [key]: item })
}

export const deletedResponse = z.looseObject({ deleted: z.literal(true) })
