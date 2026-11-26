/**
 * Customer idea (DanCo, Nov 2026): "Organization → Import from Entra / AD /
 * Google etc." Directory sync (Entra ID, Okta, Google Workspace, LDAP / AD,
 * SCIM) exists under Settings → SSO & directory; Organization only offered a
 * CSV import that never creates people. Organization now links to it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('Organization → Import people', () => {
  it('the Organization page has an Import people button for org managers', () => {
    const page = read('components/org/org-page.tsx')
    expect(page).toMatch(/can\('org\.manage'\) && <Button[^\n]*href="\/org\/manage\?tab=import"[^\n]*>Import people</)
  })

  it('the Import people wizard offers the directory connections, or points at Settings → SSO & directory when none is connected', () => {
    const wizard = read('components/org/import-people-wizard.tsx')
    expect(wizard).toMatch(/listPeopleImportSources\(\)/)
    expect(wizard).toMatch(/href="\/settings\/sso"/)
    expect(wizard).toMatch(/Entra ID, Okta, Google Workspace or LDAP \/ Active Directory/)
  })
})
