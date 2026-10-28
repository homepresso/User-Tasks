"use client"

import { createContext, useContext, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import type { SummaryLookups } from "@/lib/workflow-utils"
import type { TableNames } from "@/lib/workflow-table-refs"

/** Names of records referenced by node configs (data tables), for card summaries. */
export const WorkflowLookupsContext = createContext<SummaryLookups>({})

export function useWorkflowLookups(): SummaryLookups {
  return useContext(WorkflowLookupsContext)
}

/** id → name of the tenant's data tables (RLS scoped); undefined until loaded. */
export function useDataTableNames(): TableNames | undefined {
  const { data } = useQuery({
    queryKey: ["workflow-data-table-names"],
    queryFn: async () => {
      const names: TableNames = {}
      for (const t of await serverQuery("automations.dataTableNames")) names[t.id] = t.name
      return names
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return data
}

/** Loads the lookups once and shares them with every card below (designer, viewers). */
export function WorkflowLookupsProvider({ children, value }: { children: React.ReactNode; value?: SummaryLookups }) {
  const tableNames = useDataTableNames()
  const lookups = useMemo<SummaryLookups>(() => value ?? { tableNames }, [value, tableNames])
  return <WorkflowLookupsContext.Provider value={lookups}>{children}</WorkflowLookupsContext.Provider>
}
