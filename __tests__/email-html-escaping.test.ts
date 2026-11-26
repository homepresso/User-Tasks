/**
 * Email HTML bodies (templates, the Send Email step's inline body) escape run
 * values: text from anonymous public forms must not become links / markup in
 * mail sent from the workspace's address. Raw HTML only through the explicit
 * `{{{var}}}` form or variables that hold HTML by contract (declared type
 * 'html', or named *_html), sanitised. Subjects lose CR/LF.
 */
import { describe, expect, it } from 'vitest'
import { emailSubjectLine, renderEmailTemplate, renderTemplateHtml } from '@/lib/email-editor/render'
import { resolveExpression } from '@/lib/expression-resolver'

const PHISH = '<a href="https://evil.example/reset">Reset your password</a>'
const ctx = (variables: Record<string, unknown>) => ({ variables })

describe('email HTML escaping', () => {
  it('escapes form text in a template HTML body (variables and function results)', () => {
    const out = renderEmailTemplate(
      { subject: 'Re: {{form.subject}}', html_body: '<p>{{form.comment}}</p><p>{{=UPPER(form.comment)}}</p>', text_body: 'Comment: {{form.comment}}' },
      ctx({ form: { comment: PHISH, subject: 'Hi' } }),
    )
    expect(out.html).not.toContain('<a ')
    expect(out.html).toContain('&lt;a href=&quot;https://evil.example/reset&quot;&gt;')
    expect(out.html).not.toMatch(/<A /)
    // Plain-text part is not HTML: no escaping.
    expect(out.text).toBe(`Comment: ${PHISH}`)
  })

  it('escapes the whole-variable case too', () => {
    expect(renderTemplateHtml('{{form.comment}}', ctx({ form: { comment: PHISH } }))).not.toContain('<a ')
  })

  it('renders {{{var}}} raw but sanitised', () => {
    const html = renderTemplateHtml('<div>{{{form.business_case}}}</div>', ctx({ form: { business_case: '<p><strong>Why</strong></p><script>alert(1)</script><img src=x onerror="alert(1)">' } }))
    expect(html).toContain('<p><strong>Why</strong></p>')
    expect(html).not.toMatch(/<script|onerror/i)
  })

  it('keeps HTML-by-contract variables raw: *_html names and declared html variables', () => {
    const vars = ctx({ user_task_description_html: '<p>Do <em>this</em></p>', summary: '<ul><li>a</li></ul>', other: '<b>x</b>' })
    expect(renderTemplateHtml('{{user_task_description_html}}', vars)).toBe('<p>Do <em>this</em></p>')
    const declared = [{ name: 'summary', type: 'html' }]
    const out = renderEmailTemplate({ subject: 's', html_body: '{{summary}} {{other}}', variables: declared }, vars)
    expect(out.html).toContain('<ul><li>a</li></ul>')
    expect(out.html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })

  it('keeps <br> line breaks from JOIN("<br>", …) lists, nothing else', () => {
    const html = renderTemplateHtml('{{lines}}', ctx({ lines: 'Ann<br>Bob<br/>Cy<br onclick="x()">' }))
    expect(html).toBe('Ann<br>Bob<br>Cy&lt;br onclick=&quot;x()&quot;&gt;')
  })

  it('a value cannot forge the raw-placeholder to smuggle HTML', () => {
    const html = renderTemplateHtml('{{{safe}}} {{evil}}', ctx({ safe: '<b>ok</b>', evil: '\u0000x:0\u0000<a href="https://evil.example">' }))
    expect(html.match(/<b>ok<\/b>/g)?.length).toBe(1)
    expect(html).not.toContain('<a ')
  })

  it('subjects are one header line', () => {
    const out = renderEmailTemplate({ subject: 'Hello {{name}}', html_body: '' }, ctx({ name: 'Bob\r\nBcc: victim@example.com' }))
    expect(out.subject).toBe('Hello Bob Bcc: victim@example.com')
    expect(emailSubjectLine('a\nb c')).toBe('a b c')
  })

  it('outside HTML contexts {{{var}}} reads like {{var}} and nothing is escaped', () => {
    expect(resolveExpression('x {{{a}}} {{a}}', { variables: { a: '<i>' } })).toBe('x <i> <i>')
  })
})
