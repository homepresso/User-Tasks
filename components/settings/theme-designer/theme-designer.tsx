"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Moon, Redo2, RotateCcw, Sun, Undo2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { InlineNotice } from "@/components/ui/inline-notice"
import { useWorkspaceTheme } from "@/components/providers/theme-provider"
import { getThemeDesignerData, saveWorkspaceTheme, type ThemeDesignerData } from "@/app/actions/workspace-theme"
import { blockingContrastIssues } from "@/lib/theme/contrast"
import { designerReducer, exportThemeJson, initDesigner, isDirty, parseThemeImport, type ThemePath } from "@/lib/theme/designer-state"
import { presetToWorkspaceTheme } from "@/lib/theme/presets"
import { WorkspaceThemeSchema, formatThemeIssues, type ThemeMode } from "@/lib/theme/schema"
import { ChromeSection, BrandingSection, ColorsSection, LayoutSection, ShapeSection, TemplateSection, TypographySection } from "./sections"
import { SegmentedField, TextField } from "./controls"
import { ThemePreview } from "./theme-preview"

/**
 * The workspace theme designer (/settings/theme). Left: sections editing a
 * draft (undo/redo, import/export JSON, templates); right: a live preview of
 * the app with the draft applied. Saving replaces the theme for everyone in
 * the workspace, after a confirmation, with an optimistic version check.
 * Without settings.edit the same view is read-only.
 */
