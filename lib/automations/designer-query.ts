/**
 * How the workflow designer reads its workflow (app/(dashboard)/automations/[id]).
 *
 * The designer must always open the latest saved draft. Two caches used to get in the way:
 *  - the React Query cache, persisted to sessionStorage (components/providers/query-provider),
 *    with a 60 s staleTime: reopening a workflow within a minute of opening it (in the app, or
 *    in SharePoint's UserTasks.aspx frame, which shares the tab's sessionStorage) showed the
 *    snapshot read on the first open — for a new workflow, just its trigger ("blank");
 *  - the builder copies its data into local state once, so a background refetch never reached it.
 * So: never persisted, never fresh from the cache, dropped as soon as the designer closes, and
 * the builder renders only data read after it mounted.
 */

export const DESIGNER_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  refetchOnMount: 'always' as const,
  meta: { persist: false },
}

/** The builder may render: the data was read after this designer opened (not restored from a cache). */
export function designerDataReady(state: { data: unknown; isFetchedAfterMount: boolean }): boolean {
  return state.data !== undefined && state.isFetchedAfterMount
}

/** One plain sentence for a failed save (server action errors are often bare in production). */
export function saveErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const message = raw.trim()
  if (!message || /server components render|digest|unexpected response|failed to fetch|network/i.test(message)) {
    return 'Your changes could not be saved (the connection to UserTasks failed or the session ended). Check you are signed in, then try again. Nothing was lost on this page.'
  }
  if (/0 rows|no rows|PGRST116|multiple \(or no\) rows/i.test(message)) {
    return 'Your changes could not be saved: this workflow no longer exists or you can no longer edit it.'
  }
  return `Your changes could not be saved: ${message.slice(0, 300)}`
}
