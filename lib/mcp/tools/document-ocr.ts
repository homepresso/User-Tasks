import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as documentOcr from '@/lib/services/document-ocr'
import { messageOf } from './_util'

/*
 * Document OCR tools: thin wrappers over lib/services/document-ocr. The
 * workspace's OCR provider for document steps (its own Azure AI Document
 * Intelligence key, built-in tesseract where offered, the instance default,
 * or off). The key is write-only: results carry '__SECRET__' at most.
 * Reads need settings.view; changes and tests settings.edit (audited).
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerDocumentOcrTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('document_ocr_get', 'Get the workspace OCR provider for document steps (scanned PDFs and images): the choice, the saved Azure endpoint (never the key) and what a run would use (effective.status ready / not_configured / off / unavailable).', {},
    async () => run(async () => documentOcr.getDocumentOcr(svc())))

  server.tool('document_ocr_update', 'Set the workspace OCR provider. azure_document_intelligence uses the workspace\'s own Azure resource: give endpoint (https) and key (KEY 1 or KEY 2; write-only, omit to keep the stored one). tesseract is built-in OCR where the instance offers it; instance_default follows the instance (on the cloud: not configured); off turns OCR off. Audited.', {
    provider: z.enum(['instance_default', 'azure_document_intelligence', 'tesseract', 'off']),
    endpoint: z.string().optional().describe('Azure resource endpoint, e.g. https://my-resource.cognitiveservices.azure.com'),
    key: z.string().optional().describe('Azure key (write-only); omit to keep the stored key'),
    api_version: z.string().optional().describe('Azure API version (default 2024-11-30)'),
  }, async (args) => run(async () => documentOcr.updateDocumentOcr(svc(), args)))

  server.tool('document_ocr_remove_key', 'Remove the workspace\'s Azure OCR endpoint and key. An Azure setting falls back to the instance default (on the cloud: OCR not configured). Audited.', {},
    async () => run(async () => documentOcr.removeDocumentOcrKey(svc())))

  server.tool('document_ocr_test', 'Test the Azure OCR connection with a free call (no page billed): the saved endpoint and key, or the values given. Audited.', {
    endpoint: z.string().optional(),
    key: z.string().optional().describe('Test this key instead of the saved one (write-only)'),
    api_version: z.string().optional(),
  }, async (args) => run(async () => documentOcr.testDocumentOcr(svc(), args)))
}
