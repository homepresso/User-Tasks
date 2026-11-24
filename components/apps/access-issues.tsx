"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleCheck, ShieldAlert, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { serverQuery } from "@/lib/server-read"
import { grantAppAccess } from "@/app/actions/apps"
import type { AppWidget, AudienceEntry } from "@/lib/apps/schema"
import type { AccessAnalysis, AccessGap } from "@/lib/services/app-access"
import { cn } from "@/lib/utils"

/**
 * Access issues for the builder: who in the app's audience can't use what
 * the app shows them (lib/services/app-access.ts) — checked against the
 * page being edited (unsaved widgets included). A form grant the designer may
 * give (Manage roles) is offered as "Grant access" — one, or all they can —
 * always behind a confirmation; everything else says whom to ask.
 */

export function useAccessAnalysis(app: string, draft: { pageId: string; widgets: AppWidget[] } | null, audience?: AudienceEntry[] | null) {
  return useQuery({
    queryKey: ["apps", "access", app, draft?.pageId ?? null, draft ? JSON.stringify(draft.widgets) : null, audience ? JSON.stringify(audience) : null],
    queryFn: async () => (await serverQuery("apps.access", {
      app, page_id: draft?.pageId ?? null, layout: draft ? { widgets: draft.widgets } : undefined, audience: audience ?? null,
    })) as AccessAnalysis,
    staleTime: 15_000,
    retry: false,
  })
}

export function AccessButton({ analysis, loading, onClick }: { analysis: AccessAnalysis | undefined; loading: boolean; onClick: () => void }) {
  const count = analysis?.gaps.length ?? 0
  return (
    <Button size="sm" variant={count ? "secondary" : "ghost"} onClick={onClick} data-access-issues={count}
      leadingIcon={count ? <ShieldAlert className="text-warning" /> : <CircleCheck className="text-success" />}>
      {loading ? "Access…" : count ? `Access issues (${count})` : "Access OK"}
    </Button>
  )
}

export function AccessIssuesDialog({ app, open, onOpenChange, analysis, dirty }: {
  app: string
  open: boolean
  onOpenChange: (open: boolean) => void
  analysis: AccessAnalysis | undefined
  /** Unsaved page changes: grants still apply, the list re-checks after saving. */
  dirty: boolean
}) {
  const client = useQueryClient()
  const [confirm, setConfirm] = useState<{ keys: string[] | "all"; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const gaps = analysis?.gaps ?? []
  const grantable = gaps.filter((g) => g.fix.kind === "grant" && g.fix.can_grant)

  const apply = async () => {
    if (!confirm) return
    setBusy(true); setMessage(null)
    const result = await grantAppAccess(app, confirm.keys)
    setBusy(false); setConfirm(null)
    if (!result.ok) { setMessage({ tone: "error", text: result.error }); return }
    setMessage({ tone: "ok", text: `${result.data.granted} grant${result.data.granted === 1 ? "" : "s"} given.` })
    await client.invalidateQueries({ queryKey: ["apps"] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Access issues"
        description="An app never grants access by itself. Viewers need to be able to see each form, workflow, table and report it shows; contributors also to submit or start them. Anything they can’t use stays hidden from them.">
        <DialogBody className="space-y-3" data-access-dialog>
          {dirty && <p className="rounded-md bg-warning-wash px-3 py-2 text-xs text-fg">Checked with your unsaved changes to this page. Save to keep them.</p>}
          {message && <p role="status" className={cn("text-sm", message.tone === "ok" ? "text-success" : "text-danger")}>{message.text}</p>}
          {(analysis?.warnings ?? []).length > 0 && (
            <div className="rounded-md border border-warning/40 bg-warning-wash p-2" data-config-warnings>
              <p className="text-xs font-medium text-fg">Settings to check</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-fg">{analysis!.warnings!.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {!analysis ? <p className="text-sm text-fg-muted">Checking…</p> : !gaps.length ? (
            <p className="flex items-center gap-2 text-sm text-fg"><CircleCheck className="size-4 text-success" aria-hidden />Everyone in the audience can use what this app shows them.</p>
          ) : (
            <ul className="space-y-2" aria-label="Access issues">
              {gaps.map((gap) => <GapRow key={gap.key} gap={gap} onGrant={() => setConfirm({ keys: [gap.key], text: grantText([gap]) })} />)}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {grantable.length > 0 && (
            <Button onClick={() => setConfirm({ keys: "all", text: grantText(grantable) })} data-grant-all>Grant all I can ({grantable.length})</Button>
          )}
        </DialogFooter>
        <ConfirmDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }} title="Grant access?"
          description={confirm?.text ?? ""} confirmLabel="Grant access" busy={busy} onConfirm={apply} />
      </DialogContent>
    </Dialog>
  )
}

function grantText(gaps: AccessGap[]): string {
  const lines = gaps.map((g) => `${g.principal.name}: View and Submit on form “${g.object.name}”`)
  return `This adds ${lines.length === 1 ? "a grant" : `${lines.length} grants`} — the least each needs — recorded in the audit log: ${lines.join("; ")}.`
}

function GapRow({ gap, onGrant }: { gap: AccessGap; onGrant: () => void }) {
  return (
    <li className="rounded-md border border-border p-3" data-access-gap={gap.key}>
      <p className="text-sm text-fg">{gap.message}</p>
      <p className="mt-0.5 text-xs text-fg-muted">Used in {gap.where.slice(0, 3).join(", ")}{gap.where.length > 3 ? ` and ${gap.where.length - 3} more` : ""}</p>
      <div className="mt-2 flex items-center gap-2">
        {gap.fix.kind === "grant" && gap.fix.can_grant ? (
          <Button size="sm" variant="secondary" onClick={onGrant} data-grant-gap>Grant access</Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-fg-muted" data-ask-owner>
            <UserRound className="size-3.5" aria-hidden />
            {gap.fix.kind === "grant" ? `Ask someone who can manage roles${gap.object.owner ? ` (or ${gap.object.owner}, who owns the form)` : ""} to grant it` : `Ask: ${gap.fix.who}`}
          </span>
        )}
      </div>
    </li>
  )
}