export function ThemeDesigner({ initial, editable, workspaceLogoUrl }: { initial: ThemeDesignerData; editable: boolean; workspaceLogoUrl?: string | null }) {
  const router = useRouter()
  const { theme: appTheme, mode: appMode } = useWorkspaceTheme()
  const [state, dispatch] = useReducer(designerReducer, undefined, () => initDesigner(initial.theme, initial.version))
  const [mode, setMode] = useState<ThemeMode>(initial.theme.meta.mode === "dark" ? "dark" : initial.theme.meta.mode === "light" ? "light" : appMode)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null)
  const [conflict, setConflict] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  const theme = state.present
  const dirty = isDirty(state)
  const validation = useMemo(() => WorkspaceThemeSchema.safeParse(theme), [theme])
  const blocking = useMemo(() => (validation.success ? blockingContrastIssues(validation.data) : []), [validation])
  const canSave = editable && dirty && validation.success && blocking.length === 0 && !saving

  const set = useCallback((path: ThemePath, value: unknown) => dispatch({ type: "set", path, value }), [])

  // Undo / redo shortcuts, except while typing in a text field (its own undo).
  useEffect(() => {
    if (!editable) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || (target.tagName === "INPUT" && !["color", "range", "checkbox", "radio"].includes((target as HTMLInputElement).type)) || target.tagName === "TEXTAREA")) return
      const key = e.key.toLowerCase()
      if (key === "z" && !e.shiftKey) { e.preventDefault(); dispatch({ type: "undo" }) }
      else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); dispatch({ type: "redo" }) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [editable])

  // Leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", onUnload)
    return () => window.removeEventListener("beforeunload", onUnload)
  }, [dirty])

  function applyTemplate(id: string) {
    const template = presetToWorkspaceTheme(id)
    if (!template) return
    // Logos and wordmark belong to the workspace, not the template.
    dispatch({ type: "replace", theme: { ...template, branding: theme.branding } })
  }

  function resetToTemplate() {
    const id = theme.meta.basePreset
    const template = id ? presetToWorkspaceTheme(id) : null
    if (template) dispatch({ type: "replace", theme: { ...template, meta: { ...template.meta, name: theme.meta.name }, branding: theme.branding } })
  }

  async function save(expectedVersion = state.version) {
    if (!validation.success) return
    setSaving(true); setNotice(null)
    const result = await saveWorkspaceTheme(validation.data, expectedVersion)
    setSaving(false)
    setConfirming(false)
    if ("error" in result) {
      setConflict(Boolean(result.conflict))
      setNotice({ tone: "error", message: result.error })
      return
    }
    setConflict(false)
    dispatch({ type: "saved", theme: result.theme, version: result.version })
    const warnings = result.contrast.length
    setNotice({ tone: warnings ? "warning" : "success", message: `Saved — everyone in the workspace now sees “${result.theme.meta.name}”.${warnings ? ` ${warnings} contrast warning${warnings === 1 ? "" : "s"} remain (below AA).` : ""}` })
    // The theme stylesheet is rendered by the dashboard layout on the server.
    router.refresh()
  }

  /** Version conflict: load the stored theme (losing the draft) or overwrite it. */
  async function loadLatest() {
    const latest = await getThemeDesignerData()
    if (!latest) { setNotice({ tone: "error", message: "Could not load the workspace theme." }); return }
    dispatch({ type: "saved", theme: latest.theme, version: latest.version })
    setConflict(false)
    setNotice({ tone: "success", message: "Loaded the latest saved theme." })
  }

  async function overwrite() {
    const latest = await getThemeDesignerData()
    if (!latest) { setNotice({ tone: "error", message: "Could not load the workspace theme." }); return }
    await save(latest.version)
  }

  function exportJson() {
    const blob = new Blob([exportThemeJson(theme)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${theme.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace-theme"}.theme.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    const result = parseThemeImport(await file.text())
    if ("error" in result) { setNotice({ tone: "error", message: result.error }); return }
    dispatch({ type: "replace", theme: result.theme })
    setNotice({ tone: "success", message: `Imported “${result.theme.meta.name}”. Review it, then save to apply it to the workspace.` })
  }

  const members = initial.memberCount
  const memberText = members > 0 ? `all ${members} member${members === 1 ? "" : "s"}` : "every member"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Theme</h1>
          <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>
            The brand theme everyone in this workspace sees.{" "}
            {state.version > 0 ? `Version ${state.version}${initial.updatedAt && state.version === initial.version ? `, saved ${new Date(initial.updatedAt).toLocaleString()}` : ""}.` : "Not customised yet (platform default)."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Theme actions">
          {editable && (
            <>
              <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "undo" })} disabled={!state.past.length} aria-label="Undo" title="Undo (Ctrl/⌘ Z)"><Undo2 size={15} aria-hidden /></Button>
              <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "redo" })} disabled={!state.future.length} aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)"><Redo2 size={15} aria-hidden /></Button>
              <Button variant="ghost" size="sm" onClick={resetToTemplate} disabled={!theme.meta.basePreset} title="Reset colours, fonts and layout to the template this theme started from">
                <RotateCcw size={14} aria-hidden /> Reset to template
              </Button>
              <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={importJson} aria-label="Import a theme JSON file" />
              <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}><Upload size={14} aria-hidden /> Import</Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={exportJson}><Download size={14} aria-hidden /> Export</Button>
          {editable && (
            <>
              {dirty && <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "revert" })}>Discard changes</Button>}
              <Button size="sm" onClick={() => setConfirming(true)} disabled={!canSave}>{saving ? "Saving…" : "Save for workspace"}</Button>
            </>
          )}
        </div>
      </div>

      {!editable && (
        <InlineNotice tone="warning" message="You can look at the workspace theme. Members who can edit workspace settings can change it." />
      )}
      {notice && <div role="status"><InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} /></div>}
      {conflict && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>Someone else saved the theme while you were editing.</span>
          <Button size="sm" variant="outline" onClick={loadLatest}>Load their version</Button>
          <Button size="sm" variant="destructive" onClick={overwrite}>Overwrite with mine</Button>
        </div>
      )}
      {editable && !validation.success && (
        <InlineNotice tone="error" message={`The draft can't be saved: ${formatThemeIssues(validation.error)}`} />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(340px,440px)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-xl border lg:max-h-[calc(100vh-11rem)] lg:overflow-y-auto" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)" }}>
          <fieldset disabled={!editable} className="m-0 min-w-0 border-0 p-0">
            <legend className="sr-only">Theme settings</legend>
            <div className="space-y-3 border-b p-4" style={{ borderColor: "var(--theme-surface-border)" }}>
              <TextField
                label="Theme name"
                value={theme.meta.name}
                maxLength={80}
                validate={(v) => (!v.trim() ? "A name is required" : /[<>{}]/.test(v) ? "No <, >, { or }" : null)}
                onChange={(v) => set(["meta", "name"], v)}
              />
              <SegmentedField
                label="Appearance"
                value={theme.meta.mode}
                options={[{ value: "auto", label: "Follow device" }, { value: "light", label: "Always light" }, { value: "dark", label: "Always dark" }]}
                onChange={(v) => { set(["meta", "mode"], v); if (v !== "auto") setMode(v) }}
              />
            </div>
            <TemplateSection theme={theme} mode={mode} onApply={applyTemplate} />
            <ColorsSection theme={theme} set={set} mode={mode} onModeChange={setMode} />
            <TypographySection theme={theme} set={set} mode={mode} />
            <ShapeSection theme={theme} set={set} mode={mode} />
            <LayoutSection theme={theme} set={set} mode={mode} />
            <ChromeSection theme={theme} set={set} mode={mode} />
            <BrandingSection theme={theme} set={set} mode={mode} tenantId={initial.tenantId} readOnly={!editable} />
          </fieldset>
        </div>

        <div className="min-w-0 space-y-2 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Live preview{dirty ? " (unsaved)" : ""}</h2>
            <div className="flex gap-1 rounded-lg border p-0.5" role="group" aria-label="Preview mode" style={{ borderColor: "var(--theme-surface-border)" }}>
              {(["light", "dark"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2"
                  style={{ backgroundColor: mode === m ? "var(--theme-primary-light)" : "transparent", color: mode === m ? "var(--theme-primary-text)" : "var(--theme-card-text)", ["--tw-ring-color" as string]: "var(--theme-focus-ring, var(--theme-primary))" }}
                >
                  {m === "light" ? <Sun size={13} aria-hidden /> : <Moon size={13} aria-hidden />} {m === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>
          <ThemePreview theme={theme} mode={mode} appBaseSize={appTheme.typography.baseSize} logoUrl={workspaceLogoUrl} />
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Apply this theme to the workspace?"
        description={`This changes the theme for ${memberText} of the workspace, right away.`}
        confirmLabel="Save and apply"
        busy={saving}
        onConfirm={() => save()}
      />
    </div>
  )
}
