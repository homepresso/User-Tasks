/**
 * The website's InfoPath copy keeps up with the importer: limitations that
 * have since been addressed (nested repeating tables, conditional formatting,
 * pictures, signatures and ink, roles, choice sections, the newer XPath
 * functions, rich text) must not be listed as "not converted" anywhere, and
 * the limitations that remain stay specific.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SEO_PAGES } from '@/lib/seo-pages'
import { INFOPATH_PAGE } from '@/lib/marketing-pages'
import { INFOPATH_IMPORT_PAGE } from '@/lib/docs/content/infopath-import'
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/seo/llms'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/infopath' }))

const BASE = 'https://usertasks.com'
/** Phrases the site used before these mappings shipped. */
const OLD_PHRASES = [
  /InfoPath user roles, conditional colou?rs/i,
  /ink and signature controls/i,
  /nested repeating tables?\W{0,3}(?:are|is)?\s*(?:not|n.t) (?:converted|supported)/i,
  /Not converted:[^'"\]\n.]*\b(?:user roles|conditional|ink|signature controls|nested repeating|rich text|choice section|picture)/i,
  /a few rare XPath functions/i,
  /Repeating table or section', 'A List field/,
  /(?:conditional formatting|pictures?|signatures?|rich text|choice sections?|repeating sections?|get-Role|substring-before|translate\(\)|normalize-space)[^.;:]{0,40}(?:don.t|doesn.t|do not|does not|aren.t|isn.t|are not|is not) (?:convert|converted|supported|carried)/i,
]
/** Things the importer still can't do: they belong in "what still needs a person". */
const LIMITS = [/data connection/i, /form code/i, /certificate/i, /position\(\)/, /GetDOM/, /Person fields/i]

async function infopathPageHtml() {
  const { InfoPathPage } = await import('@/components/marketing/infopath-page')
  return renderToStaticMarkup(InfoPathPage())
}

describe('InfoPath copy on the website', () => {
  it('lists no addressed limitation as unconverted', async () => {
    const guide = SEO_PAGES.find((p) => p.slug === 'infopath-migration-guide')!
    const sharepoint = SEO_PAGES.find((p) => p.slug === 'sharepoint-workflow-migration')!
    const sources: Record<string, string> = {
      '/infopath': await infopathPageHtml(),
      '/infopath meta': INFOPATH_PAGE.description,
      '/infopath-migration-guide': JSON.stringify(guide),
      '/sharepoint-workflow-migration': JSON.stringify(sharepoint),
      '/docs/tasks/import-infopath': INFOPATH_IMPORT_PAGE.body,
      '/llms.txt': buildLlmsTxt(BASE),
      '/llms-full.txt': buildLlmsFullTxt(BASE),
    }
    for (const [where, text] of Object.entries(sources)) for (const re of OLD_PHRASES) expect(text, `${where}: ${re}`).not.toMatch(re)
  })

  it('keeps the remaining limitations specific on /infopath and in the docs', async () => {
    const html = await infopathPageHtml()
    const needsPerson = html.slice(html.indexOf('What still needs a person'), html.indexOf('Each one is in the report'))
    for (const re of LIMITS) expect(needsPerson, String(re)).toMatch(re)
    for (const re of LIMITS) expect(INFOPATH_IMPORT_PAGE.body, String(re)).toMatch(re)
  })

  it('names the new mappings in the "what maps" tables', async () => {
    const html = await infopathPageHtml()
    for (const t of ['Repeating sections', 'nested Lists', 'Image fields', 'electronic signature', 'Choice groups', 'strikethrough', 'workspace roles', 'SUMIF', 'xdMath:Eval']) expect(html, t).toContain(t)
    const guide = JSON.stringify(SEO_PAGES.find((p) => p.slug === 'infopath-migration-guide'))
    for (const t of ['nested List', 'Repeating section', 'electronic signature', 'conditional formatting', 'role conditions']) expect(guide, t).toContain(t)
  })
})
