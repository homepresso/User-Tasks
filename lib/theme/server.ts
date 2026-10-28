import { cache } from 'react'
import { requireTenant } from '@/lib/actions/require-tenant'
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
    const { supabase, tenantId } = await requireTenant()
    return (await readWorkspaceTheme(supabase, tenantId)).theme
  } catch {
    return defaultWorkspaceTheme()
  }
})
