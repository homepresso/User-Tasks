/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
import { describe, expect, it } from 'vitest'
import {
  autoMapVariables, declarationsForSave, detectTemplateVariables, emailVariableSource, normalizeVariableDeclarations,
  sampleValues, templateVariables, templateVariableSnapshot, unknownTemplateVariables, unmappedRequiredVariables,
} from '@/lib/email-editor/variables'
import { renderEmailTemplate, templateRenderVariables } from '@/lib/email-editor/render'
import { inlineCss, parseSelector, selectorMatches } from '@/lib/email-editor/inline-css'
import { compatibilityIssues, lintEmailHtml, sizeIssues, structureIssues, GMAIL_CLIP_BYTES } from '@/lib/email-editor/lint'
import { htmlToEmailText } from '@/lib/email-editor/html-to-text'
import { formatEmailHtml } from '@/lib/email-editor/format'
import { buildPreviewDocument, extractPreheader, forceDarkMediaRules, previewCsp, setPreheader } from '@/lib/email-editor/preview'
import { designToHtml, emptyDesign, newBlock, readDesign, sanitizeRichText, type EmailDesign } from '@/lib/email-editor/blocks'
import { starterContent, starterTemplates } from '@/lib/email-editor/starters'
import { variableCompletions } from '@/lib/email-editor/completions'
import { sanitizeEmailHtml } from '@/lib/email-templates'

describe('email template variables', () => {
  it('detects {{variables}} across subject, HTML and text in first-use order, ignoring functions', () => {
    expect(detectTemplateVariables('Hi {{first_name}}', '<p>{{amount}} {{first_name}} {{=UPPER(x)}}</p>', 'Due {{due_date}}'))
      .toEqual(['first_name', 'amount', 'due_date'])
  })

  it('classifies built-in, run-path and custom variables', () => {
    expect(emailVariableSource('user_task_title')).toBe('auto')
    expect(emailVariableSource('task_url')).toBe('auto')
    expect(emailVariableSource('form.amount')).toBe('run')
    expect(emailVariableSource('task_data.comment')).toBe('run')
    expect(emailVariableSource('approval_task_data.comment')).toBe('run')
    expect(emailVariableSource('customer_name')).toBe('custom')
  })

  it('flags unknown (undeclared custom) variables only', () => {
    expect(unknownTemplateVariables(['user_task_title', 'form.x', 'customer', 'amount'], [{ name: 'amount' }])).toEqual(['customer'])
  })

  it('merges declarations with detection and keeps unused declarations marked unused', () => {
    const vars = templateVariables(
      { subject: 'Order {{order_id}}', html_body: '<a href="{{task_url}}">{{customer_name}}</a>' },
      [{ name: 'customer_name', label: 'Customer', required: true, sample: 'Acme Corp' }, { name: 'old_one' }],
    )
    expect(vars.map((v) => [v.name, v.source, v.used])).toEqual([
      ['order_id', 'custom', true], ['task_url', 'auto', true], ['customer_name', 'custom', true], ['old_one', 'custom', false],
    ])
    expect(vars.find((v) => v.name === 'customer_name')).toMatchObject({ label: 'Customer', required: true, sample: 'Acme Corp' })
    expect(templateVariableSnapshot(vars).map((v) => v.name)).toEqual(['order_id', 'task_url', 'customer_name'])
  })

  it('stores declarations with details for used custom variables only (names are detected from the content)', () => {
    expect(declarationsForSave({ subject: '{{a}} {{user_task_title}}', html_body: '{{b}} {{c}} {{form.x}}' }, [{ name: 'b', label: 'Bee' }, { name: 'c' }, { name: 'gone', label: 'Gone' }]))
      .toEqual([{ name: 'b', label: 'Bee' }])
  })

  it('rejects malformed declarations', () => {
    expect(normalizeVariableDeclarations([{ name: '1bad' }, { name: 'ok', type: 'weird', required: 'yes' }, null, { name: 'ok' }])).toEqual([{ name: 'ok' }])
  })

  it('builds preview samples (USD) with placeholders for undeclared samples', () => {
    const vars = templateVariables({ subject: '{{x_total}}', html_body: '' }, [])
    const samples = sampleValues(vars)
    expect(samples.user_task_title).toBeTruthy()
    expect(samples.x_total).toBe('[X total]')
  })

  it('auto-maps custom variables to same-named data paths, never overwriting a mapping', () => {
    const vars = [{ name: 'amount', source: 'custom' as const }, { name: 'requester', source: 'custom' as const }, { name: 'task_url', source: 'auto' as const }]
    expect(autoMapVariables(vars, ['form.Amount', 'task_data.requester', 'task_url'], { requester: '{{x}}' })).toEqual({ amount: '{{form.Amount}}' })
  })

  it('reports required custom variables a step leaves unmapped', () => {
    const snapshot = [{ name: 'a', label: 'A', source: 'custom', required: true }, { name: 'b', label: 'B', source: 'custom' }, { name: 'c', label: 'C', source: 'auto', required: true }]
    expect(unmappedRequiredVariables(snapshot, { a: '  ' }).map((v) => v.name)).toEqual(['a'])
    expect(unmappedRequiredVariables(snapshot, { a: '{{form.a}}' })).toEqual([])
    expect(unmappedRequiredVariables(undefined, {})).toEqual([])
  })
})

