"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Eye, GitCompare, History, MoreHorizontal, Rocket, Trash2 } from "lucide-react"
import { serverQuery } from "@/lib/server-read"
import { discardAppDraftAction, publishAppAction, restoreAppVersionAction } from "@/app/actions/apps"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field } from "@/components/ui/field"
import { IconButton } from "@/components/ui/icon-button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatAbsolute } from "@/lib/format/date"
import type { AppDetail, AppSummary } from "@/lib/apps/schema"
import type { AppSnapshotDiff } from "@/lib/apps/versions"

/**
 * Drafts and publishing in the app builder (lib/services/app-versions.ts):
 * the status badge (Unpublished / Changes not published / Published vN),
 * Preview (the draft as the audience would see it), Publish (with a note,
 * what changes, problems and access issues), Discard draft, Version history
 * (Restore into the draft, Compare) and Compare any two versions.
 */

type Side = "draft" | "published" | number

interface CompareResult { from: { side: Side; version: number | null }; to: { side: Side; version: number | null }; publish_problems: string[]; design_warnings?: string[]; diff: AppSnapshotDiff }
interface VersionRow { version: number; note: string | null; source: string; published_at: string; published_by: { id: string; name: string } | null; current: boolean; name: string; pages: number }

/** The status pill of an app (cards, builder header, Apps I design). Null when there is nothing to say (published, no changes) or no drafts on the server. */
export function AppDraftBadge({ app, className }: { app: Pick<AppSummary, "published" | "published_version" | "has_draft_changes" | "access">; className?: string }) {
  if (app.access !== "edit" || app.has_draft_changes == null) return null
  if (app.published === false || app.published_version == null) return <Badge tone="warning" dot className={className} data-app-status="unpublished">Unpublished</Badge>
  if (app.has_draft_changes) return <Badge tone="info" dot className={className} data-app-status="draft-changes">Changes not published</Badge>
  return null
}

function useCompare(app: string, open: boolean, from: Side = "published", to: Side = "draft") {
  return useQuery({
    queryKey: ["apps", "compare", app, from, to],
    enabled: open,
    staleTime: 0,
    queryFn: async () => (await serverQuery("apps.compare", { app, from, to })) as CompareResult,
  })
}

function DiffList({ diff, empty = "No differences." }: { diff: AppSnapshotDiff | null | undefined; empty?: string }) {
  if (!diff) return <p className="text-ui text-fg-muted">Loading the changes…</p>
  if (diff.unchanged) return <p className="text-ui text-fg-muted">{empty}</p>
  return (
    <ul className="list-disc space-y-1 pl-5 text-ui" data-app-diff>
      {diff.lines.map((line, i) => <li key={i}>{line}</li>)}
    </ul>
  )
}

