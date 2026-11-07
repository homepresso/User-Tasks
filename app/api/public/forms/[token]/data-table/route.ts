import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { ServiceError } from '@/lib/services/context'
import { anonymousRequest, NO_STORE, publicError, readJson } from '@/lib/public-forms/route'

/** Rows of a Data table field on a public form: only fields with "Allow anonymous read", pages capped (lib/services/form-data-table.ts). */

export const dynamic = 'force-dynamic'

const Body = z.object({
  field_key: z.string().min(1).max(64),
  query: z.record(z.string(), z.unknown()).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const parsed = Body.safeParse(await readJson(request, 128_000))
    if (!parsed.success) throw ServiceError.validation('Invalid request')
    const { ctx, resolved } = await anonymousRequest(request, token)
    const { queryDataTable } = await import('@/lib/services/form-data-table')
    return NextResponse.json(await queryDataTable(ctx, { form_id: resolved.formId }, parsed.data), { headers: NO_STORE })
  } catch (error) {
    return publicError(error, 'The table is not available right now', 'dataTable')
  }
}