describe('variable autocomplete', () => {
  it('completes after {{ with built-ins and declared variables', () => {
    const result = variableCompletions('<p>Hello {{user_t', [{ name: 'customer_name', label: 'Customer' }])
    expect(result?.from).toBe('<p>Hello {{'.length)
    expect(result?.options.map((o) => o.label)).toContain('user_task_title')
    expect(result?.options[0].apply).toMatch(/^user_task_\w+\}\}$/)
    const declared = variableCompletions('{{cust', [{ name: 'customer_name', label: 'Customer' }])
    expect(declared?.options.map((o) => o.label)).toEqual(['customer_name'])
    expect(variableCompletions('<p>no braces', [])).toBeNull()
  })
})

describe('template rendering with step mappings', () => {
  const ctx = { variables: { app_url: 'https://app.example.com/', user_task_id: 't1', form: { customer: 'Acme Corp', amount: 2400 }, customer_name: 'From run' } }

  it('fills link helpers and resolves mappings against the run', () => {
    const vars = templateRenderVariables(ctx, { customer_name: '{{form.customer}}', total: '${{form.amount}}.00', blank: '' })
    expect(vars.task_url).toBe('https://app.example.com/tasks/t1')
    expect(vars.current_year).toMatch(/^\d{4}$/)
    expect(vars.customer_name).toBe('Acme Corp')
    expect(vars.total).toBe('$2400.00')
    expect('blank' in vars).toBe(false)
    expect(ctx.variables).not.toHaveProperty('task_url') // the run is not modified
  })

  it('renders subject / HTML / text; unmapped variables keep reading the run (backwards compatible)', () => {
    const template = { subject: 'Order for {{customer_name}}', html_body: '<a href="{{task_url}}">{{total}}</a>', text_body: '{{customer_name}}' }
    expect(renderEmailTemplate(template, ctx, null)).toEqual({ subject: 'Order for From run', html: '<a href="https://app.example.com/tasks/t1"></a>', text: 'From run' })
    expect(renderEmailTemplate(template, ctx, { customer_name: '{{form.customer}}', total: '{{form.amount}}' }).html).toBe('<a href="https://app.example.com/tasks/t1">2400</a>')
  })
})

describe('CSS inliner', () => {
  it('parses and matches simple selectors', () => {
    const sel = parseSelector('.card > td.cta')!
    expect(sel.specificity).toEqual([0, 2, 1])
    expect(selectorMatches(sel, [{ name: 'table', id: null, classes: ['card'] }, { name: 'td', id: null, classes: ['cta'] }])).toBe(true)
    expect(selectorMatches(sel, [{ name: 'table', id: null, classes: ['card'] }, { name: 'tr', id: null, classes: [] }, { name: 'td', id: null, classes: ['cta'] }])).toBe(false)
    expect(parseSelector('a:hover')).toBeNull()
  })

  it('inlines rules by specificity, keeps existing inline styles, and preserves media queries / pseudo rules', () => {
    const html = '<html><head><style>p { color: red; margin: 0 } .lead { color: blue } a:hover { color: green } @media (prefers-color-scheme: dark) { .lead { color: white !important } }</style></head><body><p class="lead" style="margin:4px">Hi</p><p>Two</p></body></html>'
    const out = inlineCss(html)
    expect(out.html).toContain('<p class="lead" style="color:blue;margin:4px">Hi</p>')
    expect(out.html).toContain('<p style="color:red;margin:0">Two</p>')
    expect(out.html).toContain('a:hover')
    expect(out.html).toContain('@media (prefers-color-scheme: dark)')
    expect(out.inlined).toBe(2)
  })

  it('removes a style block that is fully inlined and leaves style-free HTML untouched', () => {
    expect(inlineCss('<style>td{padding:4px}</style><table><tr><td>x</td></tr></table>').html).toBe('<table><tr><td style="padding:4px">x</td></tr></table>')
    const plain = '<p style="color:red">x</p>'
    expect(inlineCss(plain).html).toBe(plain)
  })
})

