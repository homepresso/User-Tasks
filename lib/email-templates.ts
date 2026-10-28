import type { SupabaseClient } from '@supabase/supabase-js'

export interface EmailTemplate {
  id: string
  tenant_id: string
  name: string
  description: string | null
  subject: string
  html_body: string
  text_body: string
}

export function sanitizeEmailHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/<\s*(script|iframe|object|embed|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"')
}

/**
 * The content an import stores for a manifest asset: the same trimming,
 * sanitising and text derivation as the email-template service's writes
 * (config plans compare against this so hand-written HTML shows no drift).
 */
export function normalizeEmailTemplateContent<T extends Record<string, unknown>>(asset: T): T {
  const htmlBody = sanitizeEmailHtml(asset.html_body).trim()
  return {
    ...asset,
    name: String(asset.name ?? '').trim(),
    description: String(asset.description ?? '').trim() || null,
    subject: String(asset.subject ?? '').trim(),
    html_body: htmlBody,
    text_body: String(asset.text_body ?? '').trim() || htmlToPlainText(htmlBody),
  }
}

export function htmlToPlainText(value: unknown): string {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function loadEmailTemplate(
  supabase: SupabaseClient,
  tenantId: string,
  templateId: string,
): Promise<EmailTemplate | null> {
  const { data, error } = await (supabase as any)
    .from('email_templates')
    .select('id, tenant_id, name, description, subject, html_body, text_body')
    .eq('id', templateId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(`Email template load failed: ${error.message}`)
  return data as EmailTemplate | null
}
