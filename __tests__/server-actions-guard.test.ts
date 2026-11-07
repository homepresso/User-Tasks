/**
 * Every exported server action (app/actions/*.ts, 'use server') checks a
 * permission — directly (requirePermission / getUserPermissions / a local
 * requireAny…) or by building a ServiceContext (fromSession…) for a
 * lib/services function that checks it (requirePerm) — or is deliberately
 * open, with the reason below (governance audit 2026-11). A static scan: a new
 * action that does neither fails this test until it is guarded or justified.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ACTIONS = path.resolve(__dirname, '../app/actions')

/** Direct checks, the context a service checks against, and the instance-admin gates. */
const GUARD = new RegExp([
  String.raw`\brequirePermission\(`, String.raw`\bgetUserPermissions\(`, String.raw`\brequireAnyPermission\(`,
  String.raw`\bfromSession(ForTask)?\(`, String.raw`\bsessionCtx\(`, String.raw`\bserviceCtx\(`, String.raw`\bsessionContext\(`,
  String.raw`\bviewerCanSeeInfrastructure\(`, String.raw`\(await viewer\(\)`, String.raw`\brequireModerator\(`, String.raw`\bguard\(`, String.raw`\bdeps\.canView\(`,
].join('|'))

/** Exported async functions with their source text, following calls to same-file helpers one level deep. */
function exportedActions(file: string): Array<{ name: string; text: string }> {
  const source = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const local = new Map<string, string>()
  const exported: Array<{ name: string; text: string }> = []
  const isExported = (n: ts.Node) => (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export) !== 0
  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      local.set(node.name.text, node.getText(sf))
      if (isExported(node)) exported.push({ name: node.name.text, text: node.getText(sf) })
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        local.set(d.name.text, d.initializer.getText(sf))
        if (isExported(node) && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) exported.push({ name: d.name.text, text: d.initializer.getText(sf) })
      }
    }
  })
  return exported.map(({ name, text }) => {
    const helpers = [...local.entries()].filter(([n]) => n !== name && new RegExp(String.raw`\b${n}\(`).test(text)).map(([, t]) => t)
    return { name, text: [text, ...helpers].join('\n') }
  })
}

/** Deliberately open actions (no permission check), with the reason. */
const OPEN_ACTIONS: Record<string, string> = {
  'auth.getLoginOptions': 'Sign-in page options (pre-auth)',
  'auth.signInAction': 'Sign in (pre-auth)',
  'auth.passwordSignInAction': 'Sign in (pre-auth)',
  'auth.startSsoAction': 'SSO redirect (pre-auth)',
  'auth.signOutAction': 'Ends the caller\'s own session',
  'auth.requestPasswordResetAction': 'Pre-auth, rate limited',
  'auth.resetPasswordAction': 'Pre-auth with the reset token',
  'auth.getRealtimeTokenAction': "The caller's own realtime token (RLS bounds what it can read and write)",
  'auth.verifyEmailAction': 'Pre-auth with the verification token',
  'beta-signup.betaSignup': 'Public cloud signup, rate limited',
  'forms.checkFormLink': 'Whether a form link exists (no form data)',
  'gallery-moderation.canModerateGalleryAction': 'A capability probe (yes / no)',
  'gallery-moderation.withdrawSubmissionAction': "The caller's own gallery submission (filtered by submitter_id)",
  'oauth-consent.getConsentRequest': 'A consent request bound to the signed-in user',
  'oauth-consent.approveOAuthConsent': 'A consent request bound to the signed-in user; the token is capped by their live permissions',
  'oauth-consent.denyOAuthConsent': 'A consent request bound to the signed-in user',
  'profile.updateUserProfile': "The caller's own profile",
  'profile.updateUserPreferences': "The caller's own preferences",
  'profile.saveMyQueueRules': "The caller's own queue rules (users.preferences.queue_rules, own row only)",
  'reports.toggleFavorite': "Pins the caller's own report (created_by)",
  'session.getMySession': "The caller's own profile and permissions",
  'session.getMyCurrentTenantId': "The caller's own current workspace",
  'session.getMyAccess': "The caller's own role and permissions",
  'session.switchWorkspace': 'switch_tenant validates membership',
}

describe('server actions', () => {
  const files = readdirSync(ACTIONS).filter((f) => f.endsWith('.ts'))
  const actions = files.flatMap((f) => exportedActions(path.join(ACTIONS, f)).map((a) => ({ ...a, id: `${f.replace(/\.ts$/, '')}.${a.name}` })))

  it('finds the actions', () => {
    expect(actions.length).toBeGreaterThan(300)
  })

  it('every action checks a permission or is deliberately open', () => {
    const unguarded = actions.filter((a) => !GUARD.test(a.text)).map((a) => a.id).sort()
    expect(unguarded.filter((id) => !OPEN_ACTIONS[id])).toEqual([])
  })

  it('the open list has no stale or guarded entries', () => {
    const byId = new Map(actions.map((a) => [a.id, a]))
    for (const id of Object.keys(OPEN_ACTIONS)) {
      expect(byId.has(id), `${id} is not an exported action`).toBe(true)
      expect(GUARD.test(byId.get(id)!.text), `${id} is guarded — drop it from the open list`).toBe(false)
      expect(OPEN_ACTIONS[id].length).toBeGreaterThan(10)
    }
  })

  it('no exported action takes the workspace, inviter or role from its caller to invite people', () => {
    expect(actions.find((a) => a.id === 'invitations.inviteByEmail')).toBeUndefined()
  })

  it('GitHub sync changes need sync.manage / sync.deploy (as the REST API), not settings.edit', () => {
    const sync = actions.filter((a) => a.id.startsWith('github-sync.') && /requirePermission\('/.test(a.text))
    expect(sync.filter((a) => /requirePermission\('settings\.edit'\)/.test(a.text)).map((a) => a.id)).toEqual([])
  })
})
