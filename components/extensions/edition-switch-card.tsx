'use client'

/**
 * Settings → Extensions, self-hosted (lib/services/extensions.ts editionSummaries):
 *
 *  - EditionSummaryCard: which edition this server runs, and for every paid
 *    extension the Enterprise edition may contain, whether this build
 *    contains it and whether it is licensed. On UserTasks Enterprise every
 *    extension is already compiled in: installing its licence unlocks it,
 *    with no reinstall.
 *  - EditionSwitchCard: this server is not on UserTasks Enterprise (the
 *    public image, or the older SharePoint edition). Explains the one image,
 *    shows the licence state of each extension it adds, offers a trial where
 *    there is one, and gives the exact one-line command that switches this
 *    install to it, keeping its data (lib/editions/catalog.ts).
 */

import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy, Layers } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { editionById, editionSwitchPs1, editionSwitchSh } from '@/lib/editions/catalog'

export interface EditionExtensionState {
  id: string
  name: string
  sku: string
  in_build: boolean
  licence: { state: string; allowed: boolean; trial: boolean; days_left: number | null; expires_at: string | null }
}

export interface RunningEditionInfo {
  id: string
  name: string
  version: string | null
  extensions: EditionExtensionState[]
}

export interface MissingEdition {
  id: string
  name: string
  extensions: EditionExtensionState[]
  trial_days: number
  trial_extension: { id: string; name: string } | null
}

function CommandLine({ label, command, testId }: { label: string; command: string; testId: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="flex items-start gap-2">
        <code className="block flex-1 rounded-sm bg-subtle p-2 font-mono text-xs break-all" data-testid={testId}>{command}</code>
        <Button size="sm" variant="secondary" leadingIcon={copied ? <Check /> : <Copy />} aria-label={`Copy: ${command}`}
          onClick={() => navigator.clipboard?.writeText(command).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined)}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

function LicenceBadge({ ext }: { ext: EditionExtensionState }) {
  const { licence } = ext
  if (licence.allowed) {
    return <Badge tone={licence.trial ? 'info' : 'success'} pill>{licence.trial ? `Trial: ${licence.days_left ?? '?'} day${licence.days_left === 1 ? '' : 's'} left` : 'Licensed'}</Badge>
  }
  if (licence.state === 'expired') return <Badge tone="danger" pill>Licence expired</Badge>
  return <Badge tone="neutral" pill>Not licensed</Badge>
}

function ExtensionRows({ extensions, running }: { extensions: EditionExtensionState[]; running: boolean }) {
  return (
    <ul className="divide-y divide-border rounded-sm border border-border text-ui" data-testid="edition-extensions">
      {extensions.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-edition-extension={x.id} data-in-build={x.in_build ? 'true' : 'false'} data-licensed={x.licence.allowed ? 'true' : 'false'}>
          <span className="min-w-0 flex-1 font-medium text-fg">{x.name}</span>
          {running
            ? <Badge tone={x.in_build ? 'neutral' : 'warning'} pill>{x.in_build ? 'In this build' : 'Not in this build yet'}</Badge>
            : <Badge tone="neutral" pill>{x.in_build ? 'Already here' : 'Added by Enterprise'}</Badge>}
          <LicenceBadge ext={x} />
        </li>
      ))}
    </ul>
  )
}

/** What this server runs, and which paid extensions it contains and has licences for. */
export function EditionSummaryCard({ edition }: { edition: RunningEditionInfo }) {
  const enterprise = edition.id === 'enterprise'
  const locked = edition.extensions.filter((x) => x.in_build && !x.licence.allowed)
  return (
    <Card padding="md" data-testid="edition-summary" data-running-edition={edition.id}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Layers className="size-5 text-fg-muted" aria-hidden />
          <h2 className="text-base font-semibold text-fg">Edition: {edition.name}</h2>
          {edition.version && <Badge tone="neutral" pill>{edition.version}</Badge>}
        </div>
        {enterprise && (
          <p className="text-ui text-fg-muted">
            Every paid extension below is compiled into this image. Each stays locked until its own licence is installed:
            add a licence in <Link href="/settings/licence" className="underline">Settings → Licence</Link> and the extension unlocks — no reinstall, no new image.
            {locked.length > 0 && <> Locked now: {locked.map((x) => x.name).join(', ')}.</>}
          </p>
        )}
        {edition.id === 'core' && <p className="text-ui text-fg-muted">The public image has no paid extensions. UserTasks Enterprise is the same UserTasks with all of them compiled in (see below).</p>}
        {edition.id === 'sharepoint' && <p className="text-ui text-fg-muted">The SharePoint edition contains only the SharePoint extension. UserTasks Enterprise replaces it: the same image for every paid extension (see below).</p>}
        <ExtensionRows extensions={edition.extensions} running />
      </div>
    </Card>
  )
}

/** This server is not on UserTasks Enterprise: what it adds and the one command that switches to it. */
export function EditionSwitchCard({ edition, onStartTrial }: { edition: MissingEdition; onStartTrial: () => void }) {
  const def = editionById(edition.id)
  if (!def) return null
  const anyLicensed = edition.extensions.some((x) => x.licence.allowed)
  return (
    <Card padding="md" data-edition={edition.id} data-testid={`edition-${edition.id}`}>
      <div className="flex flex-wrap items-start gap-4">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-muted"><Layers className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-fg">{edition.name}</h2>
              <Badge tone="neutral" pill>Not this image</Badge>
            </div>
            <p className="text-ui text-fg-muted">
              The paid extensions come built into one image, <strong>UserTasks Enterprise</strong>. Each one stays locked until its licence is installed,
              so once you are on it, adding an extension later is just installing its licence. Switch this install with one command on the server:
              the same database, files and settings, a backup first, and the version you have (or newer). Downloads are checked against any of your licences.
            </p>
          </div>

          <ExtensionRows extensions={edition.extensions} running={false} />

          {edition.trial_extension && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={onStartTrial} data-testid={`edition-start-trial-${edition.trial_extension.id}`}>Start a {edition.trial_days}-day {edition.trial_extension.name} trial</Button>
              <span className="text-xs text-fg-muted">Instance admins · or <Link href="/settings/licence" className="underline">install a licence</Link> first. The command below uses the licence installed here.</span>
            </div>
          )}
          {!anyLicensed && !edition.trial_extension && (
            <p className="text-xs text-fg-muted"><Link href="/extensions" className="font-medium text-primary-text underline">Get a licence</Link> and install it in <Link href="/settings/licence" className="underline">Settings → Licence</Link>: downloads need an active licence.</p>
          )}

          <div className="space-y-2">
            <CommandLine label="Linux or macOS server (installed with the one-line installer)" command={editionSwitchSh(def)} testId={`edition-switch-sh-${edition.id}`} />
            <CommandLine label="Windows (PowerShell)" command={editionSwitchPs1(def)} testId={`edition-switch-ps1-${edition.id}`} />
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">
            <li>Run it where UserTasks is installed. Add <code className="font-mono">--licence &lt;file&gt;</code> (<code className="font-mono">-Licence</code> on Windows) to use a licence file instead of the one installed here.</li>
            <li>Then turn on each licensed extension on this page. To go back to the public image: <code className="font-mono">usertasks upgrade --edition core</code> (data is kept).</li>
            <li>No internet on the server? Make an offline bundle on a connected machine: <Link href="/docs/self-hosting/air-gapped#enterprise-edition" className="underline">air-gapped installs</Link>. Installed another way (your own Compose file, Kubernetes)? <Link href="/docs/self-hosting#editions" className="underline">Editions</Link>.</li>
          </ul>
        </div>
      </div>
    </Card>
  )
}
