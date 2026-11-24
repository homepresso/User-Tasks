'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as templates from '@/lib/services/email-templates'
import { findRecentDuplicate } from '@/lib/recent-duplicate'
import { prepareTemplateHtml } from '@/lib/email-editor/save'
import type { EmailVariableDeclaration } from '@/lib/email-editor/variables'

// Thin wrappers over lib/services/email-templates (sanitisation, single
// default, workflows.* permission checks and audit live there).

export async function listEmailTemplates() {
  return templates.listEmailTemplatesWithBodies(await fromSession())
}

export interface SaveEmailTemplateInput {
  id?: string
  name: string
  description?: string
  subject: string
  htmlBody: string
  textBody?: string
  tags?: string[]
  /** Declared variables (auto-detected names are added by the service). */
  variables?: EmailVariableDeclaration[]
  /** Inline `<style>` rules onto elements before saving (the editor's default). */
  inlineCss?: boolean
}

/** Saves and returns the template (its id for a new one); null when a repeated submit was ignored. */
export async function saveEmailTemplate(input: SaveEmailTemplateInput) {
  const ctx = await fromSession()
  const prepared = prepareTemplateHtml(input.htmlBody, { inline: !!input.inlineCss })
  const fields = {
    name: input.name,
    description: input.description ?? null,
    subject: input.subject,
    html_body: prepared.html,
    text_body: input.textBody ?? '',
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.variables !== undefined ? { variables: input.variables } : {}),
  }
  let saved: templates.EmailTemplateRow | null = null
  if (input.id) saved = await templates.updateEmailTemplate(ctx, input.id, fields)
  else if (!(ctx.actorId && await findRecentDuplicate(ctx.supabase, 'email_templates', { tenant_id: ctx.tenantId, created_by: ctx.actorId, name: input.name.trim() }))) {
    // A repeated submit (double click, retry) must not add a second template.
    saved = await templates.createEmailTemplate(ctx, fields)
  }
  revalidatePath('/automations/email-templates')
  return saved ? { ...saved, inlined: prepared.inlined } : null
}

export async function deleteEmailTemplate(id: string) {
  await templates.deleteEmailTemplate(await fromSession(), id)
  revalidatePath('/automations/email-templates')
}

/** Branding, email setup and the signed-in address for the editor. */
export async function getEmailEditorContext() {
  return templates.getEmailEditorContext(await fromSession())
}

/** Send the current draft to the signed-in person (rate-limited, audited). */
export async function sendEmailTemplateTest(input: templates.EmailTemplateTestSendInput) {
  try {
    return await templates.sendEmailTemplateTest(await fromSession(), input)
  } catch (error) {
    // Expected refusals (permission, rate limit, validation) as a message, not a crash.
    if (isServiceError(error)) return { sent: false as const, to: null, provider: null, error: error.message, detail: null }
    throw error
  }
}

/** Sample values from a form's fields for the preview. */
export async function getEmailSampleFromForm(formId: string) {
  return templates.getEmailSampleFromForm(await fromSession(), formId)
}
