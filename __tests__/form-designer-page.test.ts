/**
 * The form designer as a full page (/automations/forms/<id>) next to the
 * workflow builder's designer dialog: one shared FormDesigner in two frames,
 * the Forms library and every form link going to the page, old ?open= links
 * redirected, the unsaved-changes link guard, the page toolbar (Save version,
 * back, Open form, ⋯, extra tabs, status bar), read only without forms.edit,
 * the Agent's open item, and the route guards.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/automations/forms/f1', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/app/actions/forms', () => ({}))

import { FormDesigner, type DesignerAction } from '@/components/forms/designer/form-designer'
import { leaveTarget } from '@/hooks/use-leave-guard'
import { FORMS_LIBRARY_HREF, NEW_FORM_HREF, formDesignerHref, legacyFormsRedirect } from '@/lib/forms/designer-links'
import { canAccessPath } from '@/lib/route-permissions'
import { routeLabel } from '@/lib/page-title'
import { designerAreaForPath } from '@/components/assistants/assistant-host'
import { hrefFor } from '@/lib/assistants/tools/designer'
import { CREATE_ACTIONS } from '@/components/layout/create-actions'
import type { FormDefinition } from '@/lib/forms/definition'
import type { Permission } from '@/lib/permissions'

const ROOT = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

const FORM: FormDefinition = {
  fields: [
    { key: 'full_name', label: 'Full name', type: 'text', required: true },
    { key: 'amount', label: 'Amount', type: 'number' },
  ],
  layout: { rows: [{ columns: 2, cells: [{ field_key: 'full_name', span: 1 }, { field_key: 'amount', span: 1 }] }] },
  theme: { source: 'workspace' },
}

const save: DesignerAction = { id: 'save', label: 'Save version 4', hint: 'Saves version 4', run: async () => null }

function renderPage(over: Partial<Parameters<typeof FormDesigner>[0]> = {}) {
  const props: Parameters<typeof FormDesigner>[0] = {
    chrome: 'page',
    title: 'Expense claim',
    badge: 'v3',
    formId: 'f1',
    initial: FORM,
    actions: [save],
    savedThemes: [],
    canSaveTheme: true,
    onClose: () => {},
    page: {
      backHref: FORMS_LIBRARY_HREF,
      backLabel: 'Back to forms',
      openHref: '/f/f1',
      submissions: 12,
      pills: createElement('span', { 'data-pill': 'menu' }, 'In menu'),
      menu: () => createElement('span', null, 'menu'),
      extraTabs: [{ value: 'settings', label: 'Form', render: () => null }, { value: 'access', label: 'Access', render: () => null }],
    },
    ...over,
  }
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FormDesigner, props)))
}

describe('one designer, two frames', () => {
  const dialog = read('components/forms/designer/form-designer-dialog.tsx')
  const pageFile = read('components/forms/designer/form-designer-page.tsx')

  it('the dialog and the page both render the shared FormDesigner', () => {
    expect(dialog).toContain("import { FormDesigner, type FormDesignerDialogProps } from './form-designer'")
    expect(dialog).toContain('<FormDesigner {...props} chrome="dialog" />')
    // The dialog is a thin frame: no state or panels of its own.
    expect(dialog.split('\n').length).toBeLessThan(30)
    expect(pageFile).toContain("from './form-designer'")
    expect(pageFile).toMatch(/<FormDesigner[\s\S]*?chrome="page"/)
  })

  it('the workflow builder keeps the modal (a step form, a start form)', () => {
    for (const file of ['components/forms/node-form-section.tsx', 'components/forms/start-form-button.tsx']) {
      const text = read(file)
      expect(text, file).toMatch(/import \{ FormDesignerDialog[^}]*\} from '\.\/designer\/form-designer-dialog'/)
      expect(text, file).toContain('<FormDesignerDialog')
    }
  })

  it('the page frame: toolbar (back, name, version, pills, undo / redo, Design / Preview, Open form, Save, ⋯), palette + outline, status bar, extra tabs', () => {
    const html = renderPage()
    expect(html).toContain('data-designer-chrome="page"')
    expect(html).toContain('role="toolbar" aria-label="Form designer"')
    expect(html).toMatch(/href="\/automations\/forms"[^>]*aria-label="Back to forms"|aria-label="Back to forms"[^>]*href="\/automations\/forms"/)
    expect(html).toContain('Expense claim')
    expect(html).toContain('data-designer-version="">v3<')
    expect(html).toContain('data-pill="menu"')
    expect(html).toContain('aria-label="Undo"')
    expect(html).toContain('aria-label="Redo"')
    expect(html).toContain('Preview')
    expect(html).toMatch(/href="\/f\/f1"[^>]*target="_blank"/)
    expect(html).toContain('data-action="save"')
    expect(html).toContain('Save version 4')
    expect(html).toContain('aria-label="More form actions"')
    expect(html).toContain('data-designer-outline=""')
    expect(html).toContain('data-outline-field="full_name"')
    // Status bar: field, rule and submission counts, the accessibility score, the saved state.
    expect(html).toContain('data-designer-status=""')
    expect(html).toContain('2 fields')
    expect(html).toContain('0 rules')
    expect(html).toContain('12 submissions')
    expect(html).toMatch(/Accessibility \d+\/100/)
    expect(html).toContain('No changes')
    // Tabs: the designer's own, then the page's Form and Access.
    expect(html).toMatch(/>Field<[\s\S]*>Rules<[\s\S]*>Theme<[\s\S]*>Checks<[\s\S]*>Form<[\s\S]*>Access</)
    // No dialog chrome: no Close, no Cancel, no resize handles, no Agent column of its own (the shell docks it).
    expect(html).not.toContain('aria-label="Close"')
    expect(html).not.toContain('>Cancel<')
    expect(html).not.toContain('data-testid="dialog-agent-button"')
  })

  it('read only without forms.edit: View only, no Save', () => {
    const html = renderPage({ page: { backHref: FORMS_LIBRARY_HREF, backLabel: 'Back to forms', readOnly: true } })
    expect(html).toContain('data-designer-read-only=""')
    expect(html).toContain('View only')
    expect(html).not.toContain('data-action="save"')
    // The name is plain text (no rename button).
    expect(html).not.toContain('data-designer-name=""')
  })

  it('the name is renamed in place when the page allows it', () => {
    const html = renderPage({ page: { backHref: FORMS_LIBRARY_HREF, backLabel: 'Back to forms', onRename: async () => null } })
    expect(html).toContain('data-designer-name=""')
  })

  it('Save on the page keeps the designer open on the saved form (a new baseline), ⌘S saves', () => {
    const src = read('components/forms/designer/form-designer.tsx')
    expect(src).toMatch(/else if \(isPage\) \{\s*setSaved\(\{ key: formDefinitionKey\(definition\)/)
    expect(src).toContain("const dirty = formDefinitionKey(definition) !== baselineKey")
    expect(src).toContain("e.key.toLowerCase() !== 's'")
    // The library's versioning: each save of fields / layout / theme is the next version.
    expect(pageAction()).toMatch(/label: form \? `Save version \$\{form\.version \+ 1\}` : 'Create form'/)
    expect(pageAction()).toContain('await updateForm(form.id, content)')
    expect(pageAction()).toContain('router.replace(formDesignerHref(result.data.id))')
  })
})

const pageAction = () => read('components/forms/designer/form-designer-page.tsx')

describe('links go to the page', () => {
  it('formDesignerHref / the new-form page', () => {
    expect(formDesignerHref('abc')).toBe('/automations/forms/abc')
    expect(NEW_FORM_HREF).toBe('/automations/forms/new')
  })

  it('the Forms library opens the page (Edit / View, New form → blank) and no longer hosts the designer dialog', () => {
    const lib = read('components/forms/forms-library.tsx')
    expect(lib).not.toContain('FormDesignerDialog')
    expect(lib).toContain('<Link href={formDesignerHref(form.id)} data-testid="edit-form">')
    expect(lib).toContain('const newForm = () => router.push(NEW_FORM_HREF)')
  })

  it('old ?open= / ?new=1 links redirect to the page; the library keeps ?q, ?submissions, ?details', () => {
    expect(legacyFormsRedirect({ open: 'f1' })).toBe('/automations/forms/f1')
    expect(legacyFormsRedirect(new URLSearchParams('q=Loans&open=f2'))).toBe('/automations/forms/f2')
    expect(legacyFormsRedirect({ new: '1' })).toBe('/automations/forms/new')
    expect(legacyFormsRedirect({ q: 'x' })).toBeNull()
    expect(legacyFormsRedirect({ details: 'f1' })).toBeNull()
    expect(legacyFormsRedirect({ submissions: 'f1' })).toBeNull()
    expect(legacyFormsRedirect({ open: ['f3', 'f4'] })).toBe('/automations/forms/f3')
    expect(read('app/(dashboard)/automations/forms/page.tsx')).toContain('const to = legacyFormsRedirect(await searchParams)')
  })

  it("the Agent's changed-item links, search hits, ⌘K Create form and the wizard's designer link", () => {
    expect(hrefFor('form', 'f9')).toBe('/automations/forms/f9')
    expect(CREATE_ACTIONS.find((a) => a.id === 'form')?.href).toBe('/automations/forms/new')
    expect(read('lib/assistants/tools/build-plan.ts')).toContain('form: (id) => formDesignerHref(id)')
    expect(read('lib/services/search.ts')).toContain("href: can('forms.submit') ? `/fill/${f.id}` : formDesignerHref(f.id)")
    expect(read('lib/services/form-wizard.ts')).toContain('form_designer: formDesignerHref(manifest.form_id)')
  })
})

describe('the unsaved-changes guard on in-app links', () => {
  const here = 'http://localhost:3000/automations/forms/f1'
  it('holds an in-app link and returns where it goes', () => {
    expect(leaveTarget({ href: '/automations/forms' }, here)).toBe('/automations/forms')
    expect(leaveTarget({ href: '/tasks?tab=mine#top' }, here)).toBe('/tasks?tab=mine#top')
    expect(leaveTarget({ href: 'http://localhost:3000/home' }, here)).toBe('/home')
  })
  it('lets through new tabs, downloads, modified clicks, other origins, same-page links', () => {
    expect(leaveTarget({ href: '/f/f1', target: '_blank' }, here)).toBeNull()
    expect(leaveTarget({ href: '/export.json', download: true }, here)).toBeNull()
    expect(leaveTarget({ href: '/home', metaKey: true }, here)).toBeNull()
    expect(leaveTarget({ href: '/home', ctrlKey: true }, here)).toBeNull()
    expect(leaveTarget({ href: '/home', button: 1 }, here)).toBeNull()
    expect(leaveTarget({ href: 'https://example.com/' }, here)).toBeNull()
    expect(leaveTarget({ href: 'mailto:a@b.c' }, here)).toBeNull()
    expect(leaveTarget({ href: '#section' }, here)).toBeNull()
    expect(leaveTarget({ href: null }, here)).toBeNull()
  })
  it('the page guards only with unsaved changes and edit rights; the guard reuses the designer\'s Discard prompt', () => {
    const src = read('components/forms/designer/form-designer.tsx')
    expect(src).toContain('useLeaveGuard(isPage && dirty && !readOnly)')
    expect(src).toContain('{(confirmClose || leaveGuard.pending) && (')
    expect(src).toContain("if (confirmClose) onClose(); else leaveGuard.leave()")
    expect(src).toMatch(/if \(!dirty \|\| readOnly\) return\s*const onBeforeUnload/)
  })
})

describe('the Agent on the page', () => {
  it('the route names the form as the open item; the designer registers its name, draft and summary', () => {
    expect(designerAreaForPath('/automations/forms/0a000000-0000-4000-8000-000000000001')).toEqual({ area: 'form', item_id: '0a000000-0000-4000-8000-000000000001' })
    const src = read('components/forms/designer/form-designer.tsx')
    expect(src).toContain("useDesignerContext(formId ? { area: 'form', item_id: formId, item_name: title, dirty, summary: agentSummary } : null)")
    // The dialog hosts the Agent as a column (DialogAgentDock); the page leaves it to the shell's docked panel.
    expect(src).toMatch(/<DialogAgentDock \/>/)
    expect(src.indexOf('<DialogAgentDock />')).toBeGreaterThan(src.indexOf("return (\n    <Dialog.Root"))
  })
  it('a confirmed Agent change reloads the page designer on the new version', () => {
    const src = pageAction()
    expect(src).toContain("if (change.kind !== 'form' || !formId || change.id !== formId) return")
    expect(src).toContain('void refetch().then(() => setAgentRev((r) => r + 1))')
    expect(src).toContain('key={loadedKey}')
  })
})

describe('route guards and titles', () => {
  const view: Permission[] = ['forms.view']
  const edit: Permission[] = ['forms.view', 'forms.edit']
  const id = '0a000000-0000-4000-8000-000000000001'
  it('forms.view opens a form (read only); a new form needs forms.edit', () => {
    expect(canAccessPath(`/automations/forms/${id}`, view)).toBe(true)
    expect(canAccessPath('/automations/forms/new', view)).toBe(false)
    expect(canAccessPath('/automations/forms/new', edit)).toBe(true)
    expect(canAccessPath(`/automations/forms/${id}`, [])).toBe(false)
  })
  it('page titles', () => {
    expect(routeLabel(`/automations/forms/${id}`)).toBe('Form')
    expect(routeLabel('/automations/forms/new')).toBe('New form')
  })
})
