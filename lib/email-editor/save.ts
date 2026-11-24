/**
 * What the editor's Save does to the HTML before the service stores it:
 * inline `<style>` rules onto elements (optional, on by default in the
 * editor), then the template sanitiser (the same policy every write path
 * applies). Pure.
 */

import { sanitizeEmailHtml } from '@/lib/email-templates'
import { inlineCss } from './inline-css'

export interface PreparedHtml {
  html: string
  inlined: number
  kept: number
}

export function prepareTemplateHtml(html: string, options: { inline?: boolean } = {}): PreparedHtml {
  const sanitized = sanitizeEmailHtml(html)
  if (!options.inline) return { html: sanitized, inlined: 0, kept: 0 }
  const result = inlineCss(sanitized)
  // Sanitise again: inlining rewrites tags (it never adds active content, but the stored HTML must always pass the policy).
  return { html: sanitizeEmailHtml(result.html), inlined: result.inlined, kept: result.kept }
}
