"use client"

import { QueryClient, defaultShouldDehydrateQuery, type Query } from "@tanstack/react-query"
import { PersistQueryClientProvider, type Persister } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { useState } from "react"

/**
 * Query key prefixes never written to sessionStorage: report aggregates, run
 * lists/traces and data-table rows are large, change often, and the sync
 * persister serialises the whole cache on the main thread.
 */
const NON_PERSISTED_PREFIXES = new Set([
  "reports",
  "workflow-runs-list",
  "workflow-run-stats",
  "workflow-queue",
  "trace",
  "timeline",
  "custom-table-rows",
])

/** Single queries larger than this (serialised) are not persisted either. */
const MAX_PERSISTED_QUERY_CHARS = 200_000

export function shouldPersistQuery(query: Query): boolean {
  if (!defaultShouldDehydrateQuery(query)) return false
  if (query.meta?.persist === false) return false
  const prefix = query.queryKey[0]
  if (typeof prefix === "string" && NON_PERSISTED_PREFIXES.has(prefix)) return false
  try {
    return JSON.stringify(query.state.data ?? null).length <= MAX_PERSISTED_QUERY_CHARS
  } catch {
    return false
  }
}

// Server render (no sessionStorage): a persister that stores nothing, so the
// provider tree is identical on the server and in the first client render.
const noopPersister: Persister = {
  persistClient: () => undefined,
  restoreClient: () => undefined,
  removeClient: () => undefined,
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  )

  // The persister is chosen once per mount; only the browser has
  // sessionStorage. Always rendering PersistQueryClientProvider (instead of a
  // plain QueryClientProvider on the server) avoids the hydration mismatch
  // the two different trees caused. Restoring starts in an effect, so the
  // first client render matches the server's.
  const [persister] = useState<Persister>(() => {
    if (typeof window === "undefined") return noopPersister
    try {
      return createSyncStoragePersister({ storage: window.sessionStorage, key: "rq_cache", throttleTime: 2000 })
    } catch {
      return noopPersister // storage blocked (privacy settings)
    }
  })

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 5 * 60 * 1000,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
