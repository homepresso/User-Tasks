'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { overlayClass } from '@/components/ui/dialog'
import { Database, Info, Lock, LockOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { setUiSwitching } from '@/app/actions/infrastructure'
import type { ActionState, AreaActionStates } from '@/lib/admin/switch-runtime'
import { CopyBlock } from './provider-switch-wizard'

/**
 * Settings → Infrastructure: why a Change… / Settings button is disabled and
 * what to do about it (never a silently hidden option), the cloud lock's
 * Unlock / Lock control (instance admins; typed confirmation; recorded in
 * the switch log), and the DATABASE_URL how-to for changes that move data.
 */

/** Placeholders only: what to add for a direct connection to a Supabase project. */
export const DATABASE_URL_SNIPPET = 'DATABASE_URL=postgresql://postgres.<project-ref>:<database-password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

export function DatabaseUrlHelp({ compact = false }: { compact?: boolean }) {
  return (
    <details className="text-xs" open={!compact}>
      <summary className="cursor-pointer underline text-fg-muted">How to add DATABASE_URL</summary>
      <div className="mt-2 space-y-2">
        <ol className="ml-4 list-decimal space-y-0.5">
          <li>In Supabase open <strong>Project Settings → Database → Connection string</strong> and copy the <strong>Session pooler</strong> URI (port 5432).</li>
          <li>Add it to the app environment (on Vercel: Project → Settings → Environment Variables), with your database password in place of the placeholder.</li>
          <li>Redeploy. The page then switches the database, auth and storage too (copying data), and runs every check over the direct connection.</li>
        </ol>
        <CopyBlock text={DATABASE_URL_SNIPPET} label="Copy DATABASE_URL line" />
      </div>
    </details>
  )
}

/** Unlock / Lock the cloud edition's provider changes (instance.allow_ui_switching). */
export function UiLockDialog({ allow, onClose }: { allow: boolean; onClose: () => void }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const phrase = allow ? 'unlock' : 'lock'
  const muted = { color: 'var(--theme-muted-text)' }

  const run = async () => {
    setError(null)
    setPending(true)
    try {
      const res = await setUiSwitching({ allow, confirm })
      if (!res.ok) { setError(res.error); return }
      if (!res.changed) { onClose(); router.refresh(); return }
      // Every card's buttons, notes and the banner depend on the lock: load the page again
      // (a full load, so no in-flight client navigation can keep the old view).
      window.location.reload()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(34rem,94vw)] max-h-[90vh] overflow-y-auto [transform:translate(-50%,-50%)] rounded-xl p-5 shadow-elev-3 ds-dialog space-y-3 bg-elevated text-fg" aria-describedby={undefined}>
          <div className="flex items-start gap-2">
            <Dialog.Title className="text-lg font-semibold flex-1">{allow ? 'Unlock provider changes' : 'Lock provider changes'}</Dialog.Title>
            <Dialog.Close aria-label="Close" className="p-1"><X size={16} /></Dialog.Close>
          </div>
          {allow ? (
            <p className="text-sm">
              This cloud deployment is locked so its production providers are never switched by accident. Unlocking lets instance
              admins change providers and their settings from this page (with the same checks, typed confirmations and rollback).
              Lock it again when you are done.
            </p>
          ) : (
            <p className="text-sm">Locking turns Change… and Settings off again on this cloud deployment. Nothing else changes.</p>
          )}
          <p className="text-xs" style={muted}>Sets <code>instance.allow_ui_switching</code> to <code>{String(allow)}</code>. The change is recorded in the switch log with your name, and can be rolled back from there.</p>
          {error && <InlineNotice tone="error" message={error} />}
          <div>
            <label htmlFor="ui-lock-confirm" className="block text-sm font-medium mb-1">Type <code>{phrase}</code> to confirm</label>
            <Input id="ui-lock-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button type="button" size="sm" variant={allow ? 'default' : 'outline'} disabled={pending || confirm.trim().toLowerCase() !== phrase} onClick={run}>
              {allow ? <><LockOpen size={13} /> Unlock</> : <><Lock size={13} /> Lock</>}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function UiLockButton({ allow, size = 'sm', variant }: { allow: boolean; size?: 'sm'; variant?: 'default' | 'outline' | 'ghost' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" size={size} variant={variant ?? (allow ? 'default' : 'outline')} onClick={() => setOpen(true)}>
        {allow ? <><LockOpen size={13} /> Unlock…</> : <><Lock size={13} /> Lock again…</>}
      </Button>
      {open && <UiLockDialog allow={allow} onClose={() => setOpen(false)} />}
    </>
  )
}

function noteKey(state: ActionState): string {
  return state.block ? `${state.block.kind}:${state.block.message}` : ''
}

/** The explanation (and remedy) under an area's buttons for each disabled one. */
export function AreaActionNotes({ area, actions }: { area: string; actions: AreaActionStates }) {
  const notes: Array<{ id: string; which: string; state: ActionState }> = []
  const change = actions.change
  const settings = actions.settings
  if (!change.enabled) notes.push({ id: `${area}-change-why`, which: settings.enabled || noteKey(settings) !== noteKey(change) ? 'Change…' : 'Change… and Settings', state: change })
  if (!settings.enabled && (change.enabled || noteKey(settings) !== noteKey(change))) notes.push({ id: `${area}-settings-why`, which: 'Settings', state: settings })
  if (!notes.length) return null
  return (
    <div className="mt-2 space-y-2" data-area-notes={area}>
      {notes.map(({ id, which, state }) => {
        const block = state.block!
        const Icon = block.kind === 'cloud-locked' ? Lock : block.kind === 'needs-direct-db' ? Database : Info
        return (
          <div key={id} id={id} className="rounded-lg border px-3 py-2 text-xs space-y-1 border-border" role="note" data-block={block.kind}>
            <p className="flex items-start gap-1.5">
              <Icon size={13} className="shrink-0 mt-px" aria-hidden />
              <span><span className="font-medium">{which}:</span> {block.message}</span>
            </p>
            {block.kind === 'cloud-locked' && <div><UiLockButton allow variant="outline" /></div>}
            {block.kind === 'needs-direct-db' && <DatabaseUrlHelp compact />}
          </div>
        )
      })}
    </div>
  )
}
