/**
 * Customer feedback (DanCo, Nov 2026), on /fill/<id>: "Edited form and
 * removed the workspace logo. Workspace logo still shows up."
 *
 * What draws a logo on a form page: the form header's image
 * (lib/forms/header.ts headerImageSrc) or the mini theme's header logo
 * (components/forms/form-theme-scope.tsx). Both honour "none". The logo
 * still showed because the page drew an old copy of the form:
 *  - the form page's query ('form-submittable') was cached for 60 s and
 *    persisted to sessionStorage for 5 min, never invalidated by the
 *    designer, so a publish made a moment ago wasn't drawn (even after a
 *    reload);
 *  - the designer saves a draft; the form's pages draw the published
 *    version, and nothing on /fill told the editor so.
 * Fix: the page reads the published form on every visit (cached copy paints
 * first), the designer invalidates it on save-live / publish, and /fill
 * tells editors when a saved draft isn't live yet.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HEADER_IMAGE, headerImageSrc, normalizeFormHeader } from '@/lib/forms/header'
import { submittableFormKey } from '@/lib/forms/form-query-keys'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const LOGO = 'storage://logos/00000000-0000-4000-8000-000000000001/logo.png'

describe('header image choice', () => {
  it('"None" draws no image, even with a workspace logo; the stored choice survives normalising', () => {
    const header = normalizeFormHeader({ enabled: true, image: 'none', title: 'Expense claim' })!
    expect(header.image).toBe('none')
    expect(headerImageSrc(header, LOGO)).toBeNull()
  })

  it('forms that never chose keep today’s default (the UserTasks mark); "Workspace logo" uses it', () => {
    expect(headerImageSrc(normalizeFormHeader({ enabled: true })!, LOGO)).toBe(DEFAULT_HEADER_IMAGE)
    expect(headerImageSrc(normalizeFormHeader({ enabled: true, image: 'workspace_logo' })!, LOGO)).toBe(LOGO)
  })
})

describe('the form page draws the latest published form', () => {
  it('re-reads it on every visit (no 60 s / sessionStorage stale copy)', () => {
    const src = read('components/forms/standalone-form.tsx')
    expect(src).toMatch(/queryKey: \[\.\.\.submittableFormKey\(formId\), urlQuery\]/)
    expect(src).toMatch(/staleTime: 0, refetchOnMount: 'always'/)
    expect(submittableFormKey('f1')).toEqual(['form-submittable', 'f1'])
  })

  it('the designer invalidates it after a live save and after publish / discard / restore', () => {
    const src = read('components/forms/designer/form-designer-page.tsx')
    const refreshLists = src.slice(src.indexOf('const refreshLists'), src.indexOf('const refresh = '))
    expect(refreshLists).toMatch(/invalidateQueries\(\{ queryKey: submittableFormKey\(form\.id\) \}\)/)
    expect(src).toMatch(/mode === 'live'[\s\S]{0,200}submittableFormKey\(form\.id\)/)
    expect(src).toMatch(/const reloadDesigner = async \(\) => \{\s*await Promise\.all\(\[refetch\(\), refetchDraft\(\), refreshLists\(\)\]\)/)
  })

  it('/fill tells editors when the form has a saved draft that isn’t live', () => {
    expect(read('app/(dashboard)/fill/[id]/page.tsx')).toMatch(/<UnpublishedDraftNotice formId=\{id\} \/>/)
    const notice = read('components/forms/unpublished-draft-notice.tsx')
    expect(notice).toMatch(/enabled: can\('forms\.edit'\)/)
    expect(notice).toMatch(/serverRead\('forms\.designDraft'/)
    expect(notice).toMatch(/meta: \{ persist: false \}/)
  })
})
