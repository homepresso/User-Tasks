import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, itemResponse, listResponse, looseObject, paginationQuery } from './common'

const tags = ['Form controls']

const NOTE = 'Custom form controls are web components (one ES module + manifest.json). They run in a sandboxed iframe with their own CSP; the module is stored in UserTasks (a URL import is fetched once and snapshotted). Versions are immutable.'

const idOrTag = z.object({ id: z.string().min(1).max(100).describe('Control id or its tag (e.g. ut-star-rating)') })

export const formControlCreateBody = z.object({
  package_base64: z.string().optional().describe('A zip package (manifest.json + the module), base64'),
  package_name: z.string().optional().describe('File name of the uploaded package (multipart)'),
  module: z.string().optional().describe('Or: the ES module source (one file, dependencies bundled)'),
  manifest: z.union([z.string(), looseObject]).optional().describe('With `module`: manifest.json (object or JSON text)'),
  signature: looseObject.optional().describe('Optional { alg: "ed25519", public_key, signature } over the module SHA-256 (hex)'),
  url: z.string().optional().describe('Or: import from an https URL (zip or module); fetched once through the egress guard'),
  manifest_url: z.string().optional().describe('With `url` (a module): its manifest.json URL (default: next to the module)'),
})

export const formControlUpdateBody = z.object({
  enabled: z.boolean().optional().describe('false = hidden from the designer and its frames stop loading'),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  approved_hosts: z.array(z.string()).optional().describe('Network hosts to allow (only hosts a version\'s manifest asks for)'),
})

const saveResponse = z.looseObject({
  control: looseObject,
  version: z.string(),
  outcome: z.enum(['created', 'version', 'unchanged']),
  warnings: z.array(z.string()),
})

export const listFormControlsEndpoint = defineEndpoint({
  method: 'GET', path: '/form-controls', operationId: 'listFormControls', tags,
  summary: 'List custom form controls (with their versions)', description: NOTE, permission: 'extensibility.view',
  query: paginationQuery.extend({
    search: z.string().optional().describe('Name, tag or description contains'),
    enabled: z.enum(['true', 'false']).optional(),
  }),
  response: listResponse('form_controls'), listKey: 'form_controls',
  cli: { resource: 'form-controls', verb: 'list' },
})

export const createFormControlEndpoint = defineEndpoint({
  method: 'POST', path: '/form-controls', operationId: 'createFormControl', tags,
  summary: 'Upload a form control package (or import one from a URL): a new control, or a new version of the one with the same tag',
  description: `${NOTE} Re-uploading identical content for an existing version is a no-op (outcome "unchanged"); different content for an existing version is refused (409).`,
  permission: 'extensibility.create',
  body: formControlCreateBody, successStatus: 201,
  multipart: { files: { file: { name: 'package_name', content: 'package_base64' } } },
  response: saveResponse,
  cli: { resource: 'form-controls', verb: 'create' },
})

export const getFormControlEndpoint = defineEndpoint({
  method: 'GET', path: '/form-controls/{id}', operationId: 'getFormControl', tags,
  summary: 'Get a form control: latest manifest, versions (checksums, signatures), approved hosts', permission: 'extensibility.view',
  params: idOrTag, response: itemResponse('form_control'),
  cli: { resource: 'form-controls', verb: 'get', positional: ['id'] },
})

export const getFormControlVersionEndpoint = defineEndpoint({
  method: 'GET', path: '/form-controls/{id}/versions/{version}', operationId: 'getFormControlVersion', tags,
  summary: 'Get one version: manifest, checksum and (with include_module=true) the module source', permission: 'extensibility.view',
  params: idOrTag.extend({ version: z.string().min(1).max(64) }),
  query: z.object({ include_module: z.enum(['true', 'false']).optional() }),
  response: itemResponse('version'),
  cli: { resource: 'form-controls', verb: 'version', positional: ['id', 'version'] },
})

export const updateFormControlEndpoint = defineEndpoint({
  method: 'PATCH', path: '/form-controls/{id}', operationId: 'updateFormControl', tags,
  summary: 'Enable / disable a control, rename it, or approve its network hosts', description: 'Marking a control trusted (inline rendering) is only possible for instance admins in the UI.',
  permission: 'extensibility.edit',
  params: idOrTag, body: formControlUpdateBody, response: itemResponse('form_control'),
  roundTrip: { unwrap: 'form_control' },
  cli: { resource: 'form-controls', verb: 'update', positional: ['id'] },
})

export const deleteFormControlEndpoint = defineEndpoint({
  method: 'DELETE', path: '/form-controls/{id}', operationId: 'deleteFormControl', tags,
  summary: 'Delete a control (or one version with ?only_version=) — refused (409, with the usages) while a form, workflow or open task uses it',
  permission: 'extensibility.delete',
  params: idOrTag, query: z.object({ only_version: z.string().optional().describe('Delete just this version') }), response: deletedResponse,
  cli: { resource: 'form-controls', verb: 'delete', positional: ['id'] },
})

export const formControlUsagesEndpoint = defineEndpoint({
  method: 'GET', path: '/form-controls/{id}/usages', operationId: 'getFormControlUsages', tags,
  summary: 'Where a control is used: reusable forms (any version), workflow drafts and published versions, open tasks', permission: 'extensibility.view',
  params: idOrTag, response: listResponse('usages'), listKey: 'usages',
  cli: { resource: 'form-controls', verb: 'usages', positional: ['id'] },
})

export const exportFormControlEndpoint = defineEndpoint({
  method: 'GET', path: '/form-controls/{id}/export', operationId: 'exportFormControl', tags,
  summary: 'Export a control with every version (modules included) as portable JSON', permission: 'extensibility.view',
  params: idOrTag,
  response: z.looseObject({ version: z.literal(1), asset_type: z.literal('form_control'), form_control: looseObject }),
  cli: { resource: 'form-controls', verb: 'export', positional: ['id'] },
})

export const importFormControlEndpoint = defineEndpoint({
  method: 'POST', path: '/form-controls/import', operationId: 'importFormControl', tags,
  summary: 'Import a portable export: creates the control and adds the versions it lacks (checksums verified)', permission: 'extensibility.create',
  body: z.looseObject({ form_control: looseObject.optional() }), successStatus: 201,
  response: saveResponse.extend({ added: z.array(z.string()), skipped: z.array(z.string()) }),
  cli: { resource: 'form-controls', verb: 'import' },
})

export const formControlEndpoints = [
  listFormControlsEndpoint, createFormControlEndpoint, importFormControlEndpoint, getFormControlEndpoint, getFormControlVersionEndpoint,
  updateFormControlEndpoint, deleteFormControlEndpoint, formControlUsagesEndpoint, exportFormControlEndpoint,
]
