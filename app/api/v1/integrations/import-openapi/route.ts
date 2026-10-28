import { apiRoute } from '@/lib/api/route'
import { importOpenApiEndpoint, importOpenApiOverrides } from '@/lib/api-schemas/integrations'
import { ServiceError } from '@/lib/services/context'
import { importOpenApi } from '@/lib/services/integrations'

/**
 * POST /api/v1/integrations/import-openapi — body is `{ spec, ...overrides }`
 * or the raw OpenAPI/Postman document (overrides from the query string).
 */
export const POST = apiRoute(importOpenApiEndpoint, async ({ ctx, query, body }) => {
  const wrapped = body.spec !== undefined
  const { spec, ...rest } = body
  const overrides = importOpenApiOverrides.safeParse(wrapped ? rest : {})
  if (!overrides.success) {
    throw ServiceError.validation(
      `Validation failed: ${overrides.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`,
      overrides.error.issues.map((issue) => ({ path: ['body', ...issue.path.map(String)].join('.'), message: issue.message, code: issue.code })),
    )
  }
  const result = await importOpenApi(ctx, {
    spec: wrapped ? spec! : body,
    ...overrides.data,
    name: overrides.data.name ?? query.name,
    base_url: overrides.data.base_url ?? query.base_url,
    auth_type: overrides.data.auth_type ?? query.auth_type,
  })
  return {
    integration: result.integration,
    references_created: result.references_created,
    imported_reference_names: result.imported_reference_names,
  }
})
