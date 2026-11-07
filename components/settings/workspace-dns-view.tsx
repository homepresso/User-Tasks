'use client'

import { useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { StatusPill, type Tone } from '@/components/ui/badge'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { checkWorkspaceDnsAction } from '@/app/actions/workspace-dns'
import type { DnsCheckStatus, WorkspaceDnsReport } from '@/lib/workspace-dns-check'
import {
  DNS_PROVIDER_LABELS, VERCEL_CNAME_TARGET, VERCEL_NAMESERVERS,
  defaultDnsHostTab, recordLine, selfHostedRecords, vercelDnsRecords, vercelNameserverRecords,
  type DnsHostTab, type DnsRecord, type VercelRoute,
} from '@/lib/workspace-dns-records'

/**
 * Settings → Workspace DNS body: the live status (DNS, nameservers,
 * certificate, HTTP) with "Check again", then what to set up for this
 * environment — Vercel with a GoDaddy / Cloudflare / other DNS walkthrough,
 * or self-hosted — with every record computed from the base domain and
 * copyable. Instance admins only (the page and the action check).
 */

const STATUS: Record<DnsCheckStatus, { label: string; tone: Tone }> = {
  pass: { label: 'OK', tone: 'success' },
  warn: { label: 'Check', tone: 'warning' },
  fail: { label: 'Not working', tone: 'danger' },
  skip: { label: 'Info', tone: 'neutral' },
}

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  return [copied, (key, text) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500) }).catch(() => undefined)
  }]
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, copy] = useCopy()
  return <IconButton size="sm" label={copied ? 'Copied' : label} icon={copied ? <Check /> : <Copy />} onClick={() => copy('x', text)} />
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-subtle px-1 py-0.5 font-mono text-xs break-all">{children}</code>
}

/** A shell command or config snippet with a copy button. */
function CodeBlock({ code, label = 'Copy' }: { code: string; label?: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-subtle p-3 pr-10 font-mono text-xs text-fg whitespace-pre">{code}</pre>
      <div className="absolute right-1 top-1"><CopyButton text={code} label={label} /></div>
    </div>
  )
}

