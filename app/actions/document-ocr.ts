'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as documentOcr from '@/lib/services/document-ocr'

/*
 * Settings → Document OCR server actions: thin wrappers over
 * lib/services/document-ocr (shared with /api/v1/document-ocr, MCP and the
 * CLI). settings.edit; the key is write-only (never sent back to the
 * browser) and every change / test is audited by the service.
 *
 * Expected failures are returned as { ok: false, error } so their messages
 * survive production builds, where thrown Server Function errors are redacted.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}

const PATH = '/settings/document-ocr'

export async function updateDocumentOcrAction(input: documentOcr.DocumentOcrUpdateInput) {
  const result = await run(async () => documentOcr.updateDocumentOcr(await fromSession(), input))
  if (result.ok) revalidatePath(PATH)
  return result
}

export async function removeDocumentOcrKeyAction() {
  const result = await run(async () => documentOcr.removeDocumentOcrKey(await fromSession()))
  if (result.ok) revalidatePath(PATH)
  return result
}

export async function testDocumentOcrAction(input: documentOcr.DocumentOcrTestInput) {
  return run(async () => documentOcr.testDocumentOcr(await fromSession(), input))
}
