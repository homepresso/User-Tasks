'use server'

import { fromSession, isServiceError } from '@/lib/services/context'
import * as workspaceTheme from '@/lib/services/workspace-theme'
import type { ContrastIssue } from '@/lib/theme/contrast'
import type { FontRef, WorkspaceTheme } from '@/lib/theme/schema'

/*
 * Workspace theme server actions: thin wrappers over
 * lib/services/workspace-theme (reads for any member; writes need
 * settings.edit and are validated, audited and versioned there).
 */

export interface WorkspaceThemeSummary {
  theme: WorkspaceTheme
  version: number
  updatedAt: string | null
}

export interface ThemeDesignerData extends WorkspaceThemeSummary {
  tenantId: string
  /** Everyone the theme applies to. */
  memberCount: number
}

type ActionError = { error: string; conflict?: boolean }

function failure(error: unknown, fallback: string, label: string): ActionError {
  if (isServiceError(error)) return { error: error.message, ...(error.code === 'conflict' ? { conflict: true } : {}) }
  console.error(`[${label}]`, error)
  return { error: fallback }
}

export async function getWorkspaceThemeSummary(): Promise<WorkspaceThemeSummary | null> {
  try {
    const { theme, version, updatedAt } = await workspaceTheme.getWorkspaceTheme(await fromSession())
    return { theme, version, updatedAt }
  } catch {
    return null
  }
}

/** Everything the theme designer page needs (any member; editing is checked on save). */
export async function getThemeDesignerData(): Promise<ThemeDesignerData | null> {
  try {
    const ctx = await fromSession()
    const [{ theme, version, updatedAt }, memberCount] = await Promise.all([
      workspaceTheme.getWorkspaceTheme(ctx),
      workspaceTheme.countWorkspaceMembers(ctx).catch(() => 0),
    ])
    return { theme, version, updatedAt, tenantId: ctx.tenantId, memberCount }
  } catch {
    return null
  }
}

/** Replace the workspace theme with a built-in template (settings.edit). */
export async function applyWorkspaceThemePreset(presetId: string, expectedVersion?: number): Promise<{ ok: true; version: number } | ActionError> {
  try {
    const result = await workspaceTheme.applyWorkspaceThemePreset(await fromSession(), presetId, { expectedVersion })
    return { ok: true, version: result.version }
  } catch (error) {
    return failure(error, 'Could not change the workspace theme. Please try again.', 'applyWorkspaceThemePreset')
  }
}

/** Save the designer draft for the whole workspace (settings.edit, optimistic version check). */
export async function saveWorkspaceTheme(theme: WorkspaceTheme, expectedVersion: number): Promise<{ ok: true; version: number; theme: WorkspaceTheme; contrast: ContrastIssue[] } | ActionError> {
  try {
    const result = await workspaceTheme.updateWorkspaceTheme(await fromSession(), theme, { expectedVersion })
    return { ok: true, version: result.version, theme: result.theme, contrast: result.contrast }
  } catch (error) {
    return failure(error, 'Could not save the workspace theme. Please try again.', 'saveWorkspaceTheme')
  }
}

/** Upload a woff2 file (form field `file`, optional `family`); the theme itself is unchanged. */
export async function uploadWorkspaceThemeFont(form: FormData): Promise<{ ok: true; font: FontRef } | ActionError> {
  try {
    const file = form.get('file')
    if (!(file instanceof File)) return { error: 'Choose a .woff2 file' }
    const family = form.get('family')
    const result = await workspaceTheme.uploadWorkspaceThemeFont(await fromSession(), {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      family: typeof family === 'string' ? family : null,
    })
    return { ok: true, font: result.font }
  } catch (error) {
    return failure(error, 'Could not upload the font. Please try again.', 'uploadWorkspaceThemeFont')
  }
}
