/**
 * Email HTML checks for the template editor: structure (unclosed /
 * mismatched tags), client compatibility (a short rule list of what common
 * clients drop), unknown variables and size (Gmail clips messages over
 * ~102 KB). Pure; positions are source offsets for the code editor.
 */

import { tokenizeHtml, VOID_ELEMENTS, attrValue } from './html-tokens'
import { detectTemplateVariables, unknownTemplateVariables } from './variables'

export type EmailLintSeverity = 'error' | 'warning' | 'info'

export interface EmailLintIssue {
  severity: EmailLintSeverity
  /** Stable id of the rule (tests, de-duplication). */
  rule: string
  message: string
  from: number
  to: number
}

/** Gmail clips the message body above this many bytes. */
export const GMAIL_CLIP_BYTES = 102 * 1024

/** Elements whose end tag HTML lets you leave out (not reported when unclosed). */
const OPTIONAL_END = new Set(['p', 'li', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'option', 'dt', 'dd', 'colgroup', 'html', 'head', 'body'])

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Unclosed / stray / mismatched tags. */
export function structureIssues(html: string): EmailLintIssue[] {
  const issues: EmailLintIssue[] = []
  const stack: Array<{ name: string; from: number; to: number }> = []
  for (const token of tokenizeHtml(html)) {
    if (token.kind === 'open') {
      if (token.text.endsWith('>') === false) {
        issues.push({ severity: 'error', rule: 'unterminated-tag', message: `<${token.name}> is missing its closing ">"`, from: token.start, to: token.end })
        continue
      }
      if (VOID_ELEMENTS.has(token.name) || token.selfClosing) continue
      stack.push({ name: token.name, from: token.start, to: token.end })
    } else if (token.kind === 'close') {
      if (VOID_ELEMENTS.has(token.name)) continue
      const at = stack.map((s) => s.name).lastIndexOf(token.name)
      if (at === -1) {
        issues.push({ severity: 'error', rule: 'stray-close', message: `</${token.name}> has no matching <${token.name}>`, from: token.start, to: token.end })
        continue
      }
      for (const open of stack.slice(at + 1)) {
        if (OPTIONAL_END.has(open.name)) continue
        issues.push({ severity: 'error', rule: 'unclosed-tag', message: `<${open.name}> is not closed before </${token.name}>`, from: open.from, to: open.to })
      }
      stack.length = at
    }
  }
  for (const open of stack) {
    if (OPTIONAL_END.has(open.name)) continue
    issues.push({ severity: 'error', rule: 'unclosed-tag', message: `<${open.name}> is never closed`, from: open.from, to: open.to })
  }
  return issues
}

interface CompatRule { rule: string; re: RegExp; message: string; severity?: EmailLintSeverity }

