import { z } from 'zod'
import { defineEndpoint } from './registry'
import { SIGN_IN_DESIGNS, SIGN_IN_LIMITS } from '@/lib/forms/sign-in-page'

/**
 * The form sign-in page (lib/forms/sign-in-page.ts): what visitors see at
 * /form-login when a form link (/f/<id>, /form/<system name>) needs them to
 * sign in. Stored in tenants.settings.forms.sign_in.
 */

const DESIGNS = SIGN_IN_DESIGNS.map((d) => `${d.id} ${d.name}`).join(', ')

export const formSignInSettingsSchema = z.object({
  design: z.number().int().min(1).max(10).describe(`The design, 1–10: ${DESIGNS}. Embedded in another site the page always uses 10 (Compact).`),
  logo_url: z.string().max(500).nullable().describe('The logo: an image uploaded to this workspace\'s logos (variant form-sign-in, Settings → Forms); null shows the workspace name'),
  heading: z.string().max(SIGN_IN_LIMITS.heading).describe('Heading (default "Sign in to continue")'),
  subheading: z.string().max(SIGN_IN_LIMITS.subheading).describe('Welcome message under the heading; may be empty'),
  button_label: z.string().max(SIGN_IN_LIMITS.button_label).describe('The sign-in button label (default "Sign in")'),
  footer_text: z.string().max(SIGN_IN_LIMITS.footer_text).describe('Small print under the form; empty for none'),
  support_link_label: z.string().max(SIGN_IN_LIMITS.support_link_label).describe('Support link text (blank: "Get help")'),
  support_link_url: z.string().max(SIGN_IN_LIMITS.support_link_url).nullable().describe('Support link: https:// or mailto:; null for none'),
  accent_color: z.string().nullable().describe('#rrggbb for buttons and coloured panels; null is the UserTasks default (ink). Ignored while use_workspace_theme is on'),
  use_workspace_theme: z.boolean().describe('Draw the page in the workspace theme (colours, surfaces, text, radius, fonts, light/dark mode, canvas) instead of the UserTasks look and accent_color; the design, logo and wording still apply. Default false'),
})

const tags = ['Forms']

export const getFormSignInPageEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/form-sign-in-page', operationId: 'getFormSignInPage', tags,
  summary: 'Get the form sign-in page settings (any member)',
  description: 'The workspace\'s sign-in page for form links: design (1–10), logo, wording, support link, accent colour and whether it uses the workspace theme.',
  permission: null,
  response: formSignInSettingsSchema,
  cli: { resource: 'form-sign-in-page', verb: 'get' },
})

export const updateFormSignInPageEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workspace/form-sign-in-page', operationId: 'updateFormSignInPage', tags,
  summary: 'Change the form sign-in page settings',
  description: 'Send only the settings to change; the rest are kept. An empty string clears logo_url, support_link_url and accent_color. heading and button_label can\'t be empty. Audited.',
  permission: 'settings.edit',
  body: formSignInSettingsSchema.partial(),
  response: formSignInSettingsSchema,
  cli: { resource: 'form-sign-in-page', verb: 'update' },
})

export const formSignInPageEndpoints = [getFormSignInPageEndpoint, updateFormSignInPageEndpoint]
