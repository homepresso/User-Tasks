'use server'

import { revalidatePath } from 'next/cache'
import { fromSession } from '@/lib/services/context'
import * as templates from '@/lib/services/email-templates'
import { findRecentDuplicate } from '@/lib/recent-duplicate'

// Thin wrappers over lib/services/email-templates (sanitisation, single
// default, workflows.* permission checks and audit live there).

export async function listEmailTemplates() {
  return templates.listEmailTemplatesWithBodies(await fromSession())
}

export async function saveEmailTemplate(input: {
  id?: string
  name: string
  description?: string
  subject: string
  htmlBody: string
  textBody?: string
}) {
  const ctx = await fromSession()
  const fields = {
    name: input.name,
    description: input.description ?? null,
    subject: input.subject,
    html_body: input.htmlBody,
    text_body: input.textBody ?? '',
  }
  if (input.id) await templates.updateEmailTemplate(ctx, input.id, fields)
  else if (!(ctx.actorId && await findRecentDuplicate(ctx.supabase, 'email_templates', { tenant_id: ctx.tenantId, created_by: ctx.actorId, name: input.name.trim() }))) {
    // A repeated submit (double click, retry) must not add a second template.
    await templates.createEmailTemplate(ctx, fields)
  }
  revalidatePath('/automations/email-templates')
}

export async function deleteEmailTemplate(id: string) {
  await templates.deleteEmailTemplate(await fromSession(), id)
  revalidatePath('/automations/email-templates')
}
