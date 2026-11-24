import { apiRoute } from '@/lib/api/route'
import { packageAppEndpoint } from '@/lib/api-schemas/apps'
import { packageApp } from '@/lib/services/app-packages'

/** POST /api/v1/apps/{id}/package — Package / Export: build the app's package and return the .utpkg (base64). */
export const POST = apiRoute(packageAppEndpoint, async ({ ctx, params, body }) => packageApp(ctx, params.id, body))
