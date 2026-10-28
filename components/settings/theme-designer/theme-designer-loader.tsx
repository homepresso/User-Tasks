"use client"

import dynamic from "next/dynamic"
import { usePermissions } from "@/lib/permissions-context"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import type { ThemeDesignerData } from "@/app/actions/workspace-theme"

// The designer (controls, preview, every template) is only needed on this
// page: load it as its own chunk.
const ThemeDesigner = dynamic(() => import("./theme-designer").then((m) => m.ThemeDesigner), {
  ssr: false,
  loading: () => <PageSkeleton variant="settings" />,
})

export function ThemeDesignerLoader({ initial, workspaceLogoUrl }: { initial: ThemeDesignerData; workspaceLogoUrl: string | null }) {
  const { can } = usePermissions()
  return <ThemeDesigner initial={initial} editable={can("settings.edit")} workspaceLogoUrl={workspaceLogoUrl} />
}
