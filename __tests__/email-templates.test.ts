import { describe, expect, it } from 'vitest'
import { htmlToPlainText, sanitizeEmailHtml } from '@/lib/email-templates'
import { validateNode } from '@/lib/workflow-validation'

describe('email templates', () => {
  it('removes active content while preserving normal email markup', () => {
    const value = sanitizeEmailHtml('<h1 onclick="bad()">Hello</h1><script>alert(1)</script><a href="javascript:bad()">Open</a>')
    expect(value).toContain('<h1>Hello</h1>')
    expect(value).not.toContain('script')
    expect(value).not.toContain('onclick')
    expect(value).not.toContain('javascript:')
  })

  it('creates a useful notification fallback from HTML', () => {
    expect(htmlToPlainText('<h1>Hello</h1><p>Task &amp; details<br>Ready</p>')).toBe('Hello\nTask & details\nReady')
  })

  it('allows send-email nodes to source subject and body from a template', () => {
    const errors = validateNode({ id: 'email', type: 'send_email', label: 'Email', position: { x: 0, y: 0 }, config: { to: 'a@example.com', email_template_id: 'template-1' } } as any)
    expect(errors).toEqual([])
  })
})
