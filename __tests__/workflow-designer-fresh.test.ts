import { describe, expect, it } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { PERSIST_BUSTER, shouldPersistQuery } from '@/components/providers/query-provider'
import { DESIGNER_QUERY_OPTIONS, designerDataReady, saveErrorText } from '@/lib/automations/designer-query'
import { isDesignerEmbedPath } from '@/lib/embed/designers'

/**
 * "Save the workflow and go back into it: it's blank." The designer read its workflow through
 * React Query with a 60 s staleTime and a sessionStorage-persisted cache, and the builder copies
 * that data into local state once: reopening within a minute showed the snapshot from the first
 * open (a new workflow: just its trigger). The designer must always open the latest saved draft.
 */

const ID = 'd39c3238-3bed-4ff5-b087-2d774d46a00a'
const APP_DEFAULTS = { queries: { staleTime: 60_000, gcTime: 300_000, refetchOnWindowFocus: false, retry: 1 } }
const triggerOnly = { workflow: { id: ID, nodes: [{ id: 'trigger' }] } }
const saved = { workflow: { id: ID, nodes: [{ id: 'trigger' }, { id: 'log' }] } }

/** Open the designer (subscribe), wait for the read, close it (unsubscribe). */
async function openDesigner(client: QueryClient, server: { current: unknown; reads: number }) {
  const observer = new QueryObserver(client, {
    queryKey: ['workflow', ID],
    queryFn: async () => { server.reads++; return server.current },
    ...DESIGNER_QUERY_OPTIONS,
  })
  const seen: Array<{ ready: boolean; data: unknown }> = []
  const unsubscribe = observer.subscribe((r) => seen.push({ ready: designerDataReady(r), data: r.data }))
  const first = observer.getCurrentResult()
  seen.unshift({ ready: designerDataReady(first), data: first.data })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await client.getQueryCache().find({ queryKey: ['workflow', ID] })?.promise
  unsubscribe()
  return seen
}

describe('workflow designer always opens the latest saved draft', () => {
  it('reopening right after a save reads the server again and never renders the old snapshot', async () => {
    const client = new QueryClient({ defaultOptions: APP_DEFAULTS })
    const server = { current: triggerOnly as unknown, reads: 0 }
    await openDesigner(client, server)
    server.current = saved // the person designed, saved and published, then closed the designer
    const reopen = await openDesigner(client, server)
    expect(server.reads).toBe(2)
    // The builder only renders ready data, and ready data is the saved draft.
    const rendered = reopen.filter((s) => s.ready).map((s) => s.data)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered).toEqual(rendered.map(() => saved))
  })

  it('a snapshot restored from sessionStorage (older builds) is not rendered before the fresh read', async () => {
    const client = new QueryClient({ defaultOptions: APP_DEFAULTS })
    client.setQueryData(['workflow', ID], triggerOnly) // as PersistQueryClientProvider restores it
    const server = { current: saved as unknown, reads: 0 }
    const seen = await openDesigner(client, server)
    expect(seen[0]).toEqual({ ready: false, data: triggerOnly })
    const ready = seen.filter((s) => s.ready).map((s) => s.data)
    expect(ready.length).toBeGreaterThan(0)
    expect(ready).toEqual(ready.map(() => saved))
  })

  it('the designer draft is never persisted, and older persisted caches are dropped', () => {
    const client = new QueryClient()
    client.setQueryData(['workflow', ID], saved)
    expect(shouldPersistQuery(client.getQueryCache().find({ queryKey: ['workflow', ID] })!)).toBe(false)
    expect(PERSIST_BUSTER).toBeTruthy()
  })

  it('embedded designer responses are marked no-store', () => {
    expect(isDesignerEmbedPath(`/embed/workflows/${ID}`)).toBe(true)
    expect(isDesignerEmbedPath(`/embed/workflows/${ID}/runs`)).toBe(true)
    expect(isDesignerEmbedPath(`/embed/forms/${ID}/design`)).toBe(true)
    expect(isDesignerEmbedPath('/embed/f/abc')).toBe(false)
    expect(isDesignerEmbedPath('/embed/x/sharepoint/launch')).toBe(false)
  })

  it('a failed save says so in a plain sentence', () => {
    expect(saveErrorText(new Error('An error occurred in the Server Components render.'))).toMatch(/could not be saved.*signed in/)
    expect(saveErrorText(new Error('JSON object requested, multiple (or no) rows returned'))).toMatch(/no longer exists or you can no longer edit it/)
    expect(saveErrorText(new Error('Workflow name is required'))).toBe('Your changes could not be saved: Workflow name is required')
    expect(saveErrorText(undefined)).toMatch(/could not be saved/)
  })
})