export function PublishAppDialog({ app, open, onOpenChange, onPublished }: { app: AppDetail; open: boolean; onOpenChange: (open: boolean) => void; onPublished: (version: number) => void | Promise<void> }) {
  const compare = useCompare(app.id, open)
  const access = useQuery({ queryKey: ["apps", "access", app.id, "publish"], enabled: open, staleTime: 0, queryFn: async () => (await serverQuery("apps.access", { app: app.id })) as { gaps: unknown[]; grantable: number } })
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problems = compare.data?.publish_problems ?? []
  const first = app.publish_state?.published_version == null
  const next = (app.publish_state?.published_version ?? 0) + 1
  const nothing = !first && compare.data?.diff.unchanged
  const gaps = access.data?.gaps.length ?? 0
  async function publish() {
    setBusy(true); setError(null)
    const result = await publishAppAction(app.id, { note: note.trim() || null })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    setNote("")
    onOpenChange(false)
    await onPublished(result.data.version)
  }
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) { setError(null); onOpenChange(v) } }}>
      <DialogContent size="md" title={`Publish “${app.name}”`} description={first ? "The first version: everyone in the app’s audience can open it from now on." : `The draft becomes version ${next}. Everyone in the app’s audience sees it from now on.`} data-app-publish-dialog>
        <DialogBody className="space-y-4">
          {problems.length > 0 && (
            <InlineNotice tone="danger" title="Fix these before publishing">
              <ul className="mt-1 list-disc pl-5">{problems.slice(0, 8).map((p, i) => <li key={i}>{p}</li>)}</ul>
            </InlineNotice>
          )}
          {(compare.data?.design_warnings?.length ?? 0) > 0 && (
            <InlineNotice tone="warning" title={`${compare.data!.design_warnings!.length} design check${compare.data!.design_warnings!.length === 1 ? "" : "s"} to look at`} data-app-publish-design>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{compare.data!.design_warnings!.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>
              <p className="mt-1">You can still publish — the builder’s Checks button fixes most of them in one click.</p>
            </InlineNotice>
          )}
          {gaps > 0 && (
            <InlineNotice tone="warning" title={`${gaps} access issue${gaps === 1 ? "" : "s"}`}>
              Some people in the audience can’t use something the app shows. You can still publish — open Access in the builder to fix them.
            </InlineNotice>
          )}
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">{first ? "What is in it" : `Changes against version ${app.publish_state?.published_version}`}</p>
            <DiffList diff={compare.data?.diff} empty="The draft matches the published version — nothing to publish." />
          </div>
          <Field label="Note" optional>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="What changed? (shown in the version history)" data-app-publish-note />
          </Field>
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void publish()} loading={busy} disabled={problems.length > 0 || !!nothing || compare.isPending} leadingIcon={<Rocket />} data-app-publish-confirm>{first ? "Publish" : `Publish version ${next}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const sideLabel = (s: Side) => (s === "draft" ? "Draft" : s === "published" ? "Published" : `Version ${s}`)

/** Compare any two versions (mounted per use: it starts on `initial`). */
export function CompareAppDialog({ app, open, onOpenChange, initial }: { app: AppDetail; open: boolean; onOpenChange: (open: boolean) => void; initial?: { from: Side; to: Side } }) {
  const [from, setFrom] = useState<Side>(initial?.from ?? "published")
  const [to, setTo] = useState<Side>(initial?.to ?? "draft")
  const versions = useQuery({ queryKey: ["apps", "versions", app.id], enabled: open, staleTime: 0, queryFn: async () => (await serverQuery("apps.versions", { app: app.id })) as { versions: VersionRow[] } })
  const compare = useCompare(app.id, open, from, to)
  const options = [
    { value: "draft", label: "Draft" },
    { value: "published", label: "Published" },
    ...(versions.data?.versions ?? []).map((v) => ({ value: String(v.version), label: `Version ${v.version}${v.current ? " (published)" : ""}` })),
  ]
  const parse = (v: string): Side => (v === "draft" || v === "published" ? v : Number(v))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title="Compare versions" description="Pages added and removed, widgets and rules changed, menu, navigation and style.">
        <DialogBody className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1"><span className="text-xs font-medium text-fg-muted">From</span><Select size="sm" value={String(from)} onChange={(e) => setFrom(parse(e.target.value))} options={options} data-app-compare-from /></label>
            <label className="space-y-1"><span className="text-xs font-medium text-fg-muted">To</span><Select size="sm" value={String(to)} onChange={(e) => setTo(parse(e.target.value))} options={options} data-app-compare-to /></label>
          </div>
          <p className="text-xs text-fg-muted">What changes from {sideLabel(from).toLowerCase()} to {sideLabel(to).toLowerCase()}:</p>
          {compare.error ? <InlineNotice tone="danger">{compare.error instanceof Error ? compare.error.message : "Could not compare"}</InlineNotice> : <DiffList diff={compare.data?.diff} />}
        </DialogBody>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AppVersionHistoryDialog({ app, open, onOpenChange, onRestored, onCompare }: { app: AppDetail; open: boolean; onOpenChange: (open: boolean) => void; onRestored: (version: number) => void | Promise<void>; onCompare: (from: Side, to: Side) => void }) {
  const { data } = useQuery({ queryKey: ["apps", "versions", app.id], enabled: open, staleTime: 0, queryFn: async () => (await serverQuery("apps.versions", { app: app.id })) as { versions: VersionRow[]; has_draft_changes: boolean } })
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function restore(version: number) {
    setBusy(version); setError(null)
    const result = await restoreAppVersionAction(app.id, version)
    setBusy(null)
    if (!result.ok) { setError(result.error); return }
    onOpenChange(false)
    await onRestored(version)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Version history" description="Every published version, newest first. Restore copies a version into the draft (replacing it) — nothing changes for the audience until you publish.">
        <DialogBody className="space-y-3">
          {error && <InlineNotice tone="danger">{error}</InlineNotice>}
          {!data ? <p className="text-ui text-fg-muted">Loading…</p> : !data.versions.length ? <p className="text-ui text-fg-muted">Not published yet.</p> : (
            <ul className="divide-y divide-border-subtle rounded-md border border-border" data-app-version-list>
              {data.versions.map((v) => (
                <li key={v.version} className="flex items-center gap-3 px-3 py-2 text-ui" data-app-version={v.version}>
                  <span className="w-10 shrink-0 font-mono text-xs text-fg-muted">v{v.version}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="font-medium">{formatAbsolute(v.published_at)}</span>
                      <span className="text-fg-muted"> · {v.published_by?.name ?? (v.source === "initial" ? "When drafts were introduced" : v.source === "import" ? "Package or configuration" : "Someone")}</span>
                      {v.current && <Badge tone="success" className="ml-2">Published</Badge>}
                    </p>
                    {v.note && <p className="truncate text-xs text-fg-muted">“{v.note}”</p>}
                  </div>
                  <Button size="sm" variant="ghost" leadingIcon={<GitCompare />} onClick={() => onCompare(v.version, "draft")}>Compare with draft</Button>
                  <Button size="sm" variant="ghost" loading={busy === v.version} disabled={busy !== null} onClick={() => void restore(v.version)} data-app-version-restore={v.version}>Restore</Button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The builder header's draft controls: status, Preview, Publish and the ⋯
 * menu (Compare with published, Version history, Discard draft). `dirty`:
 * unsaved page edits — save first (Publish publishes what is saved).
 */
export function AppDraftControls({ app, previewHref, dirty = false, onChanged, compact = false, showPreview = true }: { app: AppDetail; previewHref: string; dirty?: boolean; onChanged: () => void | Promise<void>; compact?: boolean; showPreview?: boolean }) {
  const [publishing, setPublishing] = useState(false)
  const [history, setHistory] = useState(false)
  const [comparing, setComparing] = useState<{ from: Side; to: Side } | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const state = app.publish_state
  if (!state) return null
  const neverPublished = state.published_version == null
  const changed = neverPublished || state.has_draft_changes
  return (
    <div className="flex items-center gap-1" data-app-draft-controls>
      {neverPublished ? <Badge tone="warning" dot data-app-status="unpublished">Unpublished</Badge>
        : state.has_draft_changes ? <Badge tone="info" dot data-app-status="draft-changes">Changes not published</Badge>
        : <Badge tone="success" dot data-app-status="published">Published v{state.published_version}</Badge>}
      {message && <span className="sr-only" role="status">{message}</span>}
      {showPreview && <Button asChild size="sm" variant="ghost" leadingIcon={<Eye />}><Link href={previewHref} data-app-preview>Preview</Link></Button>}
      <Button size="sm" variant={changed ? "primary" : "secondary"} leadingIcon={<Rocket />} disabled={dirty || !changed} onClick={() => setPublishing(true)}
        title={dirty ? "Save your changes first" : !changed ? "Nothing to publish" : undefined} data-app-publish>{compact ? "Publish" : "Publish…"}</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><IconButton size="sm" label="Versions" icon={<MoreHorizontal />} data-app-versions-menu /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setComparing({ from: "published", to: "draft" })} disabled={neverPublished}><GitCompare className="size-4" aria-hidden />Compare with published</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setHistory(true)}><History className="size-4" aria-hidden />Version history</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDiscarding(true)} disabled={neverPublished || !state.has_draft_changes}><Trash2 className="size-4" aria-hidden />Discard draft</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PublishAppDialog app={app} open={publishing} onOpenChange={setPublishing} onPublished={async (v) => { setMessage(`Published version ${v}.`); await onChanged() }} />
      <AppVersionHistoryDialog app={app} open={history} onOpenChange={setHistory} onRestored={async (v) => { setMessage(`Version ${v} restored into the draft.`); await onChanged() }} onCompare={(from, to) => { setHistory(false); setComparing({ from, to }) }} />
      {comparing && <CompareAppDialog app={app} open onOpenChange={(o) => { if (!o) setComparing(null) }} initial={comparing} />}
      <ConfirmDialog open={discarding} onOpenChange={setDiscarding} title="Discard the draft?"
        description={`Every unpublished change to this app is thrown away for all its editors; it goes back to version ${state.published_version}.`}
        confirmLabel="Discard draft" destructive busy={busy}
        onConfirm={async () => {
          setBusy(true)
          const r = await discardAppDraftAction(app.id)
          setBusy(false)
          setDiscarding(false)
          if (!r.ok) { setMessage(r.error); return }
          setMessage("Draft discarded.")
          await onChanged()
        }} />
    </div>
  )
}
