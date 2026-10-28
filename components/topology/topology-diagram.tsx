import type { CSSProperties } from 'react'
import { ArrowDown, ArrowRight, Boxes, MonitorSmartphone } from 'lucide-react'
import { AREA_LABEL, VENDOR_LABEL, type TopologyDef, type TopologyItem, type Vendor } from '@/lib/topologies'

/**
 * Architecture diagram of a deployment topology (lib/topologies.ts):
 * clients → the UserTasks app (hosting + built-in providers) → the services
 * each area uses, grouped by where they run.
 *
 * Plain HTML rather than SVG so it reflows with the width it is given (see
 * the container queries below): stacked on phones, two rows in a docs
 * column, one row on a full-width page. Colours are CSS variables: surfaces and text
 * follow the --theme-* tokens (light brand defaults as fallbacks, as in
 * use-case-diagram.tsx), vendor accents have light and dark values (the app's
 * `dark` variant), so the diagram stays legible on either theme.
 */

const TOKENS = {
  '--topo-card': 'var(--theme-card-bg, #FFFFFF)',
  '--topo-text': 'var(--theme-card-text, #1B1916)',
  '--topo-muted': 'var(--theme-muted-text, #6E6759)',
  '--topo-border': 'var(--theme-surface-border, #E6E1D5)',
  '--topo-surface': 'var(--theme-surface, #F5F2EA)',
  '--topo-app': '#8A6D45',
  '--topo-supabase': '#2F7A52',
  '--topo-aws': '#A35A12',
  '--topo-azure': '#2463A8',
  '--topo-gcp': '#6A4FB0',
  '--topo-saas': '#56606B',
  '--topo-network': '#7A5A2E',
} as CSSProperties

const DARK = 'dark:[--topo-app:#D9B98A] dark:[--topo-supabase:#6FC59A] dark:[--topo-aws:#F0A65C] dark:[--topo-azure:#7FB2EE] dark:[--topo-gcp:#B9A2F2] dark:[--topo-saas:#AEB8C2] dark:[--topo-network:#D9B98A]'

const accent = (vendor: Vendor) => `var(--topo-${vendor})`

function Chip({ item, vendor }: { item: TopologyItem; vendor: Vendor }) {
  return (
    <li className="min-w-0 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--topo-border)', background: 'var(--topo-card)' }}>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: accent(vendor) }}>{AREA_LABEL[item.area]}</span>
      <span className="block text-[13px] font-medium leading-5" style={{ color: 'var(--topo-text)' }}>{item.service}</span>
    </li>
  )
}

/** Arrow between columns: down while stacked, right once the container is wide enough. */
function Connector({ at }: { at: 'xl' | '5xl' }) {
  const [down, right] = at === 'xl' ? ['@xl:hidden', 'hidden @xl:block'] : ['@5xl:hidden', 'hidden @5xl:block']
  return (
    <div className="flex shrink-0 items-center justify-center" aria-hidden="true" style={{ color: 'var(--topo-app)' }}>
      <ArrowDown size={18} className={down} />
      <ArrowRight size={18} className={right} />
    </div>
  )
}

export function TopologyDiagram({ topology, caption = true, className = '' }: { topology: TopologyDef; caption?: boolean; className?: string }) {
  const descId = `topology-${topology.id}-desc`
  return (
    <figure className={`topology-diagram @container ${DARK} ${className}`} style={TOKENS} role="group" aria-labelledby={`topology-${topology.id}-title`} aria-describedby={descId}>
      <div className="rounded-2xl border p-3 sm:p-4" style={{ borderColor: 'var(--topo-border)', background: 'var(--topo-surface)' }}>
        <p id={`topology-${topology.id}-title`} className="sr-only">{topology.name}</p>
        {/*
          Layout follows the figure's own width (container queries), so it fits
          a docs column as well as a full-width page:
          narrow: everything stacked · @xl: clients → app on one row, services
          below · @5xl: clients → app → services on one row.
        */}
        <div className="flex flex-col gap-2 @5xl:flex-row @5xl:items-center @5xl:gap-3">
          <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center @xl:gap-3 @5xl:w-[25rem] @5xl:shrink-0">
            {/* Clients */}
            <div className="rounded-xl border p-3 @xl:w-36 @xl:shrink-0" style={{ borderColor: 'var(--topo-border)', background: 'var(--topo-card)' }}>
              <MonitorSmartphone size={18} aria-hidden="true" style={{ color: 'var(--topo-muted)' }} />
              <p className="mt-1.5 text-sm font-semibold" style={{ color: 'var(--topo-text)' }}>People and clients</p>
              <p className="text-xs leading-5" style={{ color: 'var(--topo-muted)' }}>Browser · REST API · MCP · CLI</p>
            </div>

            <Connector at="xl" />

            {/* The app */}
            <div className="min-w-0 flex-1 rounded-xl border-2 p-3" style={{ borderColor: 'var(--topo-app)', background: 'var(--topo-card)' }}>
              <p className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--topo-text)' }}>
                <Boxes size={16} aria-hidden="true" style={{ color: 'var(--topo-app)' }} /> UserTasks
              </p>
              <p className="text-xs leading-5" style={{ color: 'var(--topo-muted)' }}>Web, API and worker · {topology.hosting}</p>
              {topology.builtIn.length > 0 && (
                <>
                  <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--topo-muted)' }}>{VENDOR_LABEL.app}</p>
                  <ul className="mt-1.5 grid gap-1.5 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-1">
                    {topology.builtIn.map((item) => <Chip key={item.area} item={item} vendor="app" />)}
                  </ul>
                </>
              )}
            </div>
          </div>

          <Connector at="5xl" />

          {/* Services by where they run */}
          <div className="grid min-w-0 flex-1 gap-2">
            {topology.zones.map((zone) => (
              <section key={zone.label} className="rounded-xl border border-l-4 p-3" style={{ borderColor: 'var(--topo-border)', borderLeftColor: accent(zone.vendor), background: 'var(--topo-card)' }} aria-label={zone.label}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold" style={{ color: 'var(--topo-text)' }}>
                  {zone.label}
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: accent(zone.vendor) }}>{VENDOR_LABEL[zone.vendor]}</span>
                </p>
                <ul className="mt-2 grid gap-1.5 @md:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-2">
                  {zone.items.map((item) => <Chip key={item.area} item={item} vendor={zone.vendor} />)}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
      {caption
        ? <figcaption id={descId} className="mt-2 text-center text-sm leading-6" style={{ color: 'var(--topo-muted)' }}>{topology.desc}</figcaption>
        : <figcaption id={descId} className="sr-only">{topology.desc}</figcaption>}
    </figure>
  )
}
