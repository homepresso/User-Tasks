import { z } from 'zod'
import { defineEndpoint } from './registry'

/*
 * Anonymous forms (public form links, /p/<token>): a form's link, on/off and
 * visitor limits, the link's regeneration, and the workspace switch with its
 * bot protection. The public submit endpoint itself is for the form page only
 * (app/api/public/forms/[token]/*) and is not part of /api/v1.
 */

const tags = ['Forms']
const idParams = z.object({ id: z.string().uuid().describe('Form id') })

const ANONYMOUS_NOTE = 'Anonymous forms: a form with "Allow anonymous responses" on has an unguessable public link (/p/<token>) that anyone can fill in without signing in, while the workspace\'s "Allow anonymous forms" switch is on. Anonymous visitors can only render and submit that form; lookups / Data tables need "Allow anonymous read" on the field, server steps need "Allow for anonymous" on the step, uploads need settings.uploads. Submissions are stored with source "anonymous" and no submitter. Audited.'

export const anonymousSettingsBody = z.object({
  per_ip_per_minute: z.number().int().min(1).max(60).optional().describe('Submissions per visitor IP per minute (1-60, default 10)'),
  daily_cap: z.number().int().min(1).max(10_000).optional().describe('Anonymous submissions per rolling 24 hours (1-10000, default 500)'),
  min_fill_seconds: z.number().int().min(0).max(120).optional().describe('Seconds between opening the page and submitting (0-120, default 3)'),
  uploads: z.boolean().optional().describe('Attachments fields take files from anonymous visitors (default false)'),
  max_upload_mb: z.number().int().min(1).max(4).optional().describe('Largest anonymous upload in MB (1-4, default 2)'),
  max_files: z.number().int().min(1).max(10).optional().describe('Files per anonymous submission (1-10, default 3)'),
  allow_indexing: z.boolean().optional().describe('Let search engines index the page (default false: noindex)'),
  allow_friendly_link: z.boolean().optional().describe('"Allow friendly public link": visitors may also open the form at /form/<system_name> on the workspace address (default false; a system name is guessable, the token is not)'),
})

export const formAnonymousBody = z.object({
  enabled: z.boolean().optional().describe('Allow anonymous responses (turning on needs the workspace switch)'),
  settings: anonymousSettingsBody.optional().describe('Visitor limits, clamped to the platform limits'),
})

const formAnonymousResponse = z.looseObject({
  form_id: z.string(),
  enabled: z.boolean(),
  token: z.string().nullable().describe('The public link token (null until first turned on)'),
  path: z.string().nullable().describe('/p/<token>'),
  settings: z.looseObject({}),
  workspace_enabled: z.boolean(),
  captcha: z.string().nullable(),
  live: z.boolean().describe('Anonymous visitors can open the link now'),
  readiness: z.looseObject({}),
  warnings: z.array(z.string()),
  token_rotated_at: z.string().nullable(),
})

export const anonymousWorkspaceBody = z.object({
  enabled: z.boolean().optional().describe('Allow anonymous forms in this workspace (off stops every public link at once)'),
  captcha: z.object({
    provider: z.enum(['turnstile', 'hcaptcha']).nullable().optional(),
    site_key: z.string().max(200).nullable().optional(),
    secret: z.string().max(500).nullable().optional().describe('Write-only; stored encrypted. Omit, "" or "__SECRET__" keeps the stored one'),
  }).nullable().optional().describe('Optional bot protection (null turns it off)'),
})

const anonymousWorkspaceResponse = z.looseObject({
  enabled: z.boolean(),
  captcha: z.looseObject({ provider: z.string().nullable(), site_key: z.string().nullable(), has_secret: z.boolean() }),
})

export const getFormAnonymousEndpoint = defineEndpoint({
  method: 'GET', path: '/forms/{id}/anonymous', operationId: 'getFormAnonymous', tags,
  summary: 'A form\'s public (anonymous) link, options and what anonymous visitors would not get', description: ANONYMOUS_NOTE,
  permission: 'forms.view', params: idParams, response: formAnonymousResponse,
  cli: { resource: 'forms', verb: 'anonymous', positional: ['id'] },
})

export const updateFormAnonymousEndpoint = defineEndpoint({
  method: 'PATCH', path: '/forms/{id}/anonymous', operationId: 'updateFormAnonymous', tags,
  summary: 'Turn a form\'s anonymous responses on / off and set its visitor limits', description: ANONYMOUS_NOTE,
  permission: 'forms.edit', params: idParams, body: formAnonymousBody, response: formAnonymousResponse,
  cli: { resource: 'forms', verb: 'anonymous-set', positional: ['id'] },
})

export const regenerateFormAnonymousEndpoint = defineEndpoint({
  method: 'POST', path: '/forms/{id}/anonymous/regenerate', operationId: 'regenerateFormAnonymousLink', tags,
  summary: 'Make a new public link for a form (every earlier link stops working)', description: ANONYMOUS_NOTE,
  permission: 'forms.edit', params: idParams, response: formAnonymousResponse,
  cli: { resource: 'forms', verb: 'anonymous-regenerate', positional: ['id'] },
})

export const getAnonymousWorkspaceEndpoint = defineEndpoint({
  method: 'GET', path: '/anonymous-forms', operationId: 'getAnonymousFormsSettings', tags,
  summary: 'The workspace\'s "Allow anonymous forms" switch and bot protection (never the secret)', description: ANONYMOUS_NOTE,
  permission: 'settings.view', response: anonymousWorkspaceResponse,
  cli: { resource: 'anonymous-forms', verb: 'get' },
})

export const updateAnonymousWorkspaceEndpoint = defineEndpoint({
  method: 'PATCH', path: '/anonymous-forms', operationId: 'updateAnonymousFormsSettings', tags,
  summary: 'Set the workspace\'s "Allow anonymous forms" switch and bot protection', description: ANONYMOUS_NOTE,
  permission: 'settings.edit', body: anonymousWorkspaceBody, response: anonymousWorkspaceResponse,
  cli: { resource: 'anonymous-forms', verb: 'update' },
})

export const anonymousFormEndpoints = [
  getFormAnonymousEndpoint, updateFormAnonymousEndpoint, regenerateFormAnonymousEndpoint,
  getAnonymousWorkspaceEndpoint, updateAnonymousWorkspaceEndpoint,
]