describe('email HTML lint', () => {
  it('finds unclosed and stray tags but allows optional end tags', () => {
    const issues = structureIssues('<table><tr><td>One<td>Two</table><div><span>x</div></b>')
    expect(issues.map((i) => i.rule)).toEqual(['unclosed-tag', 'stray-close'])
    expect(issues[0].message).toContain('<span>')
    expect(structureIssues('<p>One<p>Two<br><img src="x">')).toEqual([])
  })

  it('warns about CSS / HTML common clients do not support', () => {
    const rules = compatibilityIssues('<div style="display:flex"></div><div style="display: grid"></div><link rel="stylesheet" href="x.css"><script>x</script><form></form><video></video><img src="a.png">').map((i) => i.rule)
    expect(rules).toEqual(expect.arrayContaining(['css-flex', 'css-grid', 'external-css', 'script', 'form', 'video', 'img-alt']))
  })

  it('warns when the HTML would be clipped by Gmail', () => {
    expect(sizeIssues('x'.repeat(GMAIL_CLIP_BYTES + 1))[0].rule).toBe('gmail-clip')
    expect(sizeIssues('<p>small</p>')).toEqual([])
  })

  it('flags unknown variables with their position', () => {
    const html = '<p>{{user_task_title}} {{mystery}}</p>'
    const issue = lintEmailHtml({ html }).find((i) => i.rule === 'unknown-variable')!
    expect(html.slice(issue.from, issue.to)).toBe('{{mystery}}')
    expect(lintEmailHtml({ html, declarations: [{ name: 'mystery' }] }).some((i) => i.rule === 'unknown-variable')).toBe(false)
  })
})

describe('html → text', () => {
  it('keeps structure, links, lists and variables; drops head, styles and preheader', () => {
    const html = setPreheader('<html><head><style>p{color:red}</style><title>T</title></head><body><h1>Hello {{first_name}}</h1><p>Your order &amp; receipt.</p><ul><li>One</li><li>Two</li></ul><p><a href="{{task_url}}">Open task</a></p><table><tr><td>Total</td><td>$2,400.00</td></tr></table><img src="x" alt="Logo"></body></html>', 'Hidden preview')
    expect(htmlToEmailText(html)).toBe('Hello {{first_name}}\n\nYour order & receipt.\n\n- One\n- Two\n\nOpen task ({{task_url}})\n\nTotal $2,400.00\n\nLogo')
  })
})

describe('format HTML', () => {
  it('indents block structure and is idempotent', () => {
    const out = formatEmailHtml('<table><tr><td>Hi <b>there</b></td></tr></table><p>x</p>')
    expect(out).toBe('<table>\n  <tr>\n    <td>Hi <b>there</b></td>\n  </tr>\n</table>\n<p>x</p>\n')
    expect(formatEmailHtml(out)).toBe(out)
  })
})

