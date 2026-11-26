/**
 * Accessibility regressions found in the Nov 2026 UX / WCAG pass: core
 * controls that had no accessible name, hand-rolled modals without dialog
 * semantics, and shell landmarks. Server-rendered markup checks (this suite
 * runs in node) plus source guards for page-level components.
 */
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/app/actions/invitations', () => ({ createInvitation: vi.fn() }))

import { InviteForm } from '@/components/admin/invite-form'
import { ToastViewport } from '@/components/ui/toast'

function labelFor(html: string, id: string): string | null {
  const m = html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>(.*?)</label>`))
  return m ? m[1].replace(/<[^>]+>/g, '') : null
}

describe('invite a teammate: every control is labelled', () => {
  const html = renderToStaticMarkup(h(QueryClientProvider, { client: new QueryClient() }, h(InviteForm)))
  it('the email input and the role select have visible labels tied to them', () => {
    expect(html).toContain('id="invite-email"')
    expect(labelFor(html, 'invite-email')).toBe('Email address')
    expect(html).toMatch(/<select[^>]*id="invite-role"/)
    expect(labelFor(html, 'invite-role')).toBe('Role')
  })
  it('the outcome is announced (a polite live region) and the button is sentence case', () => {
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Send invitation')
    expect(html).not.toContain('Send Invitation')
  })
})

describe('shell landmarks', () => {
  it('the toast stack is a labelled region (aria-label on a plain div is not exposed)', () => {
    expect(renderToStaticMarkup(h(ToastViewport, { 'aria-label': 'Notifications' }))).toMatch(/role="region"[^>]*aria-label="Notifications"/)
  })
  it('the dashboard shell has a skip link to a focusable <main id="main">', () => {
    const src = readFileSync('components/layout/dashboard-shell.tsx', 'utf8')
    expect(src).toContain('href="#main"')
    expect(src).toContain('Skip to main content')
    expect(src).toMatch(/id="main"\s+tabIndex=\{-1\}/)
  })
  it('loading placeholders that carry aria-label have a role (status), so the label is exposed', () => {
    for (const f of ['components/ui/page-skeleton.tsx', 'components/layout/dashboard-shell.tsx', 'components/home/shared.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/<div className="[^"]*" aria-busy(="true")? aria-label=/)
    }
  })
})

describe('report builder: Save report is a real dialog', () => {
  const src = readFileSync('app/(dashboard)/reports/builder/page.tsx', 'utf8')
  it('uses the shared Dialog (focus trap, Esc, focus return) with labelled fields', () => {
    expect(src).toMatch(/<Dialog open=\{showSave\}/)
    expect(src).toContain('<Field label="Report name">')
    expect(src).not.toMatch(/fixed inset-0 z-50 flex items-center justify-center bg-black\/40" onClick=\{\(\) => setShowSave\(false\)\}/)
  })
})

describe('connector dialogs use the shared Dialog', () => {
  for (const f of ['components/connectors/connector-setup-dialog.tsx', 'components/connectors/connector-detail.tsx']) {
    it(`${f}: Dialog primitive, titled, labelled close button`, () => {
      const src = readFileSync(f, 'utf8')
      expect(src).toContain('<Dialog open onOpenChange=')
      expect(src).toContain('<DialogTitle')
      expect(src).toContain('aria-label="Close"')
      expect(src).not.toContain('className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}')
    })
  }
})

describe('Tabs never point aria-controls at a missing panel', () => {
  it('server markup carries no aria-controls (set after mount only when the panel exists)', async () => {
    const { Tabs } = await import('@/components/ui/tabs')
    const html = renderToStaticMarkup(h(Tabs, { items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', 'aria-label': 'T' }))
    expect(html).toContain('role="tab"')
    expect(html).not.toContain('aria-controls')
    expect(html).toContain('data-panel-id=')
  })
})
