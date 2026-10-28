import { describe, expect, it } from 'vitest'
import {
  ALLOWED_HTML_TAGS, descriptionToHtml, escapeHtml, htmlToPlainText, looksLikeHtml, sanitizeHtml, sanitizeTaskDescription,
} from '@/lib/html-sanitize'
import { resolveExpression } from '@/lib/expression-resolver'
import { resolveTaskDescriptionTemplate } from '@/lib/task-description'
import { wantsStrippedHtml, withDescriptionText, withDescriptionTexts } from '@/lib/task-description-format'
import { normalizeTaskFieldValue } from '@/lib/task-fields'

/** Nothing executable may survive: no script-capable element, handler or URL scheme. */
function expectInert(html: string) {
  // Text is escaped, so every literal `<` starts a real tag: inspect those.
  const tags = html.match(/<[^>]*>?/g) ?? []
  for (const tag of tags) {
    expect(tag).toMatch(/^<\/?(p|br|div|span|hr|strong|b|em|i|u|s|sub|sup|a|ul|ol|li|h[1-4]|blockquote|code|pre|table|thead|tbody|tr|th|td|img)[\s>]/)
    expect(tag).not.toMatch(/\son[a-z]+\s*=/i)
    expect(tag).not.toMatch(/(javascript|vbscript|data):/i)
    expect(tag).not.toMatch(/\sstyle\s*=/i)
  }
}

const XSS_CORPUS = [
  '<script>alert(1)</script>',
  '<SCRIPT SRC=https://evil.example/x.js></SCRIPT>',
  '<img src=x onerror=alert(1)>',
  '<img src="javascript:alert(1)">',
  '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="JaVaScRiPt:alert(1)">x</a>',
  '<a href="jav&#x61;script:alert(1)">x</a>',
  '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#106avascript:alert(1)">x</a>',
  '<a href="java\tscript:alert(1)">x</a>',
  '<a href=" \njavascript:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<svg onload=alert(1)><circle r=1 /></svg>',
  '<svg><script>alert(1)</script></svg>',
  '<math><mi xlink:href="javascript:alert(1)">m</mi></math>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '<p style="width: expression(alert(1))">x</p>',
  '<style>@import "https://evil.example/x.css";</style>',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="https://evil.example/x.swf"></object><embed src="https://evil.example/x.swf">',
  '<form action="https://evil.example"><input name=a><button>go</button></form>',
  '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<link rel=stylesheet href="https://evil.example/x.css">',
  '<scr<script>ipt>alert(1)</script>',
  '<<script>script>alert(1)<</script>/script>',
  '<!-- <script>alert(1)</script> -->',
  '<![CDATA[<script>alert(1)</script>]]>',
  '<b onmouseover="alert(1)">x</b>',
  '<b/onmouseover=alert(1)>x</b>',
  '<a href="https://ok.example" onclick="alert(1)">x</a>',
  '<template><img src=x onerror=alert(1)></template>',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<textarea><script>alert(1)</script></textarea>',
  '<p title="a" onclick=alert(1) title="b">x</p>',
  '<img src="https://ok.example/a.png" onerror="alert(1)">',
  '<a href="https://ok.example/?q=1" target="_self" rel="opener">x</a>',
  '<div><svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<p>unterminated <a href="javascript:alert(1)',
  '"><script>alert(1)</script>',
]