describe('preview document (sandboxed iframe)', () => {
  it('removes scripts, handlers, frames and base/refresh tags, and sets a no-script CSP', () => {
    const doc = buildPreviewDocument('<p onclick="x()">Hi</p><script>alert(1)</script><script src="https://evil.example/x.js"></script><iframe src="https://x"></iframe><meta http-equiv="refresh" content="0;url=https://x"><base href="https://evil.example/"><link rel="stylesheet" href="https://x/a.css">')
    expect(doc).not.toMatch(/<script/i)
    expect(doc).not.toMatch(/onclick/i)
    expect(doc).not.toMatch(/<iframe/i)
    expect(doc).not.toMatch(/http-equiv="refresh"/i)
    expect(doc).not.toMatch(/evil\.example/)
    expect(doc).not.toMatch(/<link/i)
    expect(doc).toContain("script-src 'none'")
    expect(doc).toContain("default-src 'none'")
  })

  it('blocks remote images when asked', () => {
    expect(previewCsp(false)).toContain('img-src data: cid:;')
    expect(previewCsp(true)).toContain('https:')
  })

  it('simulates dark mode with the template dark rules, else by inverting', () => {
    expect(forceDarkMediaRules('@media (prefers-color-scheme: dark) { .a{} } @media (prefers-color-scheme: light) { .b{} }').html).toBe('@media all { .a{} } @media not all { .b{} }')
    expect(buildPreviewDocument('<p>x</p>', { dark: true })).toContain('invert(1)')
    expect(buildPreviewDocument('<style>@media (prefers-color-scheme: dark){p{color:#fff}}</style><p>x</p>', { dark: true })).not.toContain('invert(1)')
  })

  it('shows subject and preheader above the body when asked, escaped', () => {
    const doc = buildPreviewDocument('<html><body><p>x</p></body></html>', { envelope: { subject: '<b>Hi</b>', preheader: 'Peek' } })
    expect(doc).toContain('&lt;b&gt;Hi&lt;/b&gt;')
    expect(doc).toContain('Peek')
  })

  it('round-trips the preheader', () => {
    const html = setPreheader('<html><body><p>x</p></body></html>', 'Peek {{first_name}}')
    expect(extractPreheader(html)).toBe('Peek {{first_name}}')
    expect(setPreheader(html, '')).toBe('<html><body><p>x</p></body></html>')
  })
})

describe('design blocks', () => {
  const design: EmailDesign = { ...emptyDesign({ accent: '#0F766E' }), blocks: ['header', 'heading', 'text', 'button', 'image', 'divider', 'spacer', 'columns', 'footer'].map((t) => newBlock(t as any)) }

  it('generates table-based, inline-styled HTML that survives the sanitiser and inliner unchanged', () => {
    const html = designToHtml(design)
    expect(html).toContain('role="presentation"')
    expect(html).toContain('bgcolor="#0F766E"')
    expect(html).toContain('<!--[if mso]>')
    expect(html).not.toMatch(/display:\s*flex|display:\s*grid/)
    expect(sanitizeEmailHtml(html)).toBe(html)
    expect(inlineCss(html).html).toBe(html)
  })

  it('round-trips: blocks come back editable, also after formatting and with a preheader', () => {
    const html = designToHtml(design)
    const read = readDesign(html)
    expect(read.editable).toBe(true)
    expect(read.design?.blocks).toEqual(design.blocks)
    expect(readDesign(formatEmailHtml(setPreheader(html, 'Peek'))).editable).toBe(true)
  })

  it('becomes read-only once the HTML is hand-edited beyond the blocks', () => {
    const edited = designToHtml(design).replace('</table>\n</td></tr>', '<tr><td>Hand-written</td></tr></table>\n</td></tr>')
    const read = readDesign(edited)
    expect(read.design).not.toBeNull()
    expect(read.editable).toBe(false)
    expect(readDesign('<p>plain</p>')).toEqual({ design: null, editable: false })
  })

  it('keeps only simple formatting in rich text and safe links', () => {
    expect(sanitizeRichText('<div>Hi <b>there</b> <a href="javascript:x">bad</a> <a href="{{task_url}}">ok</a><img src=x onerror=y><script>z</script></div>'))
      .toBe('<p>Hi <strong>there</strong> bad <a href="{{task_url}}">ok</a></p>')
  })
})

describe('starter templates', () => {
  it('are branded, design-editable, declare their variables and have a text part', () => {
    const starters = starterTemplates({ accent: '#7c3aed', workspaceName: 'Acme Operations', logoUrl: 'https://cdn.example.com/logo.png' })
    expect(starters.map((s) => s.id)).toEqual(['notification', 'approval', 'digest', 'welcome'])
    for (const starter of starters) {
      const content = starterContent(starter)
      expect(readDesign(content.html_body).editable).toBe(true)
      expect(content.html_body).toContain('https://cdn.example.com/logo.png')
      expect(content.text_body).not.toMatch(/<[a-z]/i)
      expect(unknownTemplateVariables(detectTemplateVariables(content.subject, content.html_body), content.variables)).toEqual([])
    }
    expect(starterContent(starters[1]).html_body).toContain('#7C3AED')
  })
})

describe('preview iframe element', () => {
  it('is sandboxed with no permissions and no referrer', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('components/email-templates/email-preview-frame.tsx', 'utf8')
    expect(src).toMatch(/<iframe[\s\S]*?sandbox=""[\s\S]*?referrerPolicy="no-referrer"/)
    expect(src).not.toMatch(/allow-scripts|allow-same-origin/)
  })
})
