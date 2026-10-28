/**
 * Integration cards (card view): the tag editor must not sit inside the
 * card's <a>. Pressing Enter in the tag input submits its form, and implicit
 * submission dispatches a click on the form's submit button; that click
 * bubbled up to the enclosing <Link> and navigated to the integration page.
 * Now the card's only link is the title (stretched over the card with an
 * ::after overlay) and the tag editor is a sibling above the overlay, so no
 * interactive element is nested inside an anchor.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/integrations' }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({}) }) }))
vi.mock('@/app/actions/integration-references', () => ({ deleteReference: vi.fn() }))
vi.mock('@/app/actions/integrations', () => ({ deleteIntegration: vi.fn() }))
vi.mock('@/components/connectors/connectors-catalog', () => ({ ConnectorsCatalog: () => null }))

import { IntegrationsView } from '@/components/integrations/integrations-view'

const INTEGRATION = {
  id: 'int-1', name: 'Payments API', type: 'rest_api', is_active: true, tags: ['billing'],
  config: { base_url: 'https://pay.example.com' }, last_test_status: 'success', updated_at: '2026-10-01T00:00:00Z',
}

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(IntegrationsView, {
      integrations: [INTEGRATION], references: [],
      initialTagDefs: [{ id: 't1', name: 'billing', color: '#ff0000' }],
    })))
}

/** Tags opened while inside an <a> (a minimal tag walker over the static markup). */
function interactiveInsideAnchors(html: string): string[] {
  const found: string[] = []
  let depth = 0
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    const [, closing, tag, selfClosing] = m
    const name = tag.toLowerCase()
    if (name === 'a') {
      if (closing) depth--
      else if (!selfClosing) depth++
      continue
    }
    if (!closing && depth > 0 && ['button', 'input', 'form', 'select', 'textarea'].includes(name)) found.push(name)
  }
  return found
}

describe('integration card tag editor', () => {
  it('renders the card with a title link to the integration and the tag editor outside any link', () => {
    const html = render()
    const card = html.slice(html.indexOf('Payments API') - 600, html.indexOf('Payments API') + 3000)
    expect(card).toMatch(/<a [^>]*href="\/integrations\/int-1"[^>]*>Payments API<\/a>/)
    // The link covers the card through its ::after overlay.
    expect(card).toMatch(/<a class="[^"]*after:absolute after:inset-0[^"]*" href="\/integrations\/int-1">/)
    // The tag editor (badge + "add tag" button) is rendered…
    expect(card).toContain('billing')
    // …and nothing interactive is nested in an anchor, so Enter / clicks in
    // the editor cannot follow the card link.
    expect(interactiveInsideAnchors(html)).toEqual([])
  })

  it('the walker catches the old structure (editor inside the card link)', () => {
    const old = '<a href="/integrations/int-1"><div><h3>Payments API</h3><div><form><input/><button type="submit"></button></form></div></div></a>'
    expect(interactiveInsideAnchors(old)).toEqual(['form', 'input', 'button'])
  })
})
