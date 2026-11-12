import type { Metadata } from 'next'
import { Workflow, Layers, Zap, Shield, Bot, BarChart3 } from 'lucide-react'
import { Wordmark } from '@/components/brand/logo'
import { PublicThemeReset } from '@/components/layout/public-theme-reset'
import { APP_NAME, TITLE_TEMPLATE } from '@/lib/page-title'
import { themeVars } from '@/lib/theme/to-css'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'

export const metadata: Metadata = {
  title: { template: TITLE_TEMPLATE, default: `Sign in · ${APP_NAME}` },
}

/** The platform's light palette (the default theme), whatever the visitor's workspace. */
const PLATFORM_LIGHT = themeVars(defaultWorkspaceTheme(), 'light') as React.CSSProperties

const FEATURES = [
  { icon: Workflow, label: 'Visual workflow designer' },
  { icon: Layers, label: 'Integrations and decision tables' },
  { icon: Zap, label: 'Human tasks and SLAs' },
  { icon: Bot, label: 'Optional AI agents' },
  { icon: BarChart3, label: 'Reports, API and MCP' },
  { icon: Shield, label: 'Governance and audit trails' },
] as const

/**
 * Signed-out pages (docs/design/ui-polish-spec.md §5.16): two columns, the
 * brand message on the left (Fraunces headline, an icon + label list) and the
 * form on the right. Always the platform's light look: a workspace theme
 * never reaches these pages.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      // The platform light palette, set here so the first paint is right even
      // after a client-side navigation from a dark workspace (PublicThemeReset
      // then clears <html>). data-ds-scope re-derives the design tokens from it.
      data-ds-scope
      className="flex min-h-screen bg-bg text-fg"
      style={PLATFORM_LIGHT}
    >
      <PublicThemeReset headings="display" />
      {/* Left panel — brand and message */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border-subtle bg-panel p-12 lg:flex lg:w-1/2 xl:w-[55%]">
        <div>
          <p>
            <Wordmark size={36} />
          </p>
          <p className="mt-3 text-sm text-fg-muted">The open source process platform</p>
        </div>

        <div className="max-w-lg space-y-8">
          <div>
            <h2 className="font-display text-4xl font-semibold leading-tight text-fg">
              Workflows run.<br />
              People make<br />
              the calls.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-fg-muted">
              Design workflows visually, connect your systems, and route
              decisions to people as tasks — then drive it all from your own
              apps through the API and MCP server.
            </p>
          </div>

          <ul className="grid grid-cols-2 gap-x-6 gap-y-3">
            {FEATURES.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2.5 text-sm text-fg">
                <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-fg-muted">
          Open source under Apache-2.0 — self-host it or use the cloud edition.
        </p>
      </div>

      {/* Right panel — the form */}
      <main className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="mb-10 text-center lg:hidden">
            <p className="flex justify-center">
              <Wordmark size={32} />
            </p>
            <p className="mt-2 text-xs text-fg-muted">The open source process platform</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
