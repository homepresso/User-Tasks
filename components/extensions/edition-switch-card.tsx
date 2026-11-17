'use client'

/**
 * Settings → Extensions, self-hosted: an edition this build does not include
 * (UserTasks for SharePoint Server ships as its own image, pulled with a
 * licence). Explains that, shows the licence state for its extension, offers
 * the trial, and gives the exact one-line command that switches this install
 * to the edition, keeping its data (lib/editions/catalog.ts).
 */

import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy, Layers } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { editionById, editionSwitchPs1, editionSwitchSh } from '@/lib/editions/catalog'

export interface MissingEdition {
  id: string
  name: string
  extension_id: string
  sku: string
  trial_days: number
  licence: { state: string; allowed: boolean; trial: boolean; days_left: number | null; expires_at: string | null }
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

export function EditionSwitchCard({ edition, onStartTrial }: { edition: MissingEdition; onStartTrial: () => void }) {
  const def = editionById(edition.id)
  if (!def) return null
  const { licence } = edition
  const licensed = licence.allowed
  return (
    <Card padding="md" data-edition={edition.id} data-testid={`edition-${edition.id}`}>
      <div className="flex flex-wrap items-start gap-4">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-muted"><Layers className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-fg">{edition.name}</h2>
              <Badge tone="neutral" pill>Not in this build</Badge>
              {licensed && <Badge tone={licence.trial ? 'info' : 'success'} pill>{licence.trial ? `Trial licence: ${licence.days_left ?? '?'} day${licence.days_left === 1 ? '' : 's'} left` : 'Licensed'}</Badge>}
              {!licensed && licence.state === 'expired' && <Badge tone="danger" pill>Licence expired</Badge>}
            </div>
            <p className="text-ui text-fg-muted">
              SharePoint Server support is a paid extension that comes built into its own UserTasks image, the <strong>SharePoint edition</strong>.
              This install runs the public image, so SharePoint isn&apos;t listed above. Switch the install to the SharePoint edition with one command on the server:
              the same database, files and settings, a backup first, and the version you have (or newer). Downloads are checked against your SharePoint licence.
            </p>
          </div>

          {!licensed && licence.state !== 'expired' && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={onStartTrial} data-testid={`edition-start-trial-${edition.id}`}>Start a {edition.trial_days}-day trial</Button>
              <span className="text-xs text-fg-muted">Instance admins · or <Link href="/settings/licence" className="underline">install a licence</Link> first. The command below uses the licence installed here.</span>
            </div>
          )}
          {licence.state === 'expired' && (
            <p className="text-xs text-fg-muted"><a href="https://usertasks.com/sharepoint#pricing" target="_blank" rel="noopener noreferrer" className="font-medium text-primary-text underline">Buy a licence</a> and install it in <Link href="/settings/licence" className="underline">Settings → Licence</Link>: downloads need an active licence.</p>
          )}

          <div className="space-y-2">
            <CommandLine label="Linux or macOS server (installed with the one-line installer)" command={editionSwitchSh(def)} testId={`edition-switch-sh-${edition.id}`} />
            <CommandLine label="Windows (PowerShell)" command={editionSwitchPs1(def)} testId={`edition-switch-ps1-${edition.id}`} />
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">
            <li>Run it where UserTasks is installed. Add <code className="font-mono">--licence &lt;file&gt;</code> (<code className="font-mono">-Licence</code> on Windows) to use a licence file instead of the one installed here.</li>
            <li>Then turn on {def.name.replace(/^UserTasks for /, '')} on this page. To go back to the public image: <code className="font-mono">usertasks upgrade --edition core</code> (data is kept).</li>
            <li>No internet on the server? Make an offline bundle on a connected machine: <Link href="/docs/self-hosting/air-gapped#sharepoint-edition" className="underline">air-gapped installs</Link>. Installed another way (your own Compose file, Kubernetes)? <Link href="/docs/self-hosting#editions" className="underline">Editions</Link>.</li>
          </ul>
        </div>
      </div>
    </Card>
  )
}
