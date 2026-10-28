'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as search from '@/lib/services/search'

/* Search box and data-table row search, run server-side (lib/services/search). */

export async function globalSearch(query: string): Promise<ActionResult<search.GlobalSearchResults>> {
  return runAction('globalSearch', 'Search failed.', async () => search.globalSearch(await fromSession(), query))
}

export async function searchDataTableRows(query: string, limit = 50): Promise<ActionResult<Awaited<ReturnType<typeof search.searchDataTableRows>>>> {
  return runAction('searchDataTableRows', 'Search failed.', async () => search.searchDataTableRows(await fromSession(), query, limit))
}
