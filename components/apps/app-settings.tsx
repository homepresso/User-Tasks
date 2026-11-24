"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Check, Copy, ExternalLink, Package, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { TagInput } from "@/components/ui/tag-input"
import { Input, SearchInput } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Tabs } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { serverQuery } from "@/lib/server-read"
import { createApp, deleteApp, updateApp } from "@/app/actions/apps"
import type { AppLinks } from "@/lib/apps/links"
import { COLOR_RE, DEFAULT_APP_NAV, NAV_STYLES, SLUG_RE, slugFrom, type AppDetail, type AppMenuItem, type AppNav, type AppRole, type AudienceEntry, type NavStyle, type PrincipalType } from "@/lib/apps/schema"
import { cn } from "@/lib/utils"
import { AppIconTile } from "./app-icon"
import { IconPicker } from "./icon-picker"
import { MenuItemsEditor } from "./menu-editor"
import { ObjectPicker, usePickerLabels } from "./object-picker"
import { useInvalidateApps } from "./use-apps"
import { useAccessAnalysis } from "./access-issues"
import { AppPackageDialog } from "./package-dialog"
import { usePermissions } from "@/lib/permissions-context"

/**
 * App settings for builders: the New app dialog (name, subtitle,
 * description, icon, colour) and the settings sheet (the same plus slug,
 * audience — users, teams, roles — editors, menu entries, delete).
 */

export interface PickerOptions {
  forms: Array<{ id: string; name: string }>
  workflows: Array<{ id: string; name: string }>
  tables: Array<{ id: string; name: string; columns: Array<{ key: string; name: string; type: string }> }>
  reports: Array<{ id: string; name: string }>
  teams: Array<{ id: string; name: string }>
  roles: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string; email: string | null }>
}

export function usePickerOptions(app: string | null) {
  return useQuery({
    queryKey: ["apps", "pickers", app],
    enabled: !!app,
    queryFn: async () => (await serverQuery("apps.pickers", { app: app! })) as PickerOptions,
    staleTime: 60_000,
  })
}

/** Palette offered for app colours (any #rrggbb can be typed too). */
const SWATCHES = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#0891b2", "#475569"]

interface Basics { name: string; subtitle: string; description: string; icon: string; color: string; tags: string[] }

function BasicsFields({ value, onChange, appId = null }: { value: Basics; onChange: (v: Basics) => void; appId?: string | null }) {
  const set = (patch: Partial<Basics>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-3">
      <Field label="Name" required><Input value={value.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} autoFocus data-app-name /></Field>
      <Field label="Subtitle" optional description="One line under the name on the Apps page."><Input value={value.subtitle} onChange={(e) => set({ subtitle: e.target.value })} maxLength={160} /></Field>
      <Field label="Description" optional description="Shown on the app’s card and searched in the Apps menu."><Textarea value={value.description} onChange={(e) => set({ description: e.target.value })} maxLength={1000} rows={2} /></Field>
      <Field label="Tags" optional description="Group and filter apps on the Apps page."><TagInput value={value.tags} onChange={(tags) => set({ tags })} listInline aria-label="Tags" /></Field>
      <div className="space-y-1"><span className="text-ui font-medium text-fg">Icon</span><IconPicker app={appId} value={value.icon || null} allowNone={false} onChange={(icon) => set({ icon: icon ?? "LayoutGrid" })} /></div>
      <fieldset>
        <legend className="mb-1 text-ui font-medium text-fg">Colour</legend>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => set({ color: "" })} aria-pressed={!value.color}
            className={cn("h-7 rounded-md border px-2 text-xs", !value.color ? "border-primary text-primary-text" : "border-border text-fg-muted")}>Theme</button>
          {SWATCHES.map((c) => (
            <button key={c} type="button" onClick={() => set({ color: c })} aria-pressed={value.color === c} aria-label={`Colour ${c}`}
              className={cn("size-7 rounded-md border-2", value.color === c ? "border-fg" : "border-transparent")} style={{ background: c }} />
          ))}
          <Input value={value.color} onChange={(e) => set({ color: e.target.value.trim() })} placeholder="#rrggbb" aria-label="Custom colour" className="w-28" size="sm" />
          <AppIconTile icon={value.icon || null} color={COLOR_RE.test(value.color) ? value.color : null} />
        </div>
        {value.color && !COLOR_RE.test(value.color) && <p className="mt-1 text-xs text-danger">Use a #rrggbb colour.</p>}
      </fieldset>
    </div>
  )
}

