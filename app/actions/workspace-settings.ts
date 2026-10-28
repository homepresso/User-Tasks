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
