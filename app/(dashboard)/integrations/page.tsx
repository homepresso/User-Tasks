"use client"

import { useState } from "react"
import Link from "next/link"
import { serverRead } from "@/lib/server-read"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, FileJson, FileUp, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CreateIntegrationDialog } from "@/components/integrations/create-integration-dialog"
import { ImportApiDialog } from "@/components/integrations/import-api-dialog"
import { IntegrationsView } from "@/components/integrations/integrations-view"
import { useImportConfig } from "@/components/shared/config-transfer"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { usePermissions } from "@/lib/permissions-context"

/** "Import ▾": a configuration file (config manifest) or an API spec (OpenAPI / Postman). */
function ImportMenu({ canImportConfig }: { canImportConfig: boolean }) {
  const queryClient = useQueryClient()
  const [apiOpen, setApiOpen] = useState(false)
  const config = useImportConfig({
    onImported: () => {
      for (const key of ["integrations", "integration-references", "tenant-connectors", "mcp-servers"]) void queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" leadingIcon={<Upload />} trailingIcon={<ChevronDown />}>Import</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canImportConfig && (
            <DropdownMenuItem icon={<FileUp />} onSelect={() => config.pick()} data-testid="import-config">
              Configuration file…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem icon={<FileJson />} onSelect={() => setApiOpen(true)}>
            API spec (OpenAPI, Swagger, Postman)…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {config.element}
      <ImportApiDialog open={apiOpen} onClose={() => setApiOpen(false)} />
    </>
  )
}

export default function IntegrationsPage() {
  const { can } = usePermissions()

  const { data: integrations, isLoading: isIntegrationsLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => (await serverRead("integrations.list")).data ?? [],
    enabled: can('integrations.view'),
  })

  const { data: references, isLoading: isReferencesLoading } = useQuery({
    queryKey: ["integration-references"],
    queryFn: async () => (await serverRead("integrations.references")).data ?? [],
    enabled: can('integrations.view'),
  })

  const { data: connectors, isLoading: isConnectorsLoading } = useQuery({
    queryKey: ["tenant-connectors"],
    queryFn: async () => (await serverRead("integrations.connectors")).data ?? [],
    enabled: can('integrations.view'),
  })

  const { data: tagDefs, isLoading: isTagDefsLoading } = useQuery({
    queryKey: ["tag-definitions"],
    queryFn: async () => (await serverRead("integrations.tagDefinitions")).data ?? [],
    enabled: can('integrations.view'),
  })

  const { data: mcpServers, isLoading: isMcpServersLoading } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: async () => (await serverRead("integrations.mcpServers")).data ?? [],
    enabled: can('integrations.view'),
  })

  if (!can('integrations.view')) {
    return <EmptyState variant="error" title="You don't have access to integrations" description="Ask a workspace admin for the integrations.view permission." />
  }

  if (
    isIntegrationsLoading &&
    isReferencesLoading &&
    isConnectorsLoading &&
    isTagDefsLoading &&
    isMcpServersLoading &&
    !integrations &&
    !references &&
    !connectors &&
    !tagDefs &&
    !mcpServers
  ) {
    return <PageSkeleton variant="list" />
  }

  return (
    <IntegrationsView
      description={
        <>
          Connect external APIs, databases and services, then expose them as references your workflows, forms and agents call.{" "}
          <Link href="/docs/integrations" className="text-primary-text underline-offset-4 hover:underline">How integrations work</Link>
        </>
      }
      actions={
        <>
          <ImportMenu canImportConfig={can('integrations.create')} />
          <CreateIntegrationDialog />
        </>
      }
      integrations={(integrations as any) ?? []}
      references={(references as any) ?? []}
      connectors={(connectors as any) ?? []}
      initialTagDefs={(tagDefs ?? []) as any}
      mcpServers={(mcpServers as any) ?? []}
    />
  )
}
