import { serializeOpenApiDocument } from '@/lib/api-schemas/openapi'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { extensionEndpointDefs } from '@/lib/extensions/api'

// The document is derived purely from the in-code registry, so it is built
// once at build time and served statically.
export const dynamic = 'force-static'

/** GET /api/v1/openapi.json — public OpenAPI 3.1 document (no auth). */
export async function GET() {
  // Core endpoints plus those of the extensions compiled into this build
  // (/ext/<id>/…, tagged and marked x-usertasks-extension; none in the public build).
  const extensions = extensionEndpointDefs()
  return new Response(serializeOpenApiDocument(extensions.length ? [...API_ENDPOINTS, ...extensions] : API_ENDPOINTS), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
