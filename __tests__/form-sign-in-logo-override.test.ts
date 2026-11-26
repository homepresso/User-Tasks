/**
 * The branded form sign-in page follows the form's own logo choice (owner
 * approved, Nov 2026, after DanCo's "removed the workspace logo" report):
 * a form whose header says "None" shows no logo on its /form-login page
 * (embeds included); an uploaded image or "Workspace logo" shows that; forms
 * that set nothing keep the workspace-wide setting (Settings → Sign-in page).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { formNameOfReturnPath, formSignInLogo, signInLogoFor } from '@/lib/forms/sign-in-logo'
import { formSignInDeps, formSignInLogoChoice } from '@/lib/services/form-sign-in-page'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const TENANT = '00000000-0000-4000-8000-000000000001'
const UPLOAD = `storage://task-files/form-headers/${TENANT}/header.png`
const WS_SETTING = `/files/logos/${TENANT}/form-sign-in.png`

describe('formSignInLogo (pure)', () => {
  it('maps the form header to the sign-in logo', () => {
    expect(formSignInLogo(null, 'ws.png')).toEqual({ kind: 'inherit' })
    expect(formSignInLogo({ enabled: false, image: 'none' }, 'ws.png')).toEqual({ kind: 'inherit' })
    expect(formSignInLogo({ enabled: true, image: 'default' }, 'ws.png')).toEqual({ kind: 'inherit' })
    expect(formSignInLogo({ enabled: true, image: 'none' }, 'ws.png')).toEqual({ kind: 'none' })
    expect(formSignInLogo({ enabled: true, image: 'upload', image_url: UPLOAD }, 'ws.png')).toEqual({ kind: 'image', url: UPLOAD })
    expect(formSignInLogo({ enabled: true, image: 'workspace_logo' }, 'ws.png')).toEqual({ kind: 'image', url: 'ws.png' })
    expect(formSignInLogo({ enabled: true, image: 'workspace_logo' }, null)).toEqual({ kind: 'inherit' })
    // An upload that isn't this app's header image is dropped by the header normaliser: inherit.
    expect(formSignInLogo({ enabled: true, image: 'upload', image_url: 'https://evil.example/x.png' }, null)).toEqual({ kind: 'inherit' })
  })

  it('the workspace setting stays the default; "none" hides every logo', () => {
    expect(signInLogoFor({ kind: 'inherit' }, WS_SETTING)).toEqual({ logo: WS_SETTING, noLogo: false })
    expect(signInLogoFor({ kind: 'inherit' }, null)).toEqual({ logo: null, noLogo: false })
    expect(signInLogoFor({ kind: 'none' }, WS_SETTING)).toEqual({ logo: null, noLogo: true })
    expect(signInLogoFor({ kind: 'image', url: UPLOAD }, WS_SETTING)).toEqual({ logo: UPLOAD, noLogo: false })
  })

  it('reads friendly /form/<name> links', () => {
    expect(formNameOfReturnPath('/form/expense-claim?x=1')).toBe('expense-claim')
    expect(formNameOfReturnPath('/f/abc')).toBeNull()
    expect(formNameOfReturnPath(null)).toBeNull()
  })
})

describe('formSignInLogoChoice (service)', () => {
  const original = formSignInDeps.serviceClient
  afterEach(() => { formSignInDeps.serviceClient = original })
  const fake = (row: unknown, seen: Array<[string, unknown]>) => {
    formSignInDeps.serviceClient = async () => ({
      from: (table: string) => {
        const q: Record<string, unknown> = {}
        q.select = () => q
        q.eq = (col: string, v: unknown) => { seen.push([`${table}.${col}`, v]); return q }
        q.maybeSingle = async () => ({ data: row, error: null })
        return q
      },
    }) as never
  }

  it('looks the form up in this workspace by id or by system name', async () => {
    const seen: Array<[string, unknown]> = []
    fake({ header: { enabled: true, image: 'none' } }, seen)
    expect(await formSignInLogoChoice(TENANT, { formId: 'f1' })).toEqual({ kind: 'none' })
    expect(seen).toEqual([['forms.tenant_id', TENANT], ['forms.id', 'f1']])
    seen.length = 0
    expect(await formSignInLogoChoice(TENANT, { formName: 'expense-claim' })).toEqual({ kind: 'none' })
    expect(seen).toEqual([['forms.tenant_id', TENANT], ['forms.system_name', 'expense-claim']])
  })

  it('inherits without a workspace, a form or on errors', async () => {
    const seen: Array<[string, unknown]> = []
    fake(null, seen)
    expect(await formSignInLogoChoice(null, { formId: 'f1' })).toEqual({ kind: 'inherit' })
    expect(await formSignInLogoChoice(TENANT, {})).toEqual({ kind: 'inherit' })
    expect(await formSignInLogoChoice(TENANT, { formId: 'missing' })).toEqual({ kind: 'inherit' })
    formSignInDeps.serviceClient = async () => { throw new Error('down') }
    expect(await formSignInLogoChoice(TENANT, { formId: 'f1' })).toEqual({ kind: 'inherit' })
  })
})

describe('the sign-in route and screen', () => {
  it('form links use the form’s choice; apps keep the workspace setting', () => {
    const route = read('components/forms/sign-in/sign-in-route.tsx')
    expect(route).toMatch(/kind === 'app' \? Promise\.resolve\(\{ kind: 'inherit' \} as const\) : svc\.formSignInLogoChoice\(tenantId, \{ formId, formName \}\)/)
    expect(route).toMatch(/const logo = signInLogoFor\(logoChoice, settings\.logo_url\)/)
    expect(route).toMatch(/noLogo=\{logo\.noLogo\}/)
  })

  it('"no logo" never falls back to the UserTasks logo', () => {
    expect(read('components/forms/sign-in/form-sign-in-layout.tsx')).toMatch(/\{logoUrl \|\| noLogo \? brand\('md'\) : <UserTasksBrand \/>\}/)
    expect(read('components/forms/sign-in/form-sign-in-screen.tsx')).toMatch(/noLogo=\{props\.noLogo\}/)
  })
})
