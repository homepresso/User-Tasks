import { apiRoute } from '@/lib/api/route'
import { getAppRuleTypesEndpoint } from '@/lib/api-schemas/apps'
import { listRuleTypes } from '@/lib/services/apps'

/** GET /api/v1/apps/rule-types — triggers, actions, system variables and rule JSON schemas. */
export const GET = apiRoute(getAppRuleTypesEndpoint, async () => listRuleTypes())
