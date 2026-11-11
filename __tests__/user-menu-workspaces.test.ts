/**
 * Each person works in one workspace, so the avatar menu shows the current
 * workspace's name but no workspace list; and the cleanup migration only
 * soft-deletes empty personal workspaces.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('avatar menu', () => {
  it('has no workspace switcher, only the current workspace name', () => {
    const src = read('components/layout/user-menu.tsx')
    expect(src).not.toContain('WorkspaceMenuItems')
    expect(src).toContain('data-current-workspace')
  })
})

describe('stray personal workspace cleanup migration', () => {
  const sql = read('supabase/migrations/20270108000000_remove_stray_personal_workspaces.sql')
  it('soft-deletes (never deletes rows)', () => {
    expect(sql).not.toMatch(/delete\s+from/i)
    expect(sql).toMatch(/set deleted_at = now\(\)/)
  })
  it('only touches empty personal workspaces with no members or content', () => {
    expect(sql).toContain("t.slug like 'personal-%'")
    for (const table of ['user_memberships', 'user_roles', 'users', 'invitations', 'forms', 'workflows', 'tasks', 'form_submissions', 'custom_tables', 'reports', 'api_keys']) {
      expect(sql).toMatch(new RegExp(`not exists \\(select 1 from public\\.${table} `))
    }
  })
})
