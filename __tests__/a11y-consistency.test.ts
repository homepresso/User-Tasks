/**
 * Consistency / WCAG follow-ups from the Nov 2026 UX pass: no native
 * confirm() / alert(), modals on the shared Dialog, EmptyState heading
 * levels, avatar contrast, sign-up hints, sentence case, My tasks toolbar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '@/components/ui/empty-state'

const read = (p: string) => readFileSync(p, 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('no native confirm() / alert() in the app', () => {
  it('components/ and app/ use ConfirmDialog (useConfirm) and toasts instead', () => {
    const offenders: string[] = []
    for (const f of [...walk('components'), ...walk('app')]) {
      if (f.includes('/marketing/')) continue
      const src = read(f)
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\*|\/\/)/.test(line)) return
        if (/(^|[^.\w])(window\.)?(confirm|alert)\(\s*[`'"]/.test(line) || /window\.(confirm|alert)\(/.test(line)) offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('modals on the shared Dialog', () => {
  for (const f of ['components/integrations/import-api-dialog.tsx', 'components/integrations/reference-list.tsx']) {
    it(f, () => {
      const src = read(f)
      expect(src).toContain('<Dialog open onOpenChange=')
      expect(src).toContain('<DialogTitle')
      expect(src).not.toMatch(/className="fixed inset-0 z-50 flex items-center justify-center"/)
    })
  }
})

describe('EmptyState heading level', () => {
  const tag = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).match(/<(h\d)[ >]/)?.[1]
  it('page-level (md / lg) is an h2 under the page h1; size sm is an h3; headingLevel overrides', () => {
    expect(tag(h(EmptyState, { title: 'No workflows yet' }))).toBe('h2')
    expect(tag(h(EmptyState, { title: 'x', size: 'lg' }))).toBe('h2')
    expect(tag(h(EmptyState, { title: 'x', size: 'sm' }))).toBe('h3')
    expect(tag(h(EmptyState, { title: 'x', headingLevel: 4 }))).toBe('h4')
  })
  it('home widgets (titles are h3) put their empty states at h4', () => {
    const src = read('components/home/home-tabs.tsx')
    expect(src.match(/<EmptyState /g)?.length).toBe(src.match(/<EmptyState headingLevel=\{4\}/g)?.length)
  })
})

describe('avatar initials meet 4.5:1 on their wash (default theme, light)', () => {
  const css = read('app/globals.css')
  const token = (name: string) => css.match(new RegExp(`--theme-${name}:\\s*(#[0-9A-Fa-f]{6})`))![1]
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const mix = (a: number[], b: number[], p: number) => a.map((v, i) => v * p + b[i] * (1 - p))
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const src = read('components/ui/avatar.tsx')
  it('every hue', () => {
    for (let n = 1; n <= 6; n++) {
      const wash = Number(src.match(new RegExp(`var\\(--theme-chart-${n}\\)_(\\d+)%`))![1]) / 100
      const pull = Number(src.match(new RegExp(`var\\(--theme-chart-${n}-text\\)_(\\d+)%,var\\(--theme-card-text\\)`))![1]) / 100
      const bg = mix(rgb(token(`chart-${n}`)), rgb(token('card-bg')), wash)
      const fg = mix(rgb(token(`chart-${n}-text`)), rgb(token('card-text')), pull)
      expect(ratio(fg, bg), `chart-${n}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('sign-up hints are tied to their fields', () => {
  it('each hinted input has aria-describedby pointing at its hint', () => {
    const src = read('components/marketing/beta-signup-form.tsx')
    for (const id of ['beta-company', 'beta-email', 'beta-password', 'beta-usecase']) {
      expect(src).toContain(`<input id="${id}" aria-describedby="${id}-hint"`)
      expect(src).toContain(`<p id="${id}-hint"`)
    }
  })
})

describe('My tasks: one completed control and a phone-friendly toolbar', () => {
  const src = read('app/(dashboard)/tasks/page.tsx')
  it('Open / Completed / All is the control; no "Show completed" switch on My tasks', () => {
    expect(src).toContain('aria-label="Open or completed tasks"')
    expect(src).not.toContain('onShowCompletedChange=')
  })
  it('the search takes its own row on phones', () => {
    expect(src).toMatch(/wrapperClassName="order-1 min-w-0 basis-full sm:basis-auto/)
  })
})

describe('sentence case on the leftovers', () => {
  it.each([
    ['components/governance/user-role-assignments.tsx', 'User Assignments'],
    ['components/governance/retention-policies-manager.tsx', 'Retention Policies'],
    ['components/automations/process-viewer.tsx', '>User Tasks<'],
    ['app/(dashboard)/settings/webhooks/page.tsx', 'Webhook Delivery'],
    ['components/integrations/import-api-dialog.tsx', 'Select All'],
    ['components/connectors/connector-setup-dialog.tsx', 'Enable Connector'],
    ['components/connectors/connector-detail.tsx', 'Save Changes'],
  ])('%s has no "%s"', (f, s) => {
    expect(read(f)).not.toContain(s)
  })
})

describe('browser-found follow-ups (axe on the converted connector dialog, the app board, Integrations)', () => {
  it('connector fields: label for the control, help / error described, the show-password toggle named', async () => {
    const { ConnectorFieldRenderer } = await import('@/components/connectors/connector-field-renderer')
    const html = renderToStaticMarkup(h(ConnectorFieldRenderer, {
      fields: [{ key: 'token', label: 'API token', type: 'password', required: true, helpText: 'From the admin console' }] as never,
      values: {}, onChange: () => {},
    }))
    const id = html.match(/<label for="([^"]+)"/)?.[1]
    expect(id).toBeTruthy()
    expect(html).toMatch(new RegExp(`<input[^>]*id="${id}"`))
    expect(html).toContain(`aria-describedby="${id}-help"`)
    expect(html).toContain('aria-label="Show API token"')
  })
  it('the horizontal app nav is not a role=list of links; Kanban "Nothing here" is legible; the connector sort is named', () => {
    expect(read('components/apps/nav-menu.tsx')).not.toMatch(/gap-0\.5", className\)\} role="list"/)
    expect(read('components/apps/widgets/task-widgets.tsx')).not.toContain('text-fg-subtle">Nothing here')
    expect(read('components/connectors/connectors-catalog.tsx')).toContain('aria-label="Sort connectors"')
  })
})
