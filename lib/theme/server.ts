import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { loadSessionWorkspace } from '@/lib/session-workspace'
import { readWorkspaceTheme } from '@/lib/services/workspace-theme'
import { defaultWorkspaceTheme } from './presets'
import type { WorkspaceTheme } from './schema'

/**
 * The signed-in user's current workspace theme for server rendering (the
 * dashboard layout). Read with the session client under RLS. Signed out, no
 * workspace, or any read failure → the platform default, so a theme problem
 * can never take the app shell down. Cached per request.
 */
export const loadSessionWorkspaceTheme = cache(async (): Promise<WorkspaceTheme> => {
  try {
    const workspace = await loadSessionWorkspace()
    const tenantId = workspace?.current ?? workspace?.home
    if (!tenantId) return defaultWorkspaceTheme()
    return (await readWorkspaceTheme(await createClient(), tenantId)).theme
  } catch {
    return defaultWorkspaceTheme()
  }
})
