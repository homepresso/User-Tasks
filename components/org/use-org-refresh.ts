'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/** Refetch every Organization read (and the Team page's) after a change. */
export function useOrgRefresh() {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['org'] }),
      queryClient.invalidateQueries({ queryKey: ['teams'] }),
      queryClient.invalidateQueries({ queryKey: ['reporting-lines'] }),
    ])
  }, [queryClient])
}
