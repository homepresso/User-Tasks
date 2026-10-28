'use client'

/**
 * Latest versions of the reusable forms a workflow's nodes link (User Task,
 * Form submitted, task triggers), so the data picker / Variables panel /
 * Data sidebar list their fields even when a node's cached copy is missing
 * (e.g. an imported workflow) or older than the form's latest version —
 * without opening each node. Read-only: the cache on the node is still
 * refreshed by the node's form section when it is opened.
 */

import { createContext, useContext, useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { linkedFormIds } from '@/lib/forms/definition'
import type { LinkedFormLike } from '@/lib/workflow-data-picker'

type LinkedForms = Record<string, LinkedFormLike>

const LinkedFormsContext = createContext<LinkedForms | null>(null)
export const LinkedFormsProvider = LinkedFormsContext.Provider

export function useLinkedForms(): LinkedForms | null {
  return useContext(LinkedFormsContext)
}

/** Fetch (shared cache key with the node form section) the forms `nodes` link. */
export function useLinkedFormsQuery(nodes: unknown): LinkedForms {
  const { can } = usePermissions()
  const canView = can('forms.view')
  const ids = useMemo(() => [...linkedFormIds(nodes).keys()].sort(), [nodes])
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['form', id],
      enabled: canView,
      staleTime: 15_000,
      queryFn: async () => {
        const result = await serverRead('forms.get', { id })
        return result.data as ({ id: string; name: string; version: number; fields: unknown } | null)
      },
    })),
  })
  const stamp = results.map((r) => `${r.data?.id ?? ''}:${r.data?.version ?? ''}:${r.dataUpdatedAt}`).join('|')
  return useMemo(() => {
    const out: LinkedForms = {}
    results.forEach((r, i) => {
      if (r.data) out[ids[i]] = { fields: r.data.fields, version: r.data.version, name: r.data.name }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, ids])
}
