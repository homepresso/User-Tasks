'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/action-result'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as orgImport from '@/lib/services/org-import'
import { CSV_LIMITS } from '@/lib/org/csv'

/*
 * Org structure import / export server actions (Organization → Manage →
 * Import): thin wrappers over lib/services/org-import, which checks
 * org.manage (import) / org.view (export) and parses on the server. They
 * return { ok, error } so the panel can show the message (thrown errors are
 * redacted in production).
 */

function failure(error: unknown): { ok: false; error: string } {
  if (isServiceError(error)) return { ok: false, error: error.message }
  console.error('[org-import action]', error)
  return { ok: false, error: 'Something went wrong. Try again.' }
}

function checkInput(input: orgImport.OrgImportInput): string | null {
  if (!input || typeof input.csv !== 'string') return 'Choose a CSV file first'
  if (input.csv.length > CSV_LIMITS.maxBytes) return `The file is larger than ${CSV_LIMITS.maxBytes / 1024 / 1024} MB`
  return null
}

export async function planOrgImport(input: orgImport.OrgImportInput): Promise<ActionResult<orgImport.OrgImportPlan>> {
  const invalid = checkInput(input)
  if (invalid) return { ok: false, error: invalid }
  try {
    return { ok: true, data: await orgImport.planOrgCsvImport(await fromSession(), { csv: input.csv, mapping: input.mapping }) }
  } catch (error) {
    return failure(error)
  }
}

export async function applyOrgImport(input: orgImport.OrgImportInput): Promise<ActionResult<orgImport.OrgImportResult>> {
  const invalid = checkInput(input)
  if (invalid) return { ok: false, error: invalid }
  try {
    const result = await orgImport.applyOrgCsvImport(await fromSession(), { csv: input.csv, mapping: input.mapping })
    revalidatePath('/org')
    return { ok: true, data: result }
  } catch (error) {
    return failure(error)
  }
}

export async function exportOrgStructure(): Promise<ActionResult<{ csv: string; filename: string; rows: number }>> {
  try {
    return { ok: true, data: await orgImport.exportOrgCsv(await fromSession()) }
  } catch (error) {
    return failure(error)
  }
}

export async function orgImportTemplate(): Promise<ActionResult<{ csv: string; filename: string }>> {
  try {
    await fromSession()
    return { ok: true, data: { csv: orgImport.orgCsvTemplate(), filename: 'org-structure-template.csv' } }
  } catch (error) {
    return failure(error)
  }
}