/** Type / Host / Value / TTL with copy buttons; on narrow screens the table scrolls sideways. */
export function DnsRecordsTable({ records, caption }: { records: DnsRecord[]; caption: string }) {
  return (
    <div className="space-y-1">
      <Table aria-label={caption} data-testid="dns-records">
        <THead>
          <TR><TH>Type</TH><TH>Host / Name</TH><TH>Value / Points to</TH><TH>TTL</TH></TR>
        </THead>
        <TBody>
          {records.map((r, i) => (
            <TR key={`${r.type}-${r.host}-${r.value}-${i}`}>
              <TD className="font-mono text-xs">{r.type}</TD>
              <TD>
                <span className="inline-flex items-center gap-1 font-mono text-xs">{r.host}<CopyButton text={r.host} label={`Copy host ${r.host}`} /></span>
                {r.host !== r.fqdn && <div className="text-2xs text-fg-muted font-mono">{r.fqdn}</div>}
              </TD>
              <TD>
                <span className="inline-flex items-center gap-1 font-mono text-xs break-all">{r.value}<CopyButton text={r.value} label={`Copy value ${r.value}`} /></span>
                {r.note && <div className="text-2xs text-fg-muted max-w-[40ch]">{r.note}</div>}
              </TD>
              <TD numeric className="num text-xs">{r.ttl === 3600 ? '1 hour' : `${r.ttl} s`}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" leadingIcon={<Copy />} onClick={() => void navigator.clipboard?.writeText(records.map(recordLine).join('\n')).catch(() => undefined)}>Copy all</Button>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number | string; title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex gap-3" aria-label={typeof title === 'string' ? title : undefined}>
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-wash text-xs font-semibold text-primary-text" aria-hidden="true">{n}</span>
      <div className="min-w-0 flex-1 space-y-3">
        <h3 className="text-base font-semibold">{title}</h3>
        {children}
      </div>
    </section>
  )
}

function Ol({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-ui">{children}</ol>
}

/* ── Status ──────────────────────────────────────────────────────────── */

function StatusPanel({ report, onRefresh, refreshing, error }: { report: WorkspaceDnsReport; onRefresh: () => void; refreshing: boolean; error: string | null }) {
  const checked = new Date(report.checkedAt)
  return (
    <Card padding="none" data-testid="workspace-dns-status">
      <CardHeader
        title="Status"
        description={<>Live checks against <Mono>{report.probeHost ?? report.baseDomain ?? 'no base domain'}</Mono>, a random name no workspace has. Checked {checked.toLocaleTimeString()}; results are kept for a minute.</>}
        actions={<Button size="sm" variant="secondary" leadingIcon={<RefreshCw />} loading={refreshing} onClick={onRefresh} data-testid="workspace-dns-recheck">Check again</Button>}
      />
      {error && <div className="px-4 pb-3"><InlineNotice tone="danger" message={error} /></div>}
      <ul className="divide-y divide-border-subtle border-t border-border-subtle">
        {report.checks.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4" data-check={c.id} data-status={c.status}>
            <div className="flex items-center gap-2 sm:w-56 sm:shrink-0">
              <StatusPill status={c.status} tone={STATUS[c.status].tone} label={STATUS[c.status].label} />
              <span className="text-ui font-medium">{c.label}</span>
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-ui text-fg">{c.detail}</p>
              {c.values && c.values.length > 0 && (
                <p className="flex flex-wrap gap-1">{c.values.map((v) => <Mono key={v}>{v}</Mono>)}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* ── Vercel ──────────────────────────────────────────────────────────── */

function GoDaddyGuide({ report, route, setRoute }: { report: WorkspaceDnsReport; route: VercelRoute; setRoute: (r: VercelRoute) => void }) {
  const base = report.baseDomain ?? 'example.com'
  const zone = report.zone ?? base
  const opts = { baseDomain: base, zone }
  return (
    <div className="space-y-4" data-testid="dns-guide-godaddy">
      <SegmentedControl<VercelRoute>
        aria-label="GoDaddy setup option"
        value={route}
        onValueChange={setRoute}
        options={[{ value: 'nameservers', text: 'A: Switch nameservers to Vercel (recommended)' }, { value: 'records', text: 'B: Keep GoDaddy DNS' }]}
        className="max-w-full overflow-x-auto"
      />
      {route === 'nameservers' ? (
        <div className="space-y-3">
          <InlineNotice tone="warning" title="Copy every record before you switch">
            Once the nameservers change, GoDaddy&apos;s DNS records stop being used. Email (including Microsoft 365 bought through GoDaddy) stops
            unless the MX, autodiscover and SPF / DKIM / DMARC records are in Vercel first. Propagation can take up to 48 hours: lower the
            records&apos; TTL in GoDaddy a day before if you can.
          </InlineNotice>
          <Ol>
            <li>In GoDaddy: <b>My Products</b> → <Mono>{zone}</Mono> → <b>DNS</b>. Use <b>Export zone file</b> (in the <b>…</b> / Actions menu), or note every record: <Mono>MX</Mono>, <Mono>TXT</Mono> (SPF, DKIM, DMARC, site verification), and CNAMEs such as <Mono>email</Mono>, <Mono>autodiscover</Mono>, <Mono>lyncdiscover</Mono>, <Mono>enterpriseregistration</Mono> for Microsoft 365.</li>
            <li>Import them into Vercel, with the CLI or in the Vercel dashboard → <b>Domains</b> → <Mono>{zone}</Mono> → <b>DNS records</b>. Skip GoDaddy&apos;s own <Mono>@</Mono> A / <Mono>www</Mono> CNAME parking records; Vercel creates those.</li>
          </Ol>
          <CodeBlock code={`vercel dns import ${zone} ./${zone}.txt\nvercel dns ls ${zone}`} label="Copy commands" />
          <Ol>
            <li value={3}>In GoDaddy: <b>DNS</b> → <b>Nameservers</b> → <b>Change Nameservers</b> → <b>I&apos;ll use my own nameservers</b>, and enter:</li>
          </Ol>
          <DnsRecordsTable records={vercelNameserverRecords(opts)} caption="Vercel nameservers" />
          <Ol>
            <li value={4}>Save. Vercel creates the wildcard record and issues and renews the <Mono>*.{base}</Mono> certificate itself. Run <b>Check again</b> after a few minutes (or hours): Nameservers should say Vercel DNS.</li>
          </Ol>
        </div>
      ) : (
        <div className="space-y-3">
          <InlineNotice tone="info">
            Vercel documents switching nameservers as the supported route for wildcard domains, so this option may not get a certificate.
            The status checks above show whether it worked; if the certificate check keeps failing, use option A.
          </InlineNotice>
          <Ol>
            <li>In GoDaddy: <b>My Products</b> → <Mono>{zone}</Mono> → <b>DNS</b> → <b>DNS Records</b> → <b>Add New Record</b>.</li>
            <li>Add these records. GoDaddy wants the <b>Host</b> without the domain (<Mono>*</Mono>, not <Mono>*.{zone}</Mono>). Add one <Mono>NS</Mono> record per nameserver.</li>
          </Ol>
          <DnsRecordsTable records={vercelDnsRecords(opts, 'godaddy')} caption="GoDaddy DNS records" />
          <p className="text-ui text-fg-muted">The <Mono>NS</Mono> records hand only the <Mono>_acme-challenge</Mono> name to Vercel, so it can answer the DNS-01 challenge for the wildcard certificate. Your other records stay at GoDaddy.</p>
        </div>
      )}
    </div>
  )
}

function CloudflareGuide({ report }: { report: WorkspaceDnsReport }) {
  const base = report.baseDomain ?? 'example.com'
  const zone = report.zone ?? base
  return (
    <div className="space-y-3" data-testid="dns-guide-cloudflare">
      <Ol>
        <li>Cloudflare dashboard → <Mono>{zone}</Mono> → <b>DNS</b> → <b>Records</b> → <b>Add record</b>.</li>
        <li>Add the wildcard CNAME with <b>Proxy status: DNS only</b> (grey cloud), and the <Mono>_acme-challenge</Mono> NS records so Vercel can issue the certificate.</li>
      </Ol>
      <DnsRecordsTable records={vercelDnsRecords({ baseDomain: base, zone }, 'cloudflare')} caption="Cloudflare DNS records" />
      <p className="text-ui text-fg-muted">If the certificate check keeps failing, move the nameservers to Vercel instead (<Mono>{VERCEL_NAMESERVERS.join(', ')}</Mono>) after copying every record, as in the GoDaddy option A.</p>
    </div>
  )
}

function OtherGuide({ report, route, setRoute }: { report: WorkspaceDnsReport; route: VercelRoute; setRoute: (r: VercelRoute) => void }) {
  const base = report.baseDomain ?? 'example.com'
  const zone = report.zone ?? base
  const opts = { baseDomain: base, zone }
  return (
    <div className="space-y-3" data-testid="dns-guide-other">
      <SegmentedControl<VercelRoute>
        aria-label="Setup option"
        value={route}
        onValueChange={setRoute}
        options={[{ value: 'nameservers', text: 'Switch nameservers (recommended)' }, { value: 'records', text: 'Keep current DNS' }]}
      />
      {route === 'nameservers' ? (
        <>
          <p className="text-ui">At the registrar, after copying every existing record (MX, TXT, CNAME) into Vercel DNS, set the domain&apos;s nameservers to:</p>
          <DnsRecordsTable records={vercelNameserverRecords(opts)} caption="Vercel nameservers" />
        </>
      ) : (
        <>
          <p className="text-ui">In your DNS provider (Route 53: <b>Hosted zones</b> → <Mono>{zone}</Mono> → <b>Create record</b>), add:</p>
          <DnsRecordsTable records={vercelDnsRecords(opts, 'other')} caption="DNS records" />
          <p className="text-ui text-fg-muted">Some providers want the full name (<Mono>*.{base}</Mono>) in the name field; the second line under each host shows it.</p>
        </>
      )}
    </div>
  )
}

function VercelSetup({ report }: { report: WorkspaceDnsReport }) {
  const base = report.baseDomain ?? 'example.com'
  const [tab, setTab] = useState<DnsHostTab>(defaultDnsHostTab(report.provider))
  const [route, setRoute] = useState<VercelRoute>('nameservers')
  return (
    <div className="space-y-8">
      <Step n={1} title="Add the wildcard domain in Vercel">
        <Ol>
          <li>Vercel → the project → <b>Settings</b> → <b>Domains</b> → <b>Add Domain</b>.</li>
          <li>Enter <Mono>*.{base}</Mono> and save. Keep <Mono>{base}</Mono> and <Mono>www.{base}</Mono> as they are.</li>
        </Ol>
        <CodeBlock code={`vercel domains add '*.${base}'`} label="Copy command" />
      </Step>

      <Step n={2} title="Point DNS at Vercel">
        {report.provider === 'vercel' ? (
          <InlineNotice tone="success" title="Already on Vercel DNS">
            <Mono>{report.zone ?? base}</Mono> uses Vercel&apos;s nameservers, so Vercel creates the wildcard record and certificate when you add
            the domain in step 1. Nothing to do here.
          </InlineNotice>
        ) : (
          <p className="text-ui text-fg-muted">
            Detected DNS host: <b className="text-fg">{DNS_PROVIDER_LABELS[report.provider]}</b>
            {report.nameservers.length > 0 && <> ({report.nameservers.join(', ')})</>}. Vercel issues the <Mono>*.{base}</Mono> certificate through
            a DNS-01 challenge, so it needs your nameservers, or the <Mono>_acme-challenge</Mono> name delegated to it. The wildcard itself is a
            CNAME to <Mono>{VERCEL_CNAME_TARGET}</Mono>.
          </p>
        )}
        <Tabs<DnsHostTab>
          idBase="dns-host"
          aria-label="DNS host"
          value={tab}
          onValueChange={setTab}
          items={[{ value: 'godaddy', label: 'GoDaddy' }, { value: 'cloudflare', label: 'Cloudflare' }, { value: 'other', label: 'Other DNS provider' }]}
        />
        <TabPanel idBase="dns-host" value={tab}>
          {tab === 'godaddy' && <GoDaddyGuide report={report} route={route} setRoute={setRoute} />}
          {tab === 'cloudflare' && <CloudflareGuide report={report} />}
          {tab === 'other' && <OtherGuide report={report} route={route} setRoute={setRoute} />}
        </TabPanel>
      </Step>

      <Step n={3} title="Verify">
        <VerifyText base={base} />
      </Step>
    </div>
  )
}

/* ── Self-hosted ─────────────────────────────────────────────────────── */

function SelfHostedSetup({ report }: { report: WorkspaceDnsReport }) {
  const base = report.baseDomain ?? 'example.com'
  const records = selfHostedRecords({ baseDomain: base, zone: report.zone, apexAddresses: report.apexAddresses })
  return (
    <div className="space-y-8">
      <Step n={1} title="Set the base domain">
        <p className="text-ui">Workspace addresses are off on a self-hosted install until <Mono>APP_BASE_DOMAIN</Mono> is set in the app environment (then restart):</p>
        <CodeBlock code={`APP_BASE_DOMAIN=${base}`} />
        <p className="text-ui text-fg-muted">Use a dedicated domain (<Mono>tasks.example.com</Mono>) if anything else — a blog, a status page — is served under the main domain: the session cookie is scoped to <Mono>Domain={base}</Mono>, so every host under it receives it. Sign-in stays on <Mono>{base}</Mono>, so SSO redirect URIs need no wildcard. For local development use <Mono>APP_BASE_DOMAIN=localhost</Mono> and open <Mono>http://acme.localhost:3000</Mono> (sign in on that address; browsers don&apos;t share cookies between localhost names).</p>
      </Step>

      <Step n={2} title="Add the wildcard DNS record">
        <p className="text-ui">Next to the apex record, point <Mono>*.{base}</Mono> at the same load balancer{report.apexAddresses.v4.length + report.apexAddresses.v6.length > 0 ? ' (the addresses below are what the apex resolves to now)' : ''}:</p>
        <DnsRecordsTable records={records} caption="Wildcard DNS record" />
      </Step>

      <Step n={3} title="Get a wildcard certificate">
        <p className="text-ui">Certificates for <Mono>*.{base}</Mono> can only be issued with a DNS-01 challenge, so the certificate tooling needs API access to the DNS zone (or upload a purchased wildcard certificate). For example:</p>
        <CodeBlock label="Copy cert-manager example" code={`# cert-manager (Kubernetes)\napiVersion: cert-manager.io/v1\nkind: Certificate\nmetadata:\n  name: usertasks-wildcard\nspec:\n  secretName: usertasks-tls\n  issuerRef: { name: letsencrypt-dns01, kind: ClusterIssuer }\n  dnsNames: ["${base}", "*.${base}"]`} />
        <CodeBlock label="Copy Caddyfile example" code={`# Caddy (built with a DNS provider module, e.g. caddy-dns/cloudflare)\n${base}, *.${base} {\n  tls { dns cloudflare {env.CF_API_TOKEN} }\n  reverse_proxy app:3000\n}`} />
        <CodeBlock label="Copy Traefik example" code={`# Traefik v3 (router labels)\ntraefik.http.routers.usertasks.rule=Host(\`${base}\`) || HostRegexp(\`^[a-z0-9-]+\\.${base.replace(/\./g, '\\.')}$\`)\ntraefik.http.routers.usertasks.tls.certresolver=dns01\ntraefik.http.routers.usertasks.tls.domains[0].main=${base}\ntraefik.http.routers.usertasks.tls.domains[0].sans=*.${base}`} />
      </Step>

      <Step n={4} title="Forward the Host header">
        <p className="text-ui">The proxy in front of the app must pass the original <Mono>Host</Mono> (the app reads the workspace from it). nginx: <Mono>proxy_set_header Host $host;</Mono>. Caddy and Traefik forward it by default.</p>
      </Step>

      <Step n={5} title="Verify">
        <VerifyText base={base} />
      </Step>
    </div>
  )
}

function VerifyText({ base }: { base: string }) {
  return (
    <>
      <p className="text-ui">Run <b>Check again</b> in the status panel: wildcard DNS, the certificate and &ldquo;App answers&rdquo; should all be OK. A random name answers 404 (&ldquo;No workspace at this address&rdquo;) — that&apos;s the app working.</p>
      <p className="text-ui text-fg-muted">Then members see their workspace&apos;s address, <Mono>&lt;workspace&gt;.{base}</Mono>, in <b>Settings → General → Workspace address</b>, and every reusable form gets a friendly link on it. <a className="inline-flex items-center gap-1 text-primary-text hover:underline" href="/docs/governance/workspace-address">Workspace address docs <ExternalLink className="size-3.5" aria-hidden /></a></p>
    </>
  )
}

/* ── Page ────────────────────────────────────────────────────────────── */

export function WorkspaceDnsView({ initialReport }: { initialReport: WorkspaceDnsReport }) {
  const [report, setReport] = useState(initialReport)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      const result = await checkWorkspaceDnsAction()
      if ('error' in result) setError(result.error)
      else setReport(result.report)
    } catch {
      setError('The checks could not be run. Try again.')
    } finally {
      setRefreshing(false)
    }
  }

  const base = report.baseDomain
  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="workspace-dns-page">
      <PageHeader
        title="Workspace DNS"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Workspace DNS' }]}
        description={base
          ? <>DNS and certificate setup for workspace addresses, <Mono>&lt;workspace&gt;.{base}</Mono>. {report.hosting === 'vercel' ? 'This instance runs on Vercel.' : 'This instance is self-hosted.'}</>
          : 'DNS and certificate setup for workspace addresses (<workspace>.<your domain>).'}
      />

      {!report.enabled && (
        <InlineNotice tone="warning" title="Workspace addresses are off">
          {report.hosting === 'vercel'
            ? <>Set <Mono>APP_URL</Mono> to the production address (the base domain is its host, <Mono>www.</Mono> / <Mono>app.</Mono> stripped) or <Mono>APP_BASE_DOMAIN</Mono>, and remove <Mono>APP_BASE_DOMAIN=off</Mono> if it is set. Then redeploy.</>
            : <>Set <Mono>APP_BASE_DOMAIN</Mono> (e.g. <Mono>example.com</Mono>) in the app environment and restart. The steps below use <Mono>example.com</Mono> until then.</>}
        </InlineNotice>
      )}

      <StatusPanel report={report} onRefresh={() => void refresh()} refreshing={refreshing} error={error} />

      <Card padding="none">
        <CardHeader title="What to set up" description={report.hosting === 'vercel' ? 'The app is on Vercel: add the wildcard domain there, then point DNS at Vercel.' : 'The app is self-hosted: wildcard DNS and a wildcard certificate in front of your load balancer.'} />
        <CardBody className="border-t border-border-subtle">
          {report.hosting === 'vercel' ? <VercelSetup report={report} /> : <SelfHostedSetup report={report} />}
        </CardBody>
      </Card>
    </div>
  )
}
