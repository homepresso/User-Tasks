import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as signIn from '@/lib/services/form-sign-in-page'
import { SIGN_IN_DESIGNS, SIGN_IN_LIMITS } from '@/lib/forms/sign-in-page'
import { messageOf } from './_util'

/*
 * The form sign-in page (what visitors see when a form link needs sign-in):
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

export function registerFormSignInTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('form_sign_in_page_get', `Get the workspace's form sign-in page: the page visitors see when a form link (/f/<id>, /form/<system name>) needs them to sign in. Design (1–10: ${DESIGNS}), logo, heading, welcome message, button label, footer text, support link, accent colour and use_workspace_theme (the workspace theme instead of the UserTasks look).`, {},
    async () => run(async () => ({ settings: await signIn.getFormSignInSettings(svc()) })))

  server.tool('form_sign_in_page_update', 'Change the form sign-in page (settings.edit). Send only what changes; an empty string clears logo_url, support_link_url and accent_color. The logo must already be uploaded in Settings → Forms. Audited.', {
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
  }, async (args) => run(async () => ({ settings: await signIn.setFormSignInSettings(svc(), args) })))
}
