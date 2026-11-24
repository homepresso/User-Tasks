import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as signIn from '@/lib/services/form-sign-in-page'
import { SIGN_IN_DESIGNS, SIGN_IN_LIMITS } from '@/lib/forms/sign-in-page'
import { messageOf } from './_util'

/*
 * The workspace sign-in page for forms and apps (what visitors see when a form link or an app needs sign-in):
 * read by any member, changed with settings.edit (audited in the service).
 * Thin wrappers over lib/services/form-sign-in-page.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const DESIGNS = SIGN_IN_DESIGNS.map((d) => `${d.id} ${d.name}`).join(', ')

const updateShape = {
  design: z.number().int().min(1).max(10).optional().describe(`1–10: ${DESIGNS}`),
  logo_url: z.string().max(500).optional().describe('An uploaded logo in this workspace\'s logos; "" removes it'),
  heading: z.string().max(SIGN_IN_LIMITS.heading).optional(),
  subheading: z.string().max(SIGN_IN_LIMITS.subheading).optional().describe('Welcome message'),
  button_label: z.string().max(SIGN_IN_LIMITS.button_label).optional(),
  footer_text: z.string().max(SIGN_IN_LIMITS.footer_text).optional(),
  support_link_label: z.string().max(SIGN_IN_LIMITS.support_link_label).optional(),
  support_link_url: z.string().max(SIGN_IN_LIMITS.support_link_url).optional().describe('https:// or mailto:; "" removes it'),
  accent_color: z.string().max(7).optional().describe('#rrggbb; "" is the UserTasks default (ink). Ignored while use_workspace_theme is on'),
  use_workspace_theme: z.boolean().optional().describe('true: the workspace theme (colours, fonts, light/dark mode) instead of the UserTasks look and accent colour'),
  use_for_forms: z.boolean().optional().describe('Form links use this page (default true); false: the standard UserTasks sign-in'),
  use_for_apps: z.boolean().optional().describe('Apps use this page (default true); false: the standard sign-in. An app can override it (apps_update sign_in_page)'),
  use_app_color: z.boolean().optional().describe('An app\'s sign-in page takes the app\'s colour as its accent (default false)'),
}

export function registerFormSignInTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)
  const get = async () => run(async () => ({ settings: await signIn.getSignInPageSettings(svc()) }))
  const update = async (args: Record<string, unknown>) => run(async () => ({ settings: await signIn.setSignInPageSettings(svc(), args) }))

  server.tool('sign_in_page_get', `Get the workspace sign-in page for forms and apps: the page visitors see when a form link (/f/<id>, /form/<system name>) or an app (/app/<slug>, /apps/<slug>) needs them to sign in. Design (1–10: ${DESIGNS}), logo, heading, welcome message, button label, footer text, support link, accent colour, use_workspace_theme, and use_for_forms / use_for_apps (off: the standard UserTasks sign-in).`, {}, get)

  server.tool('sign_in_page_update', 'Change the workspace sign-in page for forms and apps (settings.edit). Send only what changes; an empty string clears logo_url, support_link_url and accent_color. The logo must already be uploaded in Settings → Sign-in page. Audited.', updateShape, update)

  // The earlier names (same settings).
  server.tool('form_sign_in_page_get', 'Earlier name of sign_in_page_get: the workspace sign-in page for form links and apps.', {}, get)
  server.tool('form_sign_in_page_update', 'Earlier name of sign_in_page_update: change the workspace sign-in page for form links and apps (settings.edit). Audited.', updateShape, update)
}
