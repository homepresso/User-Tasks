import { apiRoute } from '@/lib/api/route'
import { listFavoriteFormsEndpoint } from '@/lib/api-schemas/home'
import { listFavoriteForms } from '@/lib/services/home'

/** GET /api/v1/home/favorite-forms — my favourite forms. */
export const GET = apiRoute(listFavoriteFormsEndpoint, async ({ ctx }) => {
  const forms = await listFavoriteForms(ctx)
  return { forms, total: forms.length }
})
