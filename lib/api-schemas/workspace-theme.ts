import { z } from 'zod'
import { defineEndpoint } from './registry'
import { listResponse } from './common'
import { WorkspaceThemeSchema } from '@/lib/theme/schema'

/**
 * The workspace theme: one brand theme (colours for light and dark,
 * typography, shape, density, sidebar/topbar chrome, logos) every member of
 * the workspace sees. Reads are open to any member; writes need settings.edit.
 */

const expectedVersion = z.number().int().min(0).optional()
  .describe('Optimistic check: refuse with 409 unless the stored version still equals this (0 = never saved)')

export const workspaceThemeUpdateBody = WorkspaceThemeSchema.extend({ expected_version: expectedVersion })

export const workspaceThemeApplyPresetBody = z.object({
  preset_id: z.string().regex(/^[a-z0-9-]{1,40}$/).describe('Template id from GET /workspace-theme/presets'),
  expected_version: expectedVersion,
})

export const workspaceThemeFontBody = z.object({
  file_name: z.string().trim().min(1).max(200).describe('Original file name; must end in .woff2'),
  content_base64: z.string().min(1).max(1_500_000).describe('The woff2 file, base64-encoded (at most 1 MB decoded)'),
  family: z.string().trim().max(64).optional().describe('CSS family name to register (letters, digits, spaces, hyphens); derived from the file name when omitted'),
})

const contrastIssue = z.looseObject({
  mode: z.enum(['light', 'dark']),
  pair: z.string(),
  foreground: z.string(),
  background: z.string(),
  ratio: z.number(),
  required: z.number(),
  level: z.enum(['warn', 'block']),
})

const themeResponse = z.looseObject({
  workspace_theme: z.looseObject({}).describe('The theme (meta, colors.light/dark, typography, shape, shadows, layout, chrome, branding)'),
  version: z.number().int().describe('Increments on every save; 0 = the platform default (never saved)'),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
  contrast: z.array(contrastIssue).describe('WCAG contrast warnings for the theme (pairs below 3:1 for buttons and navigation are refused on save)'),
})

const swatch = z.looseObject({ primary: z.string(), accent: z.string(), sidebar: z.string(), topbar: z.string(), surface: z.string(), card: z.string() })
const preset = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  swatches: z.looseObject({ light: swatch, dark: swatch }),
})

const tags = ['Workspace theme']
const SAVE_NOTE = 'Applies to every member of the workspace immediately. Colours must be hex/rgb()/hsl(); fonts are curated Google Fonts, system stacks or woff2 uploads (POST /workspace-theme/fonts); logos must be uploads in this workspace. Themes whose button or navigation text is below 3:1 contrast are refused.'

export const getWorkspaceThemeEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace-theme', operationId: 'getWorkspaceTheme', tags,
  summary: 'Get the workspace theme (any member)', permission: null,
  response: themeResponse,
  cli: { resource: 'workspace-theme', verb: 'get' },
})

export const updateWorkspaceThemeEndpoint = defineEndpoint({
  method: 'PUT', path: '/workspace-theme', operationId: 'updateWorkspaceTheme', tags,
  summary: 'Replace the workspace theme', description: `Send the whole theme. ${SAVE_NOTE}`,
  permission: 'settings.edit',
  body: workspaceThemeUpdateBody, response: themeResponse,
  roundTrip: { unwrap: 'workspace_theme' },
  cli: { resource: 'workspace-theme', verb: 'update' },
})

export const applyWorkspaceThemePresetEndpoint = defineEndpoint({
  method: 'POST', path: '/workspace-theme/apply-preset', operationId: 'applyWorkspaceThemePreset', tags,
  summary: 'Replace the workspace theme with a built-in template', description: 'Applies to every member immediately (logos and uploaded fonts are not kept).',
  permission: 'settings.edit',
  body: workspaceThemeApplyPresetBody, response: themeResponse,
  cli: { resource: 'workspace-theme', verb: 'apply-preset', positional: ['preset_id'] },
})

export const listWorkspaceThemePresetsEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace-theme/presets', operationId: 'listWorkspaceThemePresets', tags,
  summary: 'List the built-in theme templates', permission: null,
  response: listResponse('presets', preset), listKey: 'presets',
  cli: { resource: 'workspace-theme', verb: 'presets' },
})

export const uploadWorkspaceThemeFontEndpoint = defineEndpoint({
  method: 'POST', path: '/workspace-theme/fonts', operationId: 'uploadWorkspaceThemeFont', tags,
  summary: 'Upload a woff2 font for the workspace theme',
  description: 'Send multipart/form-data (`file`, optional `family`) or this JSON body. woff2 only, at most 1 MB. Returns the font reference to use in typography.sans / display / mono; the theme itself is not changed.',
  permission: 'settings.edit',
  body: workspaceThemeFontBody, successStatus: 201,
  multipart: { files: { file: { name: 'file_name', content: 'content_base64' } } },
  response: z.looseObject({
    font: z.looseObject({ source: z.literal('upload'), family: z.string(), url: z.string() }),
    path: z.string().describe('File name in the workspace brand-fonts folder (used by config-as-code)'),
    size: z.number().int(),
  }),
  cli: { resource: 'workspace-theme', verb: 'upload-font' },
})

export const workspaceThemeEndpoints = [
  getWorkspaceThemeEndpoint, updateWorkspaceThemeEndpoint, applyWorkspaceThemePresetEndpoint,
  listWorkspaceThemePresetsEndpoint, uploadWorkspaceThemeFontEndpoint,
]