describe('sanitizeHtml: XSS corpus', () => {
  it.each(XSS_CORPUS)('neutralises %s', (payload) => {
    const clean = sanitizeHtml(payload)
    expectInert(clean)
    // Idempotent: re-sanitising (render-time defence) changes nothing.
    expect(sanitizeHtml(clean)).toBe(clean)
  })

  it('drops dangerous elements with their content, unwraps other HTML elements, keeps pseudo-tags as text', () => {
    expect(sanitizeHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>')
    expect(sanitizeHtml('<svg onload=alert(1)><circle/></svg>after')).toBe('after')
    expect(sanitizeHtml('<font color=red>red</font> <center>c</center>')).toBe('red c')
    expect(sanitizeHtml('use <customer name> here')).toBe('use &lt;customer name&gt; here')
    expect(sanitizeHtml('x < y && a > b')).toBe('x &lt; y &amp;&amp; a &gt; b')
    expect(sanitizeHtml('<script>never closed')).toBe('')
  })

  it('keeps the allowlist with safe attributes only', () => {
    expect(ALLOWED_HTML_TAGS).toEqual(expect.arrayContaining(['p', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h1', 'h4', 'blockquote', 'code', 'pre', 'table', 'td', 'img']))
    const html = '<h2>Title</h2><p class="x" id="y">A <strong>b</strong> <em>c</em> <u>u</u> <s>s</s><br/>next</p>'
      + '<ul><li>One</li></ul><ol start="3"><li>Two</li></ol><blockquote>q</blockquote><pre><code>x = 1</code></pre><hr>'
      + '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="x">d</td></tr></tbody></table>'
    expect(sanitizeHtml(html)).toBe('<h2>Title</h2><p>A <strong>b</strong> <em>c</em> <u>u</u> <s>s</s><br>next</p>'
      + '<ul><li>One</li></ul><ol start="3"><li>Two</li></ol><blockquote>q</blockquote><pre><code>x = 1</code></pre><hr>'
      + '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>')
  })

  it('links: http(s)/mailto/relative only, forced rel + target; attribute values re-encoded', () => {
    expect(sanitizeHtml('<a href="https://ok.example/?a=1&amp;b=2" title="a &quot;q&quot;">ok</a>'))
      .toBe('<a href="https://ok.example/?a=1&amp;b=2" title="a &quot;q&quot;" rel="noopener noreferrer" target="_blank">ok</a>')
    expect(sanitizeHtml('<a href="mailto:a@b.example">m</a>')).toContain('href="mailto:a@b.example"')
    expect(sanitizeHtml('<a href="/tasks/1">r</a>')).toContain('href="/tasks/1"')
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener noreferrer" target="_blank">x</a>')
  })

  it('images: absolute https only (dropped otherwise), numeric sizes', () => {
    expect(sanitizeHtml('<img src="https://cdn.example/a.png" alt="A" width="20" height="big" style="x">'))
      .toBe('<img src="https://cdn.example/a.png" alt="A" width="20">')
    expect(sanitizeHtml('<img src="http://cdn.example/a.png">')).toBe('')
    expect(sanitizeHtml('<img src="//cdn.example/a.png">')).toBe('')
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).toBe('')
  })

  it('balances tags and ignores stray closers', () => {
    expect(sanitizeHtml('<b><i>unclosed')).toBe('<b><i>unclosed</i></b>')
    expect(sanitizeHtml('</p>text</b><em>x</strong></em>')).toBe('text<em>x</em>')
  })

  it('keeps character references in text, escapes bare ampersands', () => {
    expect(sanitizeHtml('&lt;script&gt; &amp; AT&T &#169;')).toBe('&lt;script&gt; &amp; AT&amp;T &#169;')
  })
})

describe('plain text and rendering', () => {
  it('looksLikeHtml spots markup and character references only', () => {
    expect(looksLikeHtml('<p>x</p>')).toBe(true)
    expect(looksLikeHtml('a &amp; b')).toBe(true)
    expect(looksLikeHtml('Fish & chips, x < y')).toBe(false)
  })

  it('descriptionToHtml escapes plain text and keeps its line breaks; sanitises HTML', () => {
    expect(descriptionToHtml('line 1\nline 2 & <x')).toBe('line 1<br>line 2 &amp; &lt;x')
    expect(descriptionToHtml('<p>A</p>\n<script>x</script>')).toBe('<p>A</p>\n')
    expect(descriptionToHtml('use &lt;name&gt;\nnext')).toBe('use &lt;name&gt;<br>next')
    expect(descriptionToHtml('')).toBe('')
  })

  it('htmlToPlainText: plain text unchanged, HTML → readable text without script content', () => {
    expect(htmlToPlainText('Fish & chips\nx < y')).toBe('Fish & chips\nx < y')
    expect(htmlToPlainText('<h2>Order</h2><p>Ship <strong>today</strong> &amp; invoice</p><ul><li>One</li><li>Two</li></ul><script>steal()</script>'))
      .toBe('Order\nShip today & invoice\n- One\n- Two')
    expect(htmlToPlainText('a<br>b&nbsp;c')).toBe('a\nb c')
    expect(htmlToPlainText(null)).toBe('')
  })

  it('sanitizeTaskDescription stores plain text as is and sanitises HTML', () => {
    expect(sanitizeTaskDescription('Fish & chips\nnext')).toBe('Fish & chips\nnext')
    expect(sanitizeTaskDescription('<p onclick="x">Hi</p><script>x</script>')).toBe('<p>Hi</p>')
    expect(sanitizeTaskDescription(null)).toBeNull()
    expect(sanitizeTaskDescription(undefined)).toBeUndefined()
    expect(normalizeTaskFieldValue('description', '<img src=x onerror=alert(1)>ok')).toBe('ok')
    expect(normalizeTaskFieldValue('title', '<b>kept</b>')).toBe('<b>kept</b>')
  })

  it('escapeHtml escapes all markup-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('user_task description templates: interpolation escaping', () => {
  const ctx = { variables: { name: '<img src=x onerror=alert(1)>Bob', company: 'Fish & Co', amount: 12.5, note: 'a < b' } }

  it('the resolver escape option applies to variables and function results', () => {
    expect(resolveExpression('<p>{{name}}</p>', { ...ctx, escape: escapeHtml })).toBe('<p>&lt;img src=x onerror=alert(1)&gt;Bob</p>')
    expect(resolveExpression('{{=UPPER(company)}}', { ...ctx, escape: escapeHtml })).toBe('FISH &amp; CO')
    expect(resolveExpression('{{company}}', { ...ctx, escape: escapeHtml })).toBe('Fish &amp; Co')
    // Without the option nothing changes.
    expect(resolveExpression('{{amount}}', ctx)).toBe(12.5)
  })

  it('HTML templates escape every interpolated value', () => {
    const out = resolveTaskDescriptionTemplate('<p>Approve <strong>{{name}}</strong> for {{company}}</p>', ctx)
    expect(out).toBe('<p>Approve <strong>&lt;img src=x onerror=alert(1)&gt;Bob</strong> for Fish &amp; Co</p>')
    expectInert(descriptionToHtml(out))
  })

  it('plain-text templates resolve as before unless a value carries markup', () => {
    expect(resolveTaskDescriptionTemplate('Approve {{company}} for {{amount}}', ctx)).toBe('Approve Fish & Co for 12.5')
    const out = resolveTaskDescriptionTemplate('Approve {{name}} ({{note}})', ctx)
    expect(out).toBe('Approve &lt;img src=x onerror=alert(1)&gt;Bob (a &lt; b)')
    expect(htmlToPlainText(out)).toBe('Approve <img src=x onerror=alert(1)>Bob (a < b)')
    expect(resolveTaskDescriptionTemplate(undefined, ctx)).toBe('')
  })

  it('markup written directly in the template is still sanitised', () => {
    expect(resolveTaskDescriptionTemplate('<p>{{company}}</p><script>alert(1)</script>', ctx)).toBe('<p>Fish &amp; Co</p>')
  })
})

describe('API description formatting', () => {
  it('adds description_text and replaces description with strip_html', () => {
    const task = { id: 't1', description: '<p>Hello <b>you</b></p>' }
    expect(withDescriptionText(task)).toEqual({ id: 't1', description: '<p>Hello <b>you</b></p>', description_text: 'Hello you' })
    expect(withDescriptionText(task, true)).toEqual({ id: 't1', description: 'Hello you', description_text: 'Hello you' })
    expect(withDescriptionText({ id: 't2', description: null })).toEqual({ id: 't2', description: null, description_text: null })
    expect(withDescriptionText({ id: 't3' })).toEqual({ id: 't3' })
    expect(withDescriptionTexts(null)).toEqual([])
  })

  it('parses the strip_html flag', () => {
    expect(['true', '1', 'yes', 'TRUE'].map(wantsStrippedHtml)).toEqual([true, true, true, true])
    expect(['false', '', null, undefined, '0'].map(wantsStrippedHtml)).toEqual([false, false, false, false, false])
    expect(wantsStrippedHtml(true)).toBe(true)
  })
})
