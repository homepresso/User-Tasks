import Link from 'next/link'
import { ArrowRight, BookOpen, KeyRound, Puzzle, Sparkles } from 'lucide-react'
import {
  ADDON_LINKS, INFRASTRUCTURE_ADDON_NAME, INFRASTRUCTURE_ADDON_POINTS, INFRASTRUCTURE_PRICE, PROCESSING_ADDON_NAME, PROCESSING_ADDON_POINTS, PROCESSING_PRICE,
} from '@/lib/infrastructure/addon'

/**
 * The upsell for a paid add-on where its controls would be (Settings →
 * Infrastructure, the setup wizard, the processing card): what it does, that
 * it is a paid add-on, and how to get or install it — instead of a dead
 * button. `state` says whether the add-on is missing from this build or
 * installed without a usable licence (then `reason` explains, e.g. expired).
 * Both add-ons ship in ONE image, UserTasks Enterprise (lib/editions): on it
 * the add-on is already compiled in and installing its licence unlocks it,
 * with no reinstall; elsewhere the card says to switch to Enterprise first.
 * Server component (plain links only).
 */

export type AddonUpsellKind = 'infrastructure' | 'processing'

const CONTENT: Record<AddonUpsellKind, { name: string; points: readonly string[]; price: string; docs: string; lead: string }> = {
  infrastructure: {
    name: INFRASTRUCTURE_ADDON_NAME,
    points: INFRASTRUCTURE_ADDON_POINTS,
    price: `Paid add-on: ${INFRASTRUCTURE_PRICE}.`,
    docs: ADDON_LINKS.infrastructureDocs,
    lead: 'This instance keeps running on its current providers — the free edition runs any configuration. Changing providers off the standard stack is the Infrastructure add-on.',
  },
  processing: {
    name: PROCESSING_ADDON_NAME,
    points: PROCESSING_ADDON_POINTS,
    price: `Paid add-on: ${PROCESSING_PRICE}.`,
    docs: ADDON_LINKS.processingDocs,
    lead: 'The free edition runs workflow, agent and media processing in the web app. Separate processing workers are the Processing add-on.',
  },
}

export function AddonUpsellCard({ kind, state = 'missing', reason, id, compact = false }: {
  kind: AddonUpsellKind
  state?: 'missing' | 'unlicensed'
  reason?: string | null
  id?: string
  compact?: boolean
}) {
  const c = CONTENT[kind]
  return (
    <section
      id={id}
      className="rounded-xl border p-4 space-y-3 scroll-mt-24"
      style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      aria-label={c.name}
      data-addon-upsell={kind}
      data-addon-state={state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={16} aria-hidden style={{ color: 'var(--theme-primary, currentColor)' }} />
        <h2 className="text-base font-semibold">{c.name}</h2>
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ color: 'var(--theme-muted-text)', backgroundColor: 'var(--theme-surface-border)' }}>Paid add-on</span>
      </div>
      <p className="text-sm">{state === 'unlicensed' ? `The ${c.name} is installed, but it has no usable licence${reason ? `: ${reason}` : '.'}` : c.lead}</p>
      <p className="text-sm" data-addon-enterprise={state === 'unlicensed' ? 'in-build' : 'switch'}>
        {state === 'unlicensed'
          ? `It is already in this image (UserTasks Enterprise): installing the licence unlocks it — no reinstall.`
          : `The ${c.name} comes in UserTasks Enterprise, one image with every paid extension. On the Enterprise edition, installing the licence unlocks it with no reinstall; this install runs an image without it, so switch it to Enterprise once (one command, data kept: Settings → Extensions).`}
      </p>
      {!compact && (
        <ul className="ml-4 list-disc space-y-1 text-sm">
          {c.points.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>{c.price}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {state === 'missing' && (
          <Link href={ADDON_LINKS.extensions} className="inline-flex items-center gap-1 underline"><Puzzle size={14} aria-hidden /> Get it: Settings → Extensions</Link>
        )}
        <Link href={ADDON_LINKS.licence} className="inline-flex items-center gap-1 underline"><KeyRound size={14} aria-hidden /> {state === 'unlicensed' ? 'Install or renew the licence' : 'Install a licence'}: Settings → Licence</Link>
        <Link href={c.docs} className="inline-flex items-center gap-1 underline"><BookOpen size={14} aria-hidden /> What it does</Link>
        <Link href={ADDON_LINKS.contact} className="inline-flex items-center gap-1 underline"><ArrowRight size={14} aria-hidden /> Contact us</Link>
      </div>
    </section>
  )
}
