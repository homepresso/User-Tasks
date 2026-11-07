import { apiRoute } from '@/lib/api/route'
import { favoriteFormEndpoint, unfavoriteFormEndpoint } from '@/lib/api-schemas/home'
import { setFormFavorite } from '@/lib/services/home'

/** PUT /api/v1/home/favorite-forms/{id} — star a form. */
export const PUT = apiRoute(favoriteFormEndpoint, async ({ ctx, params }) => setFormFavorite(ctx, params.id, true))

/** DELETE /api/v1/home/favorite-forms/{id} — unstar a form. */
export const DELETE = apiRoute(unfavoriteFormEndpoint, async ({ ctx, params }) => setFormFavorite(ctx, params.id, false))
