import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * Document OCR: the workspace's OCR provider for document steps (scanned
 * PDFs and images). Bring your own Azure AI Document Intelligence key, use
 * built-in tesseract where the instance offers it, follow the instance
 * default (self-hosted), or turn OCR off. The key is write-only: responses
 * carry '__SECRET__' when one is stored, and it is never exported.
 */

const PROVIDERS = ['instance_default', 'azure_document_intelligence', 'tesseract', 'off'] as const

export const documentOcrUpdateBody = z.object({
  provider: z.enum(PROVIDERS).describe('azure_document_intelligence = your own Azure resource; tesseract = built-in (only where the instance offers it); instance_default = the instance configuration (self-hosted; on the cloud this means not configured); off'),
  endpoint: z.string().trim().max(500).nullish().describe('Azure: the resource endpoint (https), e.g. https://my-resource.cognitiveservices.azure.com. Omit to keep the stored one'),
  key: z.string().max(512).nullish().describe('Azure: KEY 1 or KEY 2 (write-only). Omit, empty or "__SECRET__" keeps the stored key'),
  api_version: z.string().trim().max(40).nullish().describe('Azure: API version (default 2024-11-30); empty resets to the default'),
})

export const documentOcrTestBody = z.object({
  endpoint: z.string().trim().max(500).nullish().describe('Test this endpoint instead of the saved one'),
  key: z.string().max(512).nullish().describe('Test this key instead of the saved one (write-only)'),
  api_version: z.string().trim().max(40).nullish(),
}).optional()

const effective = z.looseObject({
  status: z.enum(['ready', 'not_configured', 'off', 'unavailable']),
  provider: z.enum(['azure_document_intelligence', 'tesseract']).nullable().describe('What a run would use'),
  source: z.enum(['workspace', 'instance']).nullable(),
  message: z.string(),
})

const documentOcrResponse = z.looseObject({
  provider: z.enum(PROVIDERS),
  azure: z.looseObject({
    connector_id: z.string().describe('The tenant connector holding the endpoint and key (GET /connectors/{id})'),
    endpoint: z.string(),
    api_version: z.string().nullable(),
    key: z.literal('__SECRET__').nullable().describe('Write-only: "__SECRET__" when a key is stored'),
    key_saved: z.boolean(),
    enabled: z.boolean(),
    last_test_status: z.string().nullable(),
    last_tested_at: z.string().nullable(),
    last_test_message: z.string().nullable(),
  }).nullable(),
  effective,
  instance: z.looseObject({
    default_allowed: z.boolean().describe('DOCUMENT_OCR_INSTANCE_DEFAULT: workspaces without a setting may use the instance OCR'),
    tesseract_available: z.boolean(),
  }),
  settings_path: z.string(),
})

/** The GET response is accepted as the PUT body: azure.endpoint / api_version / key move to the top level. */
function normalizeRoundTrip(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const value = raw as Record<string, unknown>
  const azure = value.azure && typeof value.azure === 'object' ? value.azure as Record<string, unknown> : null
  if (!azure) return value
  return {
    provider: value.provider,
    endpoint: value.endpoint ?? azure.endpoint,
    api_version: value.api_version ?? azure.api_version ?? undefined,
    key: value.key ?? azure.key ?? undefined,
  }
}

const tags = ['Document OCR']

export const getDocumentOcrEndpoint = defineEndpoint({
  method: 'GET', path: '/document-ocr', operationId: 'getDocumentOcr', tags,
  summary: 'Get the workspace OCR provider', description: 'The provider document steps use for scanned PDFs and images, the saved Azure endpoint (the key is never returned) and what a run would use.',
  permission: 'settings.view',
  response: documentOcrResponse,
  cli: { resource: 'document-ocr', verb: 'get' },
})

export const updateDocumentOcrEndpoint = defineEndpoint({
  method: 'PUT', path: '/document-ocr', operationId: 'updateDocumentOcr', tags,
  summary: 'Set the workspace OCR provider',
  description: 'azure_document_intelligence needs an https endpoint that passes the egress guard and a key (stored encrypted, write-only). Audited.',
  permission: 'settings.edit',
  body: documentOcrUpdateBody, response: documentOcrResponse,
  roundTrip: { normalize: normalizeRoundTrip },
  cli: { resource: 'document-ocr', verb: 'update' },
})

export const deleteDocumentOcrKeyEndpoint = defineEndpoint({
  method: 'DELETE', path: '/document-ocr', operationId: 'deleteDocumentOcrKey', tags,
  summary: 'Remove the workspace Azure OCR key',
  description: 'Deletes the stored endpoint and key; an Azure setting falls back to the instance default (on the cloud: not configured). Audited.',
  permission: 'settings.edit',
  response: documentOcrResponse,
  cli: { resource: 'document-ocr', verb: 'remove-key' },
})

export const testDocumentOcrEndpoint = defineEndpoint({
  method: 'POST', path: '/document-ocr/test', operationId: 'testDocumentOcr', tags,
  summary: 'Test the workspace Azure OCR connection',
  description: 'A free Azure call (resource info) with the saved endpoint and key, or with the values in the body. No page is billed. Audited.',
  permission: 'settings.edit',
  body: documentOcrTestBody,
  response: z.looseObject({ status: z.enum(['success', 'error']), message: z.string(), http_status: z.number().int().nullable() }),
  cli: { resource: 'document-ocr', verb: 'test' },
})

export const documentOcrEndpoints = [getDocumentOcrEndpoint, updateDocumentOcrEndpoint, deleteDocumentOcrKeyEndpoint, testDocumentOcrEndpoint]
