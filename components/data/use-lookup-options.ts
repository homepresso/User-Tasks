'use client'

import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import type { LookupConfig, LookupOption } from './lookup-config'

export function useLookupOptions(lookup?: LookupConfig, enabled: boolean = true) {
  return useQuery({
    queryKey: ['data-lookup-options', lookup],
    enabled: enabled && Boolean(lookup?.sourceTableId && lookup?.sourceColumn),
    queryFn: async (): Promise<LookupOption[]> => {
      if (!lookup?.sourceTableId || !lookup?.sourceColumn) return []

      // Filtered, sorted and de-duplicated server-side (data.lookupOptions).
      return serverQuery('data.lookupOptions', {
        sourceTableId: lookup.sourceTableId,
        sourceColumn: lookup.sourceColumn,
        filters: lookup.filters?.map(({ column, operator, value }) => ({ column, operator, value })),
        distinct: lookup.distinct,
        sortBy: lookup.sortBy,
        sortDir: lookup.sortDir,
      })
    },
    staleTime: 60_000,
  })
}
