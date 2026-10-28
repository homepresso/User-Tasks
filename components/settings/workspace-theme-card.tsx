"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Palette } from "lucide-react"
import { usePermissions } from "@/lib/permissions-context"
import { useWorkspaceTheme } from "@/components/providers/theme-provider"
import { AutocompleteSelect } from "@/components/ui/autocomplete-select"
import { Button } from "@/components/ui/button"
import { THEME_TEMPLATES } from "@/lib/theme/presets"
import { applyWorkspaceThemePreset } from "@/app/actions/workspace-theme"

/** Where the theme designer lives (read-only without settings.edit). */
export const THEME_DESIGNER_HREF = "/settings/theme"

const MODE_LABEL = { auto: "Follows each person's light/dark setting", light: "Always light", dark: "Always dark" } as const

/**
 * Appearance tab: the one theme everyone in the workspace sees. Members get a
 * read-only summary; settings.edit holders can switch to a built-in template
 * here and open the designer for everything else.
 */
export function WorkspaceThemeCard() {
  const { can } = usePermissions()
  const router = useRouter()
  const { theme, palette } = useWorkspaceTheme()
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = can("settings.edit")

  async function apply() {
    if (!templateId) return
    setSaving(true); setError(null)
    const result = await applyWorkspaceThemePreset(templateId)
    setSaving(false)
    if ("error" in result) { setError(result.error); return }
    setTemplateId(null)
    // The theme is server-rendered by the dashboard layout.
    router.refresh()
  }

  const swatches = [palette.primary, palette.accent, palette.sidebar, palette.surface, palette.success]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl border p-4" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)" }}>
        <div className="flex h-12 w-20 shrink-0 overflow-hidden rounded-lg border" style={{ borderColor: "var(--theme-surface-border)" }}>
          <div className="w-6" style={{ backgroundColor: palette.sidebar }} />
          <div className="flex flex-1 flex-col gap-1 p-1.5" style={{ backgroundColor: palette.surface }}>
            <div className="h-1.5 w-full rounded-sm" style={{ backgroundColor: palette.topbar, border: `1px solid ${palette.surfaceBorder}` }} />
            <div className="h-2 w-2/3 rounded-sm" style={{ backgroundColor: palette.primary }} />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{theme.meta.name}</p>
          <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>{MODE_LABEL[theme.meta.mode]}</p>
          <div className="mt-1.5 flex gap-1.5">
            {swatches.map((color, i) => (
              <span key={i} className="h-3.5 w-3.5 rounded-full border shadow-sm" style={{ backgroundColor: color, borderColor: "var(--theme-surface-border)" }} />
            ))}
          </div>
        </div>
        <Palette size={18} style={{ color: "var(--theme-muted-text)" }} />
      </div>

      <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
        Everyone in this workspace sees this theme.{" "}
        {editable ? "Change it below, or customise fonts, colours and layout in the theme designer." : "Workspace administrators can change it."}
        {!editable && (
          <>
            {" "}
            <Link href={THEME_DESIGNER_HREF} className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--theme-primary-text)" }}>
              View the theme
            </Link>
          </>
        )}
      </p>

      {editable && (
        <div className="space-y-2">
          {error && <p className="text-xs" style={{ color: "var(--theme-danger)" }}>{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <AutocompleteSelect
              value={templateId}
              onChange={(value) => { setTemplateId(value || null); setError(null) }}
              options={THEME_TEMPLATES.map((t) => ({ value: t.id, label: t.name, hint: t.description }))}
              placeholder="Start from a built-in theme…"
              size="sm"
              className="w-64"
            />
            <Button size="sm" onClick={apply} disabled={!templateId || saving}>
              {saving ? "Applying…" : "Apply to workspace"}
            </Button>
            <Link href={THEME_DESIGNER_HREF} className="ml-auto text-xs font-medium underline-offset-2 hover:underline" style={{ color: "var(--theme-primary-text)" }}>
              Open theme designer
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
