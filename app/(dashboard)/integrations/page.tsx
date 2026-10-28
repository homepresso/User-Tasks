"use client"

import { serverRead } from "@/lib/server-read"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import * as Dialog from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"
import { CircleHelp, X } from "lucide-react"
import { CreateIntegrationDialog } from "@/components/integrations/create-integration-dialog"
import { ImportApiButton } from "@/components/integrations/import-api-button"
import { IntegrationsView } from "@/components/integrations/integrations-view"
import { McpBanner } from "@/components/shared/mcp-banner"
import { ImportConfigButton } from "@/components/shared/config-transfer"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { usePermissions } from "@/lib/permissions-context"

export default function IntegrationsPage() {
  const { can } = usePermissions()
  const queryClient = useQueryClient()

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
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Integrations</h1>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-full"
                aria-label="Open integrations help"
                title="How integrations and references work"
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
              <Dialog.Content
                className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,760px)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-6 shadow-xl dialog-content"
                style={{ backgroundColor: "var(--theme-card-bg)" }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Dialog.Title className="text-lg font-semibold" style={{ color: "var(--theme-card-text)" }}>
                      Working With Integrations
                    </Dialog.Title>
                    <Dialog.Description className="mt-1 text-sm" style={{ color: "var(--theme-muted-text)" }}>
                      A quick guide to creating integrations, exposing references, and testing everything before it goes live.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button
                      className="rounded-full p-2 transition hover:opacity-80"
                      style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)" }}
                      aria-label="Close help"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <section className="rounded-2xl border p-4" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>1. Create the integration</h3>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      Create an integration when you want to connect UserTasks to an external API, webhook, OData service, or database-backed endpoint.
                    </p>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      Use <span className="font-medium" style={{ color: "var(--theme-card-text)" }}>Connectors</span> when we already provide a production-ready setup flow. Use direct integrations when you want full control over the endpoint and request design.
                    </p>
                  </section>

                  <section className="rounded-2xl border p-4" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>2. Add references</h3>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      References are the reusable actions your workflows, forms, agents, and MCP tools actually call.
                    </p>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      A good reference should have a clear name, typed inputs, expected outputs, and a stable path or operation so builders can reuse it safely.
                    </p>
                  </section>

                  <section className="rounded-2xl border p-4" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>3. Test before publishing</h3>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      Test the integration connection first to make sure credentials, permissions, scopes, and the remote service are all valid.
                    </p>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      Then test each reference with realistic sample inputs. This validates the request shape and lets you inspect the returned payload before wiring it into automation.
                    </p>
                  </section>

                  <section className="rounded-2xl border p-4" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>4. Reuse across the platform</h3>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      Once a reference is working, it can be used across workflows, forms, agents, MCP, and app assets. That keeps the external system contract defined in one place.
                    </p>
                    <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                      If the external API changes, update the integration or reference once rather than fixing every consumer individually.
                    </p>
                  </section>
                </div>

                <div className="mt-5 rounded-2xl border p-4" style={{ borderColor: "var(--theme-primary)", backgroundColor: "color-mix(in srgb, var(--theme-primary) 8%, var(--theme-card-bg))" }}>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>Best-practice flow</h3>
                  <p className="mt-2 text-sm leading-6" style={{ color: "var(--theme-muted-text)" }}>
                    Start with the smallest useful reference, test it with real payloads, and only then add more specialized references. This keeps integrations easier to govern, document, and debug.
                  </p>
                </div>

                <div className="mt-6 flex justify-end">
                  <Dialog.Close asChild>
                    <Button variant="outline">Close</Button>
                  </Dialog.Close>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
        <div className="flex items-center gap-2">
          {can('integrations.create') && (
            <ImportConfigButton
              onImported={() => {
                for (const key of ["integrations", "integration-references", "tenant-connectors", "mcp-servers"]) void queryClient.invalidateQueries({ queryKey: [key] })
              }}
            />
          )}
          <ImportApiButton />
          <CreateIntegrationDialog />
        </div>
      </div>

      <McpBanner />

      <IntegrationsView
        integrations={(integrations as any) ?? []}
        references={(references as any) ?? []}
        connectors={(connectors as any) ?? []}
        initialTagDefs={(tagDefs ?? []) as any}
        mcpServers={(mcpServers as any) ?? []}
      />
    </div>
  )
}
