"use client"

import { useMemo } from "react"
import { CircleCheck, Info, Sparkles, TriangleAlert, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover } from "@/components/ui/popover"
import { applyAllFixes, applyCheckFix, menuChecks, pageChecks, type CheckApp, type DesignCheck } from "@/lib/apps/lint"
import type { AppWidget } from "@/lib/apps/schema"

/**
 * The builder's Checks button and panel (lib/apps/lint.ts): what would make
 * this page look unfinished to the people using it — placeholder labels,
 * duplicate or redundant navigation, a page header that isn't at the top,
 * untitled data widgets, oversized lists, mismatched icons — each with its
 * one-click fix where the fix is safe, and "Fix all". App-menu items are
 * fixed in App settings.
 */
export function usePageChecks(app: CheckApp, widgets: readonly AppWidget[]): DesignCheck[] {
  return useMemo(() => [...pageChecks(app, { title: "", widgets }), ...menuChecks(app)], [app, widgets])
}

export function PageChecksButton({ app, widgets, checks, onChange, onSelect, onOpenSettings }: {
  app: CheckApp
  widgets: readonly AppWidget[]
  checks: DesignCheck[]
  onChange: (widgets: AppWidget[]) => void
  onSelect: (widgetId: string) => void
  onOpenSettings: () => void
}) {
  const warnings = checks.filter((c) => c.severity === "warning").length
  const fixable = checks.filter((c) => c.fix && c.widget && c.fix.kind !== "auto_height").length
  return (
    <Popover width={420} aria-label="Design checks"
      trigger={(t) => (
        <Button {...t} size="sm" variant={warnings ? "secondary" : "ghost"} data-page-checks={checks.length}
          leadingIcon={warnings ? <TriangleAlert className="text-warning" /> : checks.length ? <Info className="text-info" /> : <CircleCheck className="text-success" />}>
          {checks.length ? `Checks (${checks.length})` : "Checks OK"}
        </Button>
      )}>
      {(close) => (
        <div className="space-y-2" data-page-checks-panel>
          <div className="flex items-center justify-between gap-2">
            <p className="text-ui font-semibold text-fg">Design checks</p>
            {fixable > 1 && (
              <Button size="sm" variant="secondary" leadingIcon={<Sparkles />} onClick={() => onChange(applyAllFixes(widgets, app))} data-page-checks-fix-all>Fix all ({fixable})</Button>
            )}
          </div>
          {!checks.length ? (
            <p className="flex items-center gap-2 text-ui text-fg-muted"><CircleCheck className="size-4 text-success" aria-hidden />Nothing to tidy up on this page.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
              {checks.map((c) => (
                <li key={c.key} className="rounded-md border border-border-subtle p-2.5" data-page-check={c.code}>
                  <div className="flex items-start gap-2">
                    {c.severity === "warning" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-label="Warning" /> : <Info className="mt-0.5 size-4 shrink-0 text-info" aria-label="Note" />}
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg">{c.message}</p>
                  </div>
                  {(c.widget || c.key.endsWith(":menu")) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
                      {c.fix && c.widget && (
                        <Button size="sm" variant="secondary" leadingIcon={<Wand2 />} onClick={() => onChange(applyCheckFix(widgets, c, app))} data-page-check-fix={c.fix.kind}>{c.fix.label}</Button>
                      )}
                      {c.widget && <Button size="sm" variant="ghost" onClick={() => { onSelect(c.widget!); close() }}>Show widget</Button>}
                      {c.key.endsWith(":menu") && <Button size="sm" variant="ghost" onClick={() => { onOpenSettings(); close() }}>Open App settings</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-2xs text-fg-muted">Fixes change this page only; Save to keep them. Publishing lists the same warnings.</p>
        </div>
      )}
    </Popover>
  )
}