/** What common clients (Gmail, Outlook desktop, Yahoo, Apple Mail) drop or ignore. */
const COMPAT_RULES: CompatRule[] = [
  { rule: 'css-flex', re: /display\s*:\s*(inline-)?flex\b/gi, message: 'Flexbox is ignored by Outlook desktop and some webmail — use tables for layout' },
  { rule: 'css-grid', re: /display\s*:\s*(inline-)?grid\b/gi, message: 'CSS grid is not supported by most email clients — use tables for layout' },
  { rule: 'css-position', re: /position\s*:\s*(absolute|fixed|sticky)\b/gi, message: 'position: absolute / fixed is stripped by Gmail and Outlook' },
  { rule: 'external-css', re: /<link\b[^>]*rel\s*=\s*["']?stylesheet[^>]*>/gi, message: 'External stylesheets are not loaded by email clients — put CSS in <style> (it is inlined on save)' },
  { rule: 'css-import', re: /@import\b/gi, message: '@import is not loaded by email clients' },
  { rule: 'script', re: /<script\b/gi, message: 'Scripts never run in email and are removed on save', severity: 'error' },
  { rule: 'form', re: /<form\b/gi, message: 'Forms are removed on save — link to a UserTasks form instead', severity: 'error' },
  { rule: 'iframe', re: /<(iframe|object|embed)\b/gi, message: 'Embedded frames are removed on save', severity: 'error' },
  { rule: 'video', re: /<(video|audio)\b/gi, message: 'Video and audio play in very few clients — use a linked image instead' },
  { rule: 'svg', re: /<svg\b/gi, message: 'Inline SVG is not shown by Gmail or Outlook — use a PNG image' },
  { rule: 'css-variables', re: /var\(\s*--/gi, message: 'CSS variables are not supported by Gmail or Outlook' },
  { rule: 'event-handler', re: /\son[a-z]+\s*=/gi, message: 'Event handler attributes are removed on save', severity: 'error' },
  { rule: 'javascript-url', re: /(href|src)\s*=\s*["']?\s*javascript:/gi, message: 'javascript: links are removed on save', severity: 'error' },
  { rule: 'background-image', re: /background-image\s*:\s*url\(/gi, message: 'Background images are not shown by Outlook desktop — keep text readable without them', severity: 'info' },
]

export function compatibilityIssues(html: string): EmailLintIssue[] {
  const issues: EmailLintIssue[] = []
  for (const rule of COMPAT_RULES) {
    for (const m of html.matchAll(rule.re)) {
      issues.push({ severity: rule.severity ?? 'warning', rule: rule.rule, message: rule.message, from: m.index ?? 0, to: (m.index ?? 0) + m[0].length })
      if (issues.filter((i) => i.rule === rule.rule).length >= 5) break
    }
  }
  // Images without alt text (blocked images show nothing).
  for (const token of tokenizeHtml(html)) {
    if (token.kind === 'open' && token.name === 'img' && attrValue(token.attrs, 'alt') === null) {
      issues.push({ severity: 'info', rule: 'img-alt', message: 'Add alt text — many clients block images until the reader allows them', from: token.start, to: token.end })
    }
  }
  return issues
}

export function variableIssues(texts: { html: string; subject?: string; text?: string }, declarations: unknown = []): EmailLintIssue[] {
  const used = detectTemplateVariables(texts.subject, texts.html, texts.text)
  const unknown = new Set(unknownTemplateVariables(used, declarations).map((n) => n.toLowerCase()))
  const issues: EmailLintIssue[] = []
  for (const m of texts.html.matchAll(/\{\{([\w.\-[\]]+)\}\}/g)) {
    if (!unknown.has(m[1].toLowerCase())) continue
    issues.push({ severity: 'warning', rule: 'unknown-variable', message: `{{${m[1]}}} is not a built-in variable — workflows using the template map it; add its details under Variables › This template`, from: m.index ?? 0, to: (m.index ?? 0) + m[0].length })
  }
  for (const m of texts.html.matchAll(/\{\{\s+[\w.]+\s*\}\}|\{\{[\w.]+\s+\}\}/g)) {
    issues.push({ severity: 'warning', rule: 'variable-spaces', message: 'Spaces inside {{ }} are not read — the text stays as written', from: m.index ?? 0, to: (m.index ?? 0) + m[0].length })
  }
  return issues
}

export function sizeIssues(html: string): EmailLintIssue[] {
  const bytes = byteLength(html)
  if (bytes > GMAIL_CLIP_BYTES) return [{ severity: 'warning', rule: 'gmail-clip', message: `The HTML is ${(bytes / 1024).toFixed(0)} KB — Gmail clips messages over 102 KB ("View entire message")`, from: 0, to: 0 }]
  if (bytes > GMAIL_CLIP_BYTES * 0.8) return [{ severity: 'info', rule: 'gmail-clip-near', message: `The HTML is ${(bytes / 1024).toFixed(0)} KB — close to Gmail's 102 KB clipping limit (values filled in at send time add to it)`, from: 0, to: 0 }]
  return []
}

/** Every check, errors first. */
export function lintEmailHtml(input: { html: string; subject?: string; text?: string; declarations?: unknown }): EmailLintIssue[] {
  const order: Record<EmailLintSeverity, number> = { error: 0, warning: 1, info: 2 }
  return [
    ...structureIssues(input.html),
    ...compatibilityIssues(input.html),
    ...variableIssues({ html: input.html, subject: input.subject, text: input.text }, input.declarations),
    ...sizeIssues(input.html),
  ].sort((a, b) => order[a.severity] - order[b.severity] || a.from - b.from)
}
