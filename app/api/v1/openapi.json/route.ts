import { serializeOpenApiDocument } from '@/lib/api-schemas/openapi'

// The document is derived purely from the in-code registry, so it is built
// once at build time and served statically.
export const dynamic = 'force-static'

/** GET /api/v1/openapi.json — public OpenAPI 3.1 document (no auth). */
export async function GET() {
  return new Response(serializeOpenApiDocument(), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
