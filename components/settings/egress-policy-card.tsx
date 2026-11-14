import Link from 'next/link'
import type { EgressListSource, EgressPolicySummary } from '@/lib/egress-policy'

/**
 * Settings → Infrastructure → Network access (read-only): the connectors'
 * private-network allowlist and plain-http hosts (lib/egress-policy.ts).
 * Changed with EGRESS_PRIVATE_ALLOW / EGRESS_HTTP_ALLOW or
 * `usertasks-admin egress …`, never from the browser.
 */

const SOURCE: Record<EgressListSource, string> = { env: 'environment variable', setting: 'instance setting', none: 'not set' }

function Entries({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <span style={{ color: 'var(--theme-muted-text)' }}>{empty}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((item) => <code key={item} className="text-xs rounded px-1.5 py-0.5" style={{ backgroundColor: 'var(--theme-surface-border)' }}>{item}</code>)}
    </span>
  )
}

export function EgressPolicyCard({ summary }: { summary: EgressPolicySummary }) {
  const muted = { color: 'var(--theme-muted-text)' }
  const card = { backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }
  const cloud = summary.mode === 'cloud'
  return (
    <section className="rounded-xl border p-4 space-y-3" style={card} aria-label="Network access">
      <div>
        <h2 className="text-base font-semibold">Network access</h2>
        <p className="text-xs mt-1" style={muted}>
          {cloud
            ? 'Cloud edition: connectors reach public HTTPS endpoints only. Private networks and plain http:// are never allowed.'
            : <>Which on-premises systems connectors may reach. Set with <code>EGRESS_PRIVATE_ALLOW</code> / <code>EGRESS_HTTP_ALLOW</code> or <code>usertasks-admin egress</code>. </>}
          <Link href="/docs/self-hosting#connecting-to-on-premises-systems" className="underline">docs</Link>
        </p>
      </div>
      {!cloud && (
        <dl className="grid gap-2 text-sm sm:grid-cols-[14rem_1fr]">
          <dt className="font-medium">Private network allowlist<span className="block text-xs font-normal" style={muted}>{SOURCE[summary.privateSource]}</span></dt>
          <dd><Entries items={summary.privateAllow} empty="None: private, loopback and link-local addresses are blocked." /></dd>
          <dt className="font-medium">Plain http:// allowed for<span className="block text-xs font-normal" style={muted}>{SOURCE[summary.httpSource]}</span></dt>
          <dd><Entries items={summary.httpAllow} empty="None: connectors must use HTTPS (loopback excepted)." /></dd>
        </dl>
      )}
      {summary.ignoredInCloud && <p className="text-xs" style={muted}>An allowlist is configured but ignored in the cloud edition.</p>}
      {summary.allowAllPrivate && (
        <p className="text-xs" style={{ color: 'var(--status-progress)' }}>
          ALLOW_PRIVATE_EGRESS=true opens every private range to connectors. Prefer the allowlist, which names the hosts and networks you mean.
        </p>
      )}
      {summary.invalid.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--status-blocked)' }}>Ignored entries: {summary.invalid.join('; ')}</p>
      )}
      <p className="text-xs" style={muted}>Cloud metadata endpoints (169.254.169.254, fd00:ec2::254 and similar) are always blocked.</p>
    </section>
  )
}
