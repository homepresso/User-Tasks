"use client"

import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { uploadAppIconAction } from "@/app/actions/apps"
import { customIconId } from "@/lib/apps/icon-svg"
import { cn } from "@/lib/utils"
import { APP_ICON_NAMES, appIcon, useCustomIcons } from "./app-icon"

/**
 * Icon picker for apps, pages, menu entries, nav items, buttons and tiles:
 * the built-in set, the workspace's uploaded icons (a library shared by
 * every app) and "Upload SVG" (≤ 100 KB, sanitised server-side — app
 * editors only), with "Use theme colour" for single-colour icons and a
 * preview at the sizes they're drawn (card, menu, nav rail).
 */
export function IconPicker({ app, value, onChange, label = "Icon", allowNone = true }: { app: string | null; value: string | null; onChange: (v: string | null) => void; label?: string; allowNone?: boolean }) {
  const icons = useCustomIcons()
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [tint, setTint] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const Current = value ? appIcon(value) : null
  const upload = async (file: File) => {
    if (!app) return
    setBusy(true); setError(null)
    const form = new FormData()
    form.set("file", file); form.set("app", app); form.set("tint", tint ? "1" : "0")
    const r = await uploadAppIconAction(form)
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    await client.invalidateQueries({ queryKey: ["apps", "icons"] })
    onChange(r.data.token)
  }
  return (
    <Popover width={320} aria-label={label}
      trigger={(t) => (
        <button type="button" {...t} className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-panel px-2 text-left text-xs text-fg" aria-label={`${label}: ${value ?? "default"}`} data-icon-picker>
          {Current ? <Current className="size-4" aria-hidden /> : <span className="size-4 rounded-sm border border-dashed border-border" aria-hidden />}
          <span className="truncate">{value ? (customIconId(value) ? icons.data?.find((i) => i.token === value)?.name ?? "Uploaded icon" : value) : "Default icon"}</span>
        </button>
      )}>
      {(close: () => void) => (
        <div className="space-y-2">
          <div className="grid grid-cols-8 gap-1" role="listbox" aria-label="Built-in icons">
            {allowNone && <button type="button" role="option" aria-selected={!value} onClick={() => { onChange(null); close() }} className={cn("col-span-2 rounded-md border px-1 text-2xs", !value ? "border-primary text-primary-text" : "border-border text-fg-muted")}>Default</button>}
            {APP_ICON_NAMES.map((name) => {
              const Icon = appIcon(name)
              return <button key={name} type="button" role="option" aria-selected={value === name} aria-label={name} title={name} onClick={() => { onChange(name); close() }} className={cn("inline-flex size-8 items-center justify-center rounded-md border", value === name ? "border-primary bg-primary-wash text-primary-text" : "border-transparent text-fg-muted hover:bg-subtle")}><Icon className="size-4" aria-hidden /></button>
            })}
          </div>
          {(icons.data?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-fg-subtle">Uploaded icons</p>
              <div className="grid grid-cols-8 gap-1" role="listbox" aria-label="Uploaded icons">
                {icons.data!.map((i) => {
                  const Icon = appIcon(i.token)
                  return <button key={i.id} type="button" role="option" aria-selected={value === i.token} title={i.name} aria-label={i.name} onClick={() => { onChange(i.token); close() }} className={cn("inline-flex size-8 items-center justify-center rounded-md border", value === i.token ? "border-primary bg-primary-wash text-primary-text" : "border-transparent text-fg hover:bg-subtle")} data-library-icon={i.id}><Icon className="size-4" aria-hidden /></button>
                })}
              </div>
            </div>
          )}
          {app && (
            <div className="space-y-1.5 border-t border-border-subtle pt-2">
              <input ref={input} type="file" accept="image/svg+xml,.svg" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = "" }} aria-label="Upload SVG icon" />
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => input.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-fg hover:bg-subtle disabled:opacity-50" data-upload-icon><Upload className="size-3.5" aria-hidden />{busy ? "Uploading…" : "Upload SVG"}</button>
                <Switch checked={tint} onCheckedChange={setTint} label="Use theme colour" />
              </div>
              <p className="text-2xs text-fg-muted">SVG up to 100 KB; scripts and external references are removed. Shared with every app in the workspace.</p>
              {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            </div>
          )}
          {Current && (
            <div className="flex items-end gap-3 border-t border-border-subtle pt-2 text-2xs text-fg-muted" aria-label="Preview">
              <span className="flex flex-col items-center gap-1"><span className="inline-flex size-10 items-center justify-center rounded-md bg-[var(--app-accent,var(--theme-primary))] text-[color:var(--app-accent-fg,var(--theme-on-primary))]"><Current className="size-5" aria-hidden /></span>Card</span>
              <span className="flex flex-col items-center gap-1"><span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-fg"><Current className="size-4" aria-hidden />Menu</span>Menu</span>
              <span className="flex flex-col items-center gap-1"><span className="inline-flex size-8 items-center justify-center rounded-md bg-subtle text-fg"><Current className="size-4" aria-hidden /></span>Rail</span>
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}
