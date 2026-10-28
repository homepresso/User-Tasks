import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext, ServiceError } from '@/lib/services/context'
import * as workspaceTheme from '@/lib/services/workspace-theme'
import { messageOf } from './_util'

/*
 * Workspace theme tools: thin wrappers over lib/services/workspace-theme.
 * Reads are open to any member (mapped to tasks.view_own, which every role
 * holds); writes need settings.edit and are validated, contrast-checked,
 * versioned and audited in the service. Changes apply to every member of the
 * workspace immediately.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const THEME_HELP = 'The whole theme as returned by workspace_theme_get (`workspace_theme`): { meta: { name, basePreset?, mode: auto|light|dark, schemaVersion: 1 }, colors: { light, dark } (primary, accent, sidebar, topbar, surface, card, text, status, chart … as hex/rgb()/hsl()), typography: { sans, display, mono: { source: google|system|upload, family, url? }, weights, baseSize, headingFont, headingLetterSpacing, uppercaseLabels }, shape, shadows, layout, chrome, branding }'
const expectedVersion = z.number().int().optional().describe('Refuse when the stored version differs (optimistic concurrency); omit to overwrite')

export function registerWorkspaceThemeTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('workspace_theme_get', 'Get the workspace theme every member sees (colours for light and dark, fonts, shape, density, sidebar/topbar style, logos), its version and any WCAG contrast warnings.', {},
    async () => run(async () => workspaceTheme.presentWorkspaceTheme(await workspaceTheme.getWorkspaceTheme(svc()))))

  server.tool('workspace_theme_presets_list', 'List the built-in theme templates (id, name, description, category and a few colours per mode). Apply one with workspace_theme_apply_preset.', {},
    async () => run(async () => workspaceTheme.listWorkspaceThemePresets()))

  server.tool('workspace_theme_update', 'Replace the workspace theme. Applies to every member immediately. Send the whole theme (edit the workspace_theme_get result). Themes with button or navigation text below 3:1 contrast are refused; fonts must be curated Google Fonts, system stacks or uploads (workspace_theme_font_upload).', {
    theme: z.record(z.string(), z.any()).describe(THEME_HELP),
    expected_version: expectedVersion,
  }, async (args) => run(async () => workspaceTheme.presentWorkspaceTheme(
    await workspaceTheme.updateWorkspaceTheme(svc(), args.theme, { expectedVersion: args.expected_version }),
  )))

  server.tool('workspace_theme_apply_preset', 'Replace the workspace theme with a built-in template (see workspace_theme_presets_list). Applies to every member immediately; logos and uploaded fonts are not kept.', {
    preset_id: z.string().describe('Template id, e.g. basecamp, night-drive, lagoon'),
    expected_version: expectedVersion,
  }, async (args) => run(async () => workspaceTheme.presentWorkspaceTheme(
    await workspaceTheme.applyWorkspaceThemePreset(svc(), args.preset_id, { expectedVersion: args.expected_version }),
  )))

  server.tool('workspace_theme_font_upload', 'Upload a woff2 font (base64, at most 1 MB) to the workspace brand-fonts folder. Returns the font reference to put in typography.sans / display / mono with workspace_theme_update; the theme itself is not changed.', {
    file_name: z.string().describe('File name ending in .woff2'),
    content_base64: z.string().describe('The woff2 file, base64-encoded'),
    family: z.string().optional().describe('CSS family name (letters, digits, spaces, hyphens); derived from the file name when omitted'),
  }, async (args) => run(async () => {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(args.content_base64)) throw ServiceError.validation('content_base64 is not valid base64')
    const bytes = new Uint8Array(Buffer.from(args.content_base64, 'base64'))
    return workspaceTheme.uploadWorkspaceThemeFont(svc(), { fileName: args.file_name, bytes, family: args.family })
  }))
}
