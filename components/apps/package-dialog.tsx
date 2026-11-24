"use client"

/**
 * Package / Export an app (Apps I design card, app settings): lists what the
 * package will include — the app (pages, menu, settings, uploaded icons) and
 * every form, workflow, data table, report, API reference + integration
 * (definitions only, never credentials), agent and linked app it uses —
 * lets the builder leave dependencies out and add sample rows per data table,
 * then builds the next signed version of the app's package and downloads
 * the .utpkg. The package also appears in Settings → Packages (Authored).
 */

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Download, KeyRound, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Badge } from "@/components/ui/badge"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { packageAppAction, previewAppPackageAction } from "@/app/actions/apps"
import { TYPE_ICON } from "@/components/packages/asset-picker"

type Ref = { type: string; id: string }
const key = (r: Ref) => `${r.type}:${r.id}`

function downloadBase64(name: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AppPackageDialog({ app, open, onOpenChange }: { app: { id: string; name: string }; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [excluded, setExcluded] = useState<Ref[] | null>(null)
  const [dataModes, setDataModes] = useState<Record<string, "schema" | "rows"> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ file: string; version: string; warnings: string[] } | null>(null)
  // Drafts: the published version travels by default; "Export the draft instead" packages the working draft.
  const [content, setContent] = useState<"published" | "draft">("published")

  const preview = useQuery({
    queryKey: ["app-package-preview", app.id, excluded, dataModes, content],
    queryFn: async () => {
      const r = await previewAppPackageAction(app.id, { ...(excluded ? { excluded } : {}), ...(dataModes ? { data_modes: dataModes } : {}), content })
      if (!r.ok) throw new Error(r.error)
      return r.data
    },
    enabled: open,
    placeholderData: (previous) => previous,
  })
  const data = preview.data
  const currentExcluded = excluded ?? (data?.package?.excluded as Ref[] | undefined) ?? []
  const currentModes = dataModes ?? (data?.package?.data_modes as Record<string, "schema" | "rows"> | undefined) ?? {}
  const items = (data?.contents.items ?? []) as Array<Ref & { name: string; label: string; included_as: string; row_count?: number }>
  const excludedNames = new Map((data?.contents.excluded ?? []).map((e: Ref & { name: string | null }) => [key(e), e.name]))

  const leaveOut = (ref: Ref) => setExcluded([...currentExcluded, { type: ref.type, id: ref.id }])
  const include = (ref: Ref) => setExcluded(currentExcluded.filter((r) => key(r) !== key(ref)))

  const build = async () => {
    setBusy(true); setError(null)
    const result = await packageAppAction(app.id, { excluded: currentExcluded, data_modes: currentModes, content })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    if (result.data.file_base64) downloadBase64(result.data.file_name, result.data.file_base64)
    setDone({ file: result.data.file_name, version: String(result.data.version?.version ?? ""), warnings: result.data.warnings ?? [] })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) { setDone(null); setError(null) } }}>
      <DialogContent size="lg" title={`Package ${app.name}`} description="A signed .utpkg with the app and what it uses. Install it in another workspace from Settings → Packages.">
        <DialogBody>
          {error && <InlineNotice tone="error" message={error} className="mb-3" />}
          {done ? (
            <div className="space-y-3" data-app-package-done>
              <InlineNotice tone="success" message={`Downloaded ${done.file} (version ${done.version}).`} />
              {done.warnings.map((w) => <InlineNotice key={w} tone="warning" message={w} />)}
              <p className="text-sm text-fg-muted">The package is kept in <Link className="text-primary-text underline" href="/settings/packages?tab=authored">Settings → Packages</Link>: package the app again to publish the next version, and installs elsewhere upgrade in place (their audience, editors and pages they added are kept).</p>
            </div>
          ) : (
            <div className="space-y-4">
              {data?.has_draft_changes && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-ui" data-app-package-content>
                  <span className="text-fg">{content === "draft" ? "Packages the working draft (unpublished changes included)." : "Packages the published version — the draft has unpublished changes."}</span>
                  <Switch className="ml-auto" checked={content === "draft"} onCheckedChange={(v) => setContent(v ? "draft" : "published")} label="Export the draft instead" />
                </div>
              )}
              <p className="text-sm text-fg-muted">Never included: the audience and editors (whoever installs it chooses who can use it and becomes its editor), credentials, this workspace’s embed allow-list and usage data.</p>
              <div className="max-h-72 divide-y divide-border-subtle overflow-y-auto rounded-lg border border-border text-ui scrollbar-thin" data-app-package-contents>
                {preview.isLoading && <p className="px-3 py-2 text-xs text-fg-muted" role="status">Finding what the app uses…</p>}
                {items.map((item) => {
                  const Icon = TYPE_ICON[item.type]
                  const root = item.included_as === "root"
                  return (
                    <div key={key(item)} className="flex min-h-10 items-center gap-2 px-3 py-1" data-package-item={item.type}>
                      {Icon && <Icon size={14} className="shrink-0 text-fg-muted" aria-hidden />}
                      <span className="w-28 shrink-0 text-xs text-fg-muted">{item.label}</span>
                      <span className="truncate text-fg">{item.name}</span>
                      {root ? <Badge tone="brand">This app</Badge> : <Badge tone="neutral">{item.type === "integration" || item.type === "connector" ? "Definition only" : "Used by the app"}</Badge>}
                      <div className="ml-auto flex items-center gap-1">
                        {item.type === "data_table" && (
                          <Select size="sm" wrapperClassName="w-auto" value={currentModes[item.id] ?? "schema"} aria-label={`${item.name} data`}
                            onChange={(e) => setDataModes({ ...currentModes, [item.id]: e.target.value as "schema" | "rows" })}
                            options={[{ value: "schema", label: "No rows" }, { value: "rows", label: `Sample data (${item.row_count ?? 0} rows)` }]} />
                        )}
                        {!root && <IconButton size="sm" label={`Leave out ${item.name}`} icon={<X />} onClick={() => leaveOut(item)} />}
                      </div>
                    </div>
                  )
                })}
                {currentExcluded.map((ref) => (
                  <div key={`x-${key(ref)}`} className="flex items-center gap-2 px-3 py-1.5 text-xs text-fg-muted">
                    <span className="w-28 shrink-0">Left out</span>
                    <span className="truncate">{excludedNames.get(key(ref)) ?? `${ref.type.replace(/_/g, " ")} ${ref.id.slice(0, 8)}`}</span>
                    <Button size="sm" variant="ghost" className="ml-auto" leadingIcon={<RotateCcw />} onClick={() => include(ref)}>Include</Button>
                  </div>
                ))}
              </div>
              {currentExcluded.length > 0 && <p className="text-xs text-fg-muted">Left-out items must already exist where the package is installed, or the widgets that use them show empty.</p>}
              {(data?.contents.warnings ?? []).map((w: string) => <InlineNotice key={w} tone="warning" message={w} />)}
              {(data?.embed_origins ?? []).length > 0 && (
                <InlineNotice tone="info" message={`Its Embed widgets frame ${data!.embed_origins.join(", ")}. The installing workspace must allow these sites (Settings → Embedding); the install preview lists the missing ones.`} />
              )}
              {(data?.people ?? 0) > 0 && <p className="text-xs text-fg-muted">People and teams named in filters or visibility rules are kept only where they exist in the installing workspace.</p>}
              {(data?.contents.requirements ?? []).length > 0 && (
                <div>
                  <p className="mb-1.5 text-ui font-medium text-fg">Asked for on install</p>
                  <ul className="space-y-1 text-ui text-fg">
                    {data!.contents.requirements.map((r: { id: string; label: string; required: boolean }) => <li key={r.id} className="flex items-center gap-1.5"><KeyRound size={14} className="text-fg-muted" aria-hidden /> {r.label}{!r.required && <span className="text-xs text-fg-muted">(optional)</span>}</li>)}
                  </ul>
                </div>
              )}
              {data?.package?.latest_version && <p className="text-xs text-fg-muted">Last packaged as version {data.package.latest_version}; this builds the next version.</p>}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{done ? "Close" : "Cancel"}</Button>
          {!done && <Button leadingIcon={<Download />} loading={busy} disabled={!items.length} onClick={() => void build()} data-app-package-build>Download package</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
