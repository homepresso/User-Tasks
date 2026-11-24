import { z } from 'zod'
import { defineEndpoint } from './registry'
import { SIGN_IN_DESIGNS, SIGN_IN_LIMITS } from '@/lib/forms/sign-in-page'

/**
 * The workspace sign-in page for forms and apps (lib/forms/sign-in-page.ts):
 * what visitors see at /form-login when a form link (/f/<id>, /form/<system
 * name>) needs them to sign in, and at /sign-in for apps (/app/<slug>,
 * /apps/<slug>, /embed/apps/<slug>). Stored in tenants.settings.sign_in
 * (older workspaces: tenants.settings.forms.sign_in, read as a fallback).
 * /workspace/sign-in-page; /workspace/form-sign-in-page is the same
 * resource under its earlier name.
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
  use_for_forms: z.boolean().describe('Form links (/f/…, /form/…) use this page; false sends them to the standard UserTasks sign-in. Default true'),
  use_for_apps: z.boolean().describe('Apps (/app/…, /apps/…, /embed/apps/…) use this page; false sends them to the standard sign-in. An app can override it (its sign_in_page setting). Default true'),
  use_app_color: z.boolean().describe('On an app\'s sign-in page, use the app\'s colour as the accent (when it has one; not with use_workspace_theme). Default false'),
})

const tags = ['Forms']

const GET_DESCRIPTION = 'The workspace\'s sign-in page for form links and apps: design (1–10), logo, wording, support link, accent colour, whether it uses the workspace theme, and whether form links (use_for_forms) and apps (use_for_apps) use it.'
const PATCH_DESCRIPTION = 'Send only the settings to change; the rest are kept. An empty string clears logo_url, support_link_url and accent_color. heading and button_label can\'t be empty. Audited.'

export const getSignInPageEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/sign-in-page', operationId: 'getSignInPage', tags,
  summary: 'Get the sign-in page settings for forms and apps (any member)',
  description: GET_DESCRIPTION,
  permission: null,
  response: formSignInSettingsSchema,
  cli: { resource: 'sign-in-page', verb: 'get' },
})

export const updateSignInPageEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workspace/sign-in-page', operationId: 'updateSignInPage', tags,
  summary: 'Change the sign-in page settings for forms and apps',
  description: PATCH_DESCRIPTION,
  permission: 'settings.edit',
  body: formSignInSettingsSchema.partial(),
  response: formSignInSettingsSchema,
  cli: { resource: 'sign-in-page', verb: 'update' },
})

export const getFormSignInPageEndpoint = defineEndpoint({
  method: 'GET', path: '/workspace/form-sign-in-page', operationId: 'getFormSignInPage', tags,
  summary: 'Get the sign-in page settings (earlier name of GET /workspace/sign-in-page)',
  description: `${GET_DESCRIPTION} The same resource as /workspace/sign-in-page.`,
  permission: null,
  response: formSignInSettingsSchema,
  cli: { resource: 'form-sign-in-page', verb: 'get' },
})

export const updateFormSignInPageEndpoint = defineEndpoint({
  method: 'PATCH', path: '/workspace/form-sign-in-page', operationId: 'updateFormSignInPage', tags,
  summary: 'Change the sign-in page settings (earlier name of PATCH /workspace/sign-in-page)',
  description: `${PATCH_DESCRIPTION} The same resource as /workspace/sign-in-page.`,
  permission: 'settings.edit',
  body: formSignInSettingsSchema.partial(),
  response: formSignInSettingsSchema,
  cli: { resource: 'form-sign-in-page', verb: 'update' },
})

export const formSignInPageEndpoints = [getSignInPageEndpoint, updateSignInPageEndpoint, getFormSignInPageEndpoint, updateFormSignInPageEndpoint]