const basicsPayload = (b: Basics) => ({
  name: b.name.trim(),
  subtitle: b.subtitle.trim() || null,
  description: b.description.trim() || null,
  icon: b.icon || null,
  color: COLOR_RE.test(b.color) ? b.color : null,
  tags: b.tags,
})

export function NewAppDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const invalidate = useInvalidateApps()
  const [basics, setBasics] = useState<Basics>({ name: "", subtitle: "", description: "", icon: "LayoutGrid", color: "", tags: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!basics.name.trim()) { setError("Give the app a name."); return }
    setBusy(true); setError(null)
    const result = await createApp(basicsPayload(basics))
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await invalidate()
    onOpenChange(false)
    router.push(`/apps/${result.data.slug}/${result.data.home_page ?? "home"}?edit=1`)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title="New app" description="Name it, pick an icon and colour. You’ll add pages and widgets next, then share it.">
        <DialogBody>
          <form id="new-app-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
            <BasicsFields value={basics} onChange={setBasics} />
          </form>
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="new-app-form" loading={busy} data-create-app>Create app</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Settings sheet ──────────────────────────────────────────────────── */

export type SettingsTab = "general" | "navigation" | "audience" | "editors" | "menu" | "share"

export function AppSettingsSheet({ app, open, onOpenChange, onSaved, initialTab = "general" }: { app: AppDetail; open: boolean; onOpenChange: (open: boolean) => void; onSaved: (app: AppDetail) => void; initialTab?: SettingsTab }) {
  const router = useRouter()
  const invalidate = useInvalidateApps()
  const { can } = usePermissions()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [packaging, setPackaging] = useState(false)
  const [basics, setBasics] = useState<Basics>({ name: app.name, subtitle: app.subtitle ?? "", description: app.description ?? "", icon: app.icon ?? "", color: app.color ?? "", tags: app.tags ?? [] })
  const [slug, setSlug] = useState(app.slug)
  const [audience, setAudience] = useState<AudienceEntry[]>(app.audience ?? [])
  const [editors, setEditors] = useState<string[]>(app.editors ?? [])
  const [menu, setMenu] = useState<AppMenuItem[]>(app.menu)
  const [nav, setNav] = useState<AppNav>(app.nav ?? DEFAULT_APP_NAV)
  const [signIn, setSignIn] = useState<AppDetail["sign_in_page"]>(app.sign_in_page ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async () => {
    if (!basics.name.trim()) { setTab("general"); setError("Give the app a name."); return }
    if (!SLUG_RE.test(slug)) { setTab("general"); setError("The URL can use lowercase letters, numbers and dashes."); return }
    setBusy(true); setError(null)
    const result = await updateApp(app.id, { ...basicsPayload(basics), slug, audience, editors, menu, nav, ...(signIn !== (app.sign_in_page ?? null) ? { sign_in_page: signIn } : {}) })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await invalidate()
    onSaved(result.data)
    onOpenChange(false)
  }

  const remove = async () => {
    setBusy(true)
    const result = await deleteApp(app.id)
    setBusy(false)
    if (!result.ok) { setError(result.error); setConfirmDelete(false); return }
    await invalidate()
    router.push("/apps?tab=design")
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" title="App settings" description={app.name}>
        <div className="flex min-h-0 flex-1 flex-col">
          <Tabs className="px-4" value={tab} onValueChange={setTab} aria-label="App settings"
            items={[
              { value: "general", label: "General" },
              { value: "navigation", label: "Navigation" },
              { value: "audience", label: "Audience", count: audience.length },
              { value: "editors", label: "Editors", count: editors.length },
              { value: "menu", label: "Menu", count: menu.length },
              { value: "share", label: "Share & sign-in" },
            ]} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "general" && (
              <div className="space-y-4">
                <BasicsFields value={basics} onChange={setBasics} appId={app.id} />
                <Field label="URL" description={`/apps/${slug || "…"}`}>
                  <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} onBlur={() => { if (!slug) setSlug(slugFrom(basics.name)) }} maxLength={64} />
                </Field>
                {app.access === "edit" && can("packages.manage" as never) && (
                  <div className="rounded-md border border-border p-3" data-app-package-section>
                    <p className="text-sm font-medium text-fg">Package and share</p>
                    <p className="mb-2 text-xs text-fg-muted">Download a signed package with this app and the forms, workflows, data tables and reports it uses, to install in another workspace. Audience and editors are not included.</p>
                    <Button size="sm" variant="secondary" leadingIcon={<Package />} onClick={() => setPackaging(true)} data-open-app-package>Package / Export</Button>
                  </div>
                )}
                {app.access === "edit" && (
                  <div className="rounded-md border border-danger/40 p-3">
                    <p className="text-sm font-medium text-fg">Delete this app</p>
                    <p className="mb-2 text-xs text-fg-muted">Removes its pages, audience and editors. Forms, workflows and data it shows are not touched. Needs Build apps.</p>
                    <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={() => setConfirmDelete(true)}>Delete app</Button>
                  </div>
                )}
              </div>
            )}
            {tab === "navigation" && <NavSettings value={nav} onChange={setNav} />}
            {tab === "audience" && (
              <div className="space-y-4">
                <p className="text-sm text-fg-muted">People who can open this app (they also need Use apps, which every role has by default). <strong className="font-medium text-fg">Viewers</strong> see its pages, lists and charts; <strong className="font-medium text-fg">contributors</strong> can also use its buttons — open forms, start workflows, claim tasks. Both only ever see and do what their own permissions allow: an app never grants access.</p>
                <AudienceEditor app={app.id} type="user" label="People" value={audience} onChange={setAudience} />
                <AudienceEditor app={app.id} type="team" label="Teams" value={audience} onChange={setAudience} />
                <AudienceEditor app={app.id} type="role" label="Roles" value={audience} onChange={setAudience} />
                <AudienceAccessSummary app={app.id} audience={audience} />
              </div>
            )}
            {tab === "editors" && (
              <div className="space-y-3">
                <p className="text-sm text-fg-muted">Editors can change this app — settings, pages, widgets, audience — without Build apps.</p>
                <div className="space-y-1" data-principal-picker="editors"><span className="text-ui font-medium text-fg">Editors</span><ObjectPicker app={app.id} kind="user" multiple value={editors} onChange={setEditors} placeholder="Search people…" label="Editors" /></div>
              </div>
            )}
            {tab === "share" && <ShareSettings app={app} slugChanged={slug !== app.slug} signIn={signIn} onSignIn={setSignIn} />}
            {tab === "menu" && <div className="space-y-3"><p className="text-sm text-fg-muted">Entries in the app’s menu after its pages: pages (hidden ones too), forms, reports, records, workflows, task views and links — grouped, with icons, badges and open modes. Each entry shows only to people who may use it.</p><MenuItemsEditor app={app.id} items={menu} onChange={setMenu} pages={app.pages} filters={[]} /></div>}
          </div>
          {error && <p role="alert" className="px-4 pb-2 text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border p-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button loading={busy} onClick={() => void save()} data-save-app-settings>Save</Button>
          </div>
        </div>
        {packaging && <AppPackageDialog app={app} open onOpenChange={setPackaging} />}
        <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${app.name}?`}
          description="Its pages, audience and editors are removed. This can’t be undone." confirmLabel="Delete app" destructive busy={busy} onConfirm={remove} />
      </SheetContent>
    </Sheet>
  )
}

const SIGN_IN_OPTIONS = [
  { value: "default", label: "Workspace setting (Settings → Sign-in page)" },
  { value: "workspace", label: "The workspace sign-in page" },
  { value: "standard", label: "The standard UserTasks sign-in" },
]

/** Share links (friendly, full screen, in UserTasks) and where signed-out visitors sign in. */
function ShareSettings({ app, slugChanged, signIn, onSignIn }: { app: AppDetail; slugChanged: boolean; signIn: AppDetail["sign_in_page"]; onSignIn: (v: AppDetail["sign_in_page"]) => void }) {
  const links = useQuery({
    queryKey: ["apps", "links", app.id, app.slug],
    queryFn: async () => (await serverQuery("apps.links", { app: app.id })) as AppLinks,
    staleTime: 60_000,
  })
  const absolute = (url: string) => (/^https?:\/\//.test(url) || typeof window === "undefined" ? url : `${window.location.origin}${url}`)
  return (
    <div className="space-y-5" data-app-share>
      <section className="space-y-3">
        <div>
          <p className="text-ui font-medium text-fg">Share link</p>
          <p className="text-xs text-fg-muted">Send this to the app&rsquo;s audience. People who aren&rsquo;t signed in see the workspace sign-in page first, then the app; anyone outside the audience sees &ldquo;This app isn&rsquo;t available&rdquo;. People see the published version.</p>
        </div>
        {links.isPending ? <p className="text-xs text-fg-muted">Loading links…</p> : links.data ? (
          <div className="space-y-2">
            <LinkRow label="Friendly link" url={absolute(links.data.friendly_url)} testId="app-share-friendly" />
            <LinkRow label="Full screen (embed)" url={absolute(links.data.embed_url)} testId="app-share-embed" />
            <LinkRow label="Inside UserTasks" url={absolute(links.data.app_url)} testId="app-share-app" />
            {!links.data.workspace_url && <p className="text-2xs text-fg-muted">Without a workspace address (Settings → General) the links carry <code>?org=</code> so the sign-in page knows your workspace.</p>}
            {slugChanged && <p className="text-2xs text-warning">Save to update the links for the new URL.</p>}
          </div>
        ) : <p className="text-xs text-danger">Couldn&rsquo;t load the links.</p>}
      </section>
      <section className="space-y-2">
        <Field label="Sign-in page" description="Where people who aren’t signed in sign in before opening this app. Changes apply at once (not part of the draft).">
          <Select size="sm" value={signIn ?? "default"} data-app-sign-in-choice
            onChange={(e) => onSignIn(e.target.value === "default" ? null : (e.target.value as "workspace" | "standard"))}
            options={SIGN_IN_OPTIONS} />
        </Field>
        <a href="/settings?tab=sign-in" className="inline-flex items-center gap-1 text-xs font-medium text-primary-text hover:underline">Design the workspace sign-in page <ExternalLink className="size-3" aria-hidden /></a>
      </section>
    </div>
  )
}

function LinkRow({ label, url, testId }: { label: string; url: string; testId: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-fg">{label}</span>
      <div className="flex items-center gap-2">
        <Input readOnly value={url} size="sm" className="font-mono text-xs" aria-label={label} data-testid={testId} onFocus={(e) => e.currentTarget.select()} />
        <Button size="sm" variant="secondary" aria-label={`Copy ${label.toLowerCase()}`}
          leadingIcon={copied ? <Check /> : <Copy />}
          onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  )
}

/** The access analysis for the audience being edited (all saved pages): a count and the first issues; grants are given from the builder's Access issues. */
function AudienceAccessSummary({ app, audience }: { app: string; audience: AudienceEntry[] }) {
  const analysis = useAccessAnalysis(app, null, audience)
  const gaps = analysis.data?.gaps ?? []
  if (analysis.isPending) return <p className="text-xs text-fg-muted">Checking access…</p>
  if (!gaps.length) return <p className="text-xs text-success" data-audience-access-ok>Everyone chosen can use what the app shows them.</p>
  return (
    <div className="rounded-md border border-warning/40 bg-warning-wash p-3" data-audience-access-issues={gaps.length}>
      <p className="text-sm font-medium text-fg">{gaps.length} access issue{gaps.length === 1 ? "" : "s"} with this audience</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg">{gaps.slice(0, 5).map((g) => <li key={g.key}>{g.message}</li>)}</ul>
      {gaps.length > 5 && <p className="mt-1 text-xs text-fg-muted">…and {gaps.length - 5} more.</p>}
      <p className="mt-1 text-xs text-fg-muted">After saving, fix them from <strong>Access issues</strong> in the page builder.</p>
    </div>
  )
}

/** Searchable checkbox list of users / teams / roles writing into the audience list. */
type Entry = { type: PrincipalType; id: string; role?: AppRole }

export function PrincipalPicker<E extends Entry>({ label, type, items, value, onChange, withRole = false }: {
  label: string
  type: PrincipalType
  items: Array<{ id: string; name: string; hint?: string | null }>
  value: E[]
  onChange: (next: E[]) => void
  /** Audience: each chosen entry has an app role (viewer / contributor). */
  withRole?: boolean
}) {
  const [query, setQuery] = useState("")
  const chosenEntries = useMemo(() => value.filter((v) => v.type === type), [value, type])
  const chosen = useMemo(() => new Set(chosenEntries.map((v) => v.id)), [chosenEntries])
  const q = query.trim().toLowerCase()
  const shown = items.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.hint ?? "").toLowerCase().includes(q)).slice(0, 200)
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((v) => !(v.type === type && v.id === id)) : [...value, { type, id, ...(withRole ? { role: "viewer" as const } : {}) } as E])
  const setRole = (id: string, role: AppRole) => onChange(value.map((v) => (v.type === type && v.id === id ? { ...v, role } : v)))
  const names = new Map(items.map((i) => [i.id, i.name]))
  return (
    <fieldset className="space-y-1.5" data-principal-picker={type}>
      <legend className="text-ui font-medium text-fg">{label}</legend>
      {chosen.size > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={`Chosen ${label.toLowerCase()}`}>
          {chosenEntries.map((entry) => (
            <li key={entry.id} className="inline-flex items-center gap-1 rounded-full bg-primary-wash py-0.5 pl-2 pr-1 text-xs text-primary-text" data-audience-entry={`${type}:${entry.id}`}>
              {names.get(entry.id) ?? "Unknown"}
              {withRole && (
                <select value={entry.role ?? "viewer"} onChange={(e) => setRole(entry.id, e.target.value as AppRole)} aria-label={`App role for ${names.get(entry.id) ?? entry.id}`}
                  className="rounded-sm border-0 bg-transparent py-0 pl-1 pr-0 text-xs font-medium text-primary-text" data-audience-role>
                  <option value="viewer">Viewer</option>
                  <option value="contributor">Contributor</option>
                </select>
              )}
              <button type="button" onClick={() => toggle(entry.id)} aria-label={`Remove ${names.get(entry.id) ?? entry.id}`} className="rounded-full p-0.5 hover:bg-subtle"><X className="size-3" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      <SearchInput value={query} onValueChange={setQuery} placeholder={`Search ${label.toLowerCase()}…`} size="sm" aria-label={`Search ${label.toLowerCase()}`} />
      <ul className="max-h-44 overflow-y-auto rounded-md border border-border" role="group" aria-label={label}>
        {shown.map((item) => (
          <li key={item.id}>
            <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-subtle">
              <input type="checkbox" checked={chosen.has(item.id)} onChange={() => toggle(item.id)} className="accent-[var(--theme-primary)]" />
              <span className="truncate text-fg">{item.name}</span>
              {item.hint && <span className="truncate text-xs text-fg-muted">{item.hint}</span>}
            </label>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-2 text-sm text-fg-muted">Nothing found.</li>}
      </ul>
    </fieldset>
  )
}

/** Audience entries of one principal type: a searchable multi-picker, then each chosen entry with its app role. */
function AudienceEditor({ app, type, label, value, onChange }: { app: string; type: PrincipalType; label: string; value: AudienceEntry[]; onChange: (v: AudienceEntry[]) => void }) {
  const mine = value.filter((v) => v.type === type)
  const names = usePickerLabels(app, type, mine.map((m) => m.id))
  const nameOf = (id: string) => names.data?.items.find((i) => i.id === id)?.name ?? "…"
  return (
    <fieldset className="space-y-1.5" data-principal-picker={type}>
      <legend className="text-ui font-medium text-fg">{label}</legend>
      <ObjectPicker app={app} kind={type} multiple value={mine.map((m) => m.id)} label={label} placeholder={`Search ${label.toLowerCase()}…`}
        onChange={(ids) => onChange([...value.filter((v) => v.type !== type), ...ids.map((id) => mine.find((m) => m.id === id) ?? { type, id, role: "viewer" as AppRole })])} />
      {mine.length > 0 && (
        <ul className="space-y-1" aria-label={`App roles of chosen ${label.toLowerCase()}`}>
          {mine.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-2 rounded-md bg-subtle px-2 py-1 text-xs" data-audience-entry={`${type}:${entry.id}`}>
              <span className="truncate text-fg">{nameOf(entry.id)}</span>
              <select value={entry.role ?? "viewer"} onChange={(e) => onChange(value.map((v) => (v.type === type && v.id === entry.id ? { ...v, role: e.target.value as AppRole } : v)))} aria-label={`App role for ${nameOf(entry.id)}`}
                className="rounded-sm border border-border bg-panel px-1 py-0.5 text-xs text-fg" data-audience-role>
                <option value="viewer">Viewer</option>
                <option value="contributor">Contributor</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

const NAV_LABELS: Record<NavStyle, { title: string; description: string }> = {
  top: { title: "Top bar", description: "A horizontal menu; what doesn’t fit goes into More." },
  sidebar: { title: "Left sidebar", description: "Icons and labels; collapses to an icon rail." },
  drawer: { title: "Menu button", description: "A hamburger that opens the menu as a drawer." },
  tabs: { title: "Page tabs", description: "Tabs under the app header (the default)." },
  bottom: { title: "Bottom bar", description: "Tab bar at the bottom on phones; tabs on larger screens." },
  mega: { title: "Mega-menu", description: "Groups open as columns from the top bar." },
  none: { title: "No navigation", description: "Single-page apps and embeds." },
}

/** A small drawing of each navigation style (theme tokens only). */
function NavThumb({ style }: { style: NavStyle }) {
  const bar = "bg-[var(--app-accent,var(--theme-primary))]"
  return (
    <span aria-hidden className="relative block h-14 w-full overflow-hidden rounded border border-border bg-panel">
      <span className="absolute inset-x-0 top-0 h-2.5 bg-subtle" />
      {style === "top" && <span className="absolute left-1 top-3.5 flex gap-1">{[0, 1, 2].map((i) => <span key={i} className={cn("h-1.5 w-5 rounded-sm", i === 0 ? bar : "bg-border")} />)}</span>}
      {style === "mega" && <><span className="absolute left-1 top-3.5 flex gap-1">{[0, 1].map((i) => <span key={i} className="h-1.5 w-5 rounded-sm bg-border" />)}</span><span className="absolute left-3 top-6 grid h-6 w-16 grid-cols-2 gap-0.5 rounded border border-border bg-elevated p-0.5">{[0, 1, 2, 3].map((i) => <span key={i} className="rounded-sm bg-border" />)}</span></>}
      {style === "tabs" && <span className="absolute left-1 top-3.5 flex gap-1.5">{[0, 1, 2].map((i) => <span key={i} className={cn("h-1 w-5", i === 0 ? cn("h-0.5 translate-y-1", bar) : "bg-border")} />)}</span>}
      {style === "sidebar" && <span className="absolute bottom-0 left-0 top-2.5 flex w-5 flex-col gap-1 bg-subtle p-1">{[0, 1, 2].map((i) => <span key={i} className={cn("h-1 rounded-sm", i === 0 ? bar : "bg-border")} />)}</span>}
      {style === "drawer" && <span className="absolute left-1 top-0.5 flex flex-col gap-0.5">{[0, 1, 2].map((i) => <span key={i} className="h-0.5 w-2.5 bg-fg-muted" />)}</span>}
      {style === "bottom" && <span className="absolute inset-x-0 bottom-0 flex h-3 items-center justify-around bg-subtle">{[0, 1, 2, 3].map((i) => <span key={i} className={cn("size-1.5 rounded-full", i === 0 ? bar : "bg-border")} />)}</span>}
      {style === "none" && <span className="absolute inset-x-2 top-4 h-6 rounded-sm bg-subtle" />}
    </span>
  )
}

function NavSettings({ value, onChange }: { value: AppNav; onChange: (v: AppNav) => void }) {
  const set = (patch: Partial<AppNav>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-4" data-nav-settings>
      <fieldset>
        <legend className="mb-1 text-ui font-medium text-fg">Navigation style</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Navigation style">
          {NAV_STYLES.map((style) => (
            <button key={style} type="button" role="radio" aria-checked={value.style === style} onClick={() => set({ style })}
              className={cn("space-y-1 rounded-lg border p-1.5 text-left", value.style === style ? "border-primary ring-2 ring-[var(--theme-primary)]" : "border-border hover:bg-subtle")} data-nav-style={style}>
              <NavThumb style={style} />
              <span className="block text-xs font-medium text-fg">{NAV_LABELS[style].title}</span>
              <span className="block text-2xs leading-tight text-fg-muted">{NAV_LABELS[style].description}</span>
            </button>
          ))}
        </div>
        <p className="mt-1 text-2xs text-fg-muted">On phones every style opens from a menu button (the bottom bar stays a bottom bar). Embeds follow the style; ?menu=0 hides it.</p>
      </fieldset>
      {value.style === "sidebar" && <Switch checked={value.sidebar_collapsed} onCheckedChange={(v) => set({ sidebar_collapsed: v })} label="Start collapsed (icon rail)" />}
      <fieldset className="space-y-2">
        <legend className="mb-1 text-ui font-medium text-fg">Header</legend>
        <div className="flex flex-wrap gap-4">
          <Switch checked={value.show_icon} onCheckedChange={(v) => set({ show_icon: v })} label="App icon" />
          <Switch checked={value.show_title} onCheckedChange={(v) => set({ show_title: v })} label="Title" />
          <Switch checked={value.show_subtitle} onCheckedChange={(v) => set({ show_subtitle: v })} label="Subtitle" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Header style"><Select size="sm" value={value.header_style} onChange={(e) => set({ header_style: e.target.value as AppNav["header_style"] })} options={[{ value: "plain", label: "Plain" }, { value: "colored", label: "App colour" }, { value: "banner", label: "Image banner" }]} /></Field>
          <Field label="Density"><Select size="sm" value={value.density} onChange={(e) => set({ density: e.target.value as AppNav["density"] })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} /></Field>
        </div>
        {value.header_style === "banner" && <Field label="Banner image (https:// or /path)"><Input size="sm" value={value.banner_url ?? ""} onChange={(e) => set({ banner_url: e.target.value.trim() || null })} /></Field>}
        <Field label="Around the app"><Select size="sm" value={value.shell} onChange={(e) => set({ shell: e.target.value as AppNav["shell"] })} options={[{ value: "full", label: "The UserTasks shell (sidebar and top bar)" }, { value: "app_only", label: "App only (fills the window)" }]} /></Field>
        {value.shell === "full" && <Switch checked={value.collapse_shell_menu} onCheckedChange={(v) => set({ collapse_shell_menu: v })} label="Collapse the UserTasks menu in this app" title="The side menu folds to its icons while the app is open; people can still expand it." />}
      </fieldset>
    </div>
  )
}
