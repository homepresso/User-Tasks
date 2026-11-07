'use server'

import { fromSession, isServiceError } from '@/lib/services/context'
import * as tenantSettings from '@/lib/services/tenant-settings'

/*
 * Workspace branding server actions: thin wrappers over
 * lib/services/tenant-settings (settings.edit, merge into `branding`, audit).
 * Members can no longer write the tenants row from the browser.
 */

export async function setWorkspaceLogo(logoUrl: string | null): Promise<{ ok: true } | { error: string }> {
  try {
    await tenantSettings.setWorkspaceLogo(await fromSession(), logoUrl)
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    console.error('[setWorkspaceLogo]', error)
    return { error: 'Could not save the logo. Please try again.' }
  }
  return { ok: true }
}

/** Settings → Forms: the pre-publish accessibility check (settings.edit). */
export async function setFormAccessibilitySettings(input: { mode?: string; min_score?: number }): Promise<{ ok: true; settings: import('@/lib/forms/accessibility/settings').FormAccessibilitySettings } | { error: string }> {
  try {
    const { setFormAccessibilitySettings: save } = await import('@/lib/services/form-accessibility')
    return { ok: true, settings: await save(await fromSession(), input) }
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    console.error('[setFormAccessibilitySettings]', error)
    return { error: 'Could not save the setting. Please try again.' }
  }
}

/** Settings → Workspace → Task completion: the Task completed screen's defaults (settings.edit; audited). */
export async function setTaskCompletionSettings(input: Partial<import('@/lib/tasks/completion-screen').TaskCompletionSettings>): Promise<{ ok: true; settings: import('@/lib/tasks/completion-screen').TaskCompletionSettings } | { error: string }> {
  try {
    const { setTaskCompletionSettings: save } = await import('@/lib/services/task-completion-screen')
    return { ok: true, settings: await save(await fromSession(), input) }
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    console.error('[setTaskCompletionSettings]', error)
    return { error: 'Could not save the setting. Please try again.' }
  }
}

/** Settings → Workspace: change (or, with null, remove) the workspace address (settings.edit; audited). */
export async function setWorkspaceSubdomain(subdomain: string | null): Promise<{ ok: true; address: import('@/lib/services/workspace-address').WorkspaceAddress } | { error: string }> {
  try {
    const { setWorkspaceSubdomain: save } = await import('@/lib/services/workspace-address')
    return { ok: true, address: await save(await fromSession(), subdomain) }
  } catch (error) {
    if (isServiceError(error)) return { error: error.message }
    console.error('[setWorkspaceSubdomain]', error)
    return { error: 'Could not save the address. Please try again.' }
  }
}
