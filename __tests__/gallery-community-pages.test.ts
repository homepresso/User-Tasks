/**
 * Community package page and "Share your solution" page on the gallery's
 * detail design: the Community (unverified publisher) badge and the author,
 * one h1, the download / version / report links unchanged, the share page's
 * sections, and the share form's validation messages.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CommunityPackagePage } from '@/components/gallery/community-package-page'
import { SHARE_SECTIONS, SharePage } from '@/components/gallery/share-page'
import { ShareForm } from '@/components/gallery/share-form'
import { COMMUNITY_LIMITS } from '@/lib/gallery/community'
import { SHARE_LIMITS, validateShareField, validateShareForm, type ShareValues } from '@/lib/gallery/share-validation'
import type { CommunityPackageView } from '@/lib/services/gallery-community'

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length

function pkg(over: Partial<CommunityPackageView> = {}): CommunityPackageView {
  return {
    id: 'p1', package_uid: '0c6a1100-0000-4000-8000-000000005c01', slug: 'community-visitor-desk', title: 'Community visitor desk',
    summary: 'A reception form signs visitors in and emails their host; nothing to configure.',
    description: 'Visitors sign in on a themed form.\n\nThe host is emailed.', category: 'workplace', tags: ['visitors', 'reception'],
    licence: 'MIT', author_name: 'Grace Example', author_url: 'https://example.com/grace', trigger: 'form', native: true,
    current_version: '1.1.0', downloads: 42, screenshots: [], created_at: '2026-10-20T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
    versions: [
      { version: '1.1.0', file_name: 'community-visitor-desk-1.1.0.utpkg', size_bytes: 48211, sha256: 'abc123', checksum: 'sha256:def456', signed: true, fingerprint: 'SHA256:fp-author', notes: 'Daily summary.', requirement_count: 0, asset_count: 6, downloads: 30, released_at: '2026-11-02T00:00:00Z' },
      { version: '1.0.0', file_name: 'community-visitor-desk-1.0.0.utpkg', size_bytes: 45102, sha256: 'aaa', checksum: 'sha256:bbb', signed: false, fingerprint: null, notes: null, requirement_count: 0, asset_count: 5, downloads: 12, released_at: '2026-10-20T00:00:00Z' },
    ],
    ...over,
  }
}

describe('community package page', () => {
  const html = renderToStaticMarkup(createElement(CommunityPackagePage, { pkg: pkg() }))

  it('has one h1, the title', () => {
    expect(count(html, /<h1[\s>]/g)).toBe(1)
    expect(html).toContain('>Community visitor desk</h1>')
  })

  it('shows the Community / unverified badge, never Official · Signed', () => {
    expect(html).toContain('data-testid="origin-community"')
    expect(html).toContain('Community · Unverified publisher')
    // The page itself (related official cards below it carry their own Official badge).
    const page = html.slice(0, html.indexOf('data-testid="related"'))
    expect(page).not.toContain('data-testid="origin-official"')
    expect(page).not.toContain('Official · UserTasks')
  })

  it('shows the author, their link (nofollow ugc) and that the identity is not verified', () => {
    expect(html).toMatch(/href="https:\/\/example\.com\/grace"[^>]*rel="nofollow ugc noopener"/)
    expect(html).toContain('Grace Example')
    expect(html).toContain('data-testid="author-verification"')
    expect(html).toContain('Identity not verified by UserTasks')
    expect(html).toContain("Signed with the author&#x27;s own key")
    expect(html).toContain('SHA256:fp-author')
  })

  it('keeps the download, version and report links and test ids', () => {
    expect(html).toMatch(/href="\/api\/gallery\/community\/community-visitor-desk\/download"[^>]*data-testid="download-community"/)
    expect(count(html, /data-testid="download-community"/g)).toBe(1)
    expect(html).toContain('href="/api/gallery/community/community-visitor-desk/download?version=1.1.0"')
    expect(html).toContain('href="/api/gallery/community/community-visitor-desk/download?version=1.0.0"')
    expect(html).toContain('data-testid="download-count"')
    expect(html).toContain('data-testid="version-history"')
    expect(html).toContain('data-testid="report-abuse"')
    expect(html).toContain('href="/gallery/share"')
    expect(html).toContain('id="install"')
  })

  it('emits JSON-LD with the author and the breadcrumb', () => {
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1]
    const ld = JSON.parse(json ?? '{}')
    const app = ld['@graph'].find((n: { '@type': string }) => n['@type'] === 'SoftwareApplication')
    expect(app.author).toMatchObject({ '@type': 'Person', name: 'Grace Example', url: 'https://example.com/grace' })
    expect(app.softwareVersion).toBe('1.1.0')
    expect(app.license).toBe('MIT')
    expect(ld['@graph'].find((n: { '@type': string }) => n['@type'] === 'BreadcrumbList').itemListElement).toHaveLength(4)
  })

  it('an unsigned package without a link says so', () => {
    const plain = renderToStaticMarkup(createElement(CommunityPackagePage, { pkg: pkg({ author_url: null, current_version: '1.0.0' }) }))
    expect(plain).toContain('<strong class="font-semibold text-(color:--mkt-ink-soft)" data-testid="community-author">Grace Example</strong>')
    expect(plain).toContain('Not signed.')
    expect(plain).not.toContain('nofollow ugc')
  })
})

describe('share page', () => {
  it('renders its sections in order with one h1', () => {
    const html = renderToStaticMarkup(createElement(SharePage, { user: null, submissions: [], enabled: true }))
    expect(count(html, /<h1[\s>]/g)).toBe(1)
    let last = -1
    for (const s of SHARE_SECTIONS) {
      const at = html.indexOf(`id="${s.id}"`)
      expect(at, s.id).toBeGreaterThan(last)
      last = at
      expect(html).toContain(`href="#${s.id}"`)
    }
    expect(html).toContain('data-testid="share-checks"')
    expect(html).toContain('data-testid="share-signing"')
    expect(html).toContain('id="contribute"')
    expect(html).toContain('data-testid="share-sign-in"')
    expect(html).toContain('href="/login?redirect=%2Fgallery%2Fshare"')
  })

  it('shows the form and the submissions when signed in, a note when sharing is off', () => {
    const html = renderToStaticMarkup(createElement(SharePage, { user: { name: 'Ana' }, enabled: true, submissions: [{ id: 's1', slug: 'x-desk', version: '1.0.0', title: 'X desk', status: 'approved', decision_reason: null, created_at: '2026-11-01T00:00:00Z', reviewed_at: null, validation: { ok: true, issues: [] } }] }))
    expect(html).toContain('data-testid="share-form"')
    expect(html).toContain('data-testid="my-submissions"')
    expect(html).toContain('href="/gallery/community/x-desk"')
    const off = renderToStaticMarkup(createElement(SharePage, { user: null, submissions: [], enabled: false }))
    expect(off).toContain('data-testid="share-disabled"')
    expect(off).not.toContain('data-testid="share-form"')
  })

  it('labels every field and keeps the field names and limits', () => {
    const html = renderToStaticMarkup(createElement(ShareForm, { defaultAuthor: 'Ana' }))
    for (const name of ['file', 'title', 'category', 'summary', 'description', 'tags', 'licence', 'author_name', 'author_url', 'screenshots', 'notes', 'sample_input', 'expect']) {
      expect(html, name).toContain(`name="${name}"`)
      expect(html, name).toContain(`for="share-${name}"`)
      expect(html, name).toContain(`id="share-${name}"`)
    }
    expect(html).toContain('minLength="40" maxLength="200"')
    expect(html).toContain('minLength="100" maxLength="6000"')
    expect(html).toContain('aria-describedby="share-summary-hint"')
    expect(html).toContain('data-testid="share-submit"')
    expect(html).toContain('value="Ana"')
  })
})

describe('share form validation messages', () => {
  const valid: ShareValues = {
    file: { name: 'desk.utpkg' }, title: 'Visitor desk', category: 'workplace',
    summary: 'A reception form signs visitors in and emails their host.', description: 'x'.repeat(120), tags: 'visitors, reception',
    author_name: 'Ana', author_url: '', screenshots: 0, notes: '', sample_input: '',
  }

  it('accepts a valid form', () => {
    expect(validateShareForm(valid)).toEqual({})
  })

  it('says what is missing for an empty form, in form order', () => {
    const errors = validateShareForm({ ...valid, file: null, title: '', category: '', summary: '', description: '', tags: '', author_name: '' })
    expect(Object.keys(errors)).toEqual(['file', 'title', 'category', 'summary', 'description', 'tags', 'author_name'])
    expect(errors.file).toBe('Choose the .utpkg package file to upload.')
    expect(errors.title).toBe('Enter a title.')
    expect(errors.category).toBe('Choose the category it belongs in.')
  })

  it('gives lengths and formats in words', () => {
    expect(validateShareField('summary', { ...valid, summary: 'Too short' })).toBe('Summary needs at least 40 characters (9 so far).')
    expect(validateShareField('title', { ...valid, title: 'x'.repeat(81) })).toBe('Title can be at most 80 characters (81 now).')
    expect(validateShareField('file', { ...valid, file: { name: 'desk.zip' } })).toMatch(/is not a \.utpkg package/)
    expect(validateShareField('tags', { ...valid, tags: Array.from({ length: 9 }, (_, i) => `tag${i}`).join(',') })).toBe('Use at most 8 tags (9 now).')
    expect(validateShareField('tags', { ...valid, tags: 'ok, <b>' })).toMatch(/“<b>” is not a tag/)
    expect(validateShareField('author_url', { ...valid, author_url: 'javascript:alert(1)' })).toBe('Enter a full link starting with https://, or leave it empty.')
    expect(validateShareField('author_url', { ...valid, author_url: 'https://example.com/me' })).toBeNull()
    expect(validateShareField('sample_input', { ...valid, sample_input: '{oops' })).toMatch(/^Sample input must be a JSON object/)
    expect(validateShareField('sample_input', { ...valid, sample_input: '[1]' })).toMatch(/^Sample input must be a JSON object/)
    expect(validateShareField('sample_input', { ...valid, sample_input: '{"a": 1}' })).toBeNull()
    expect(validateShareField('screenshots', { ...valid, screenshots: 7 })).toBe('Choose at most 6 screenshots (7 chosen).')
  })

  it('uses the server limits', () => {
    expect(SHARE_LIMITS.screenshots).toBe(COMMUNITY_LIMITS.screenshots)
    expect(SHARE_LIMITS.packageMb * 1024 * 1024).toBe(COMMUNITY_LIMITS.packageBytes)
    expect(SHARE_LIMITS.screenshotMb * 1024 * 1024).toBe(COMMUNITY_LIMITS.screenshotBytes)
  })
})
