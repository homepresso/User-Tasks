/**
 * Native form controls for InfoPath parity:
 *  - Rich text (lib/forms/rich-text.ts): the narrow sanitiser policy
 *    (scripts, handlers, javascript: / data: links removed; allowed tags
 *    kept), plain text in, the length cap on text, required, `<key>_text`;
 *  - Text list (lib/forms/text-list.ts): coercion and bounds;
 *  - URL link text (lib/forms/link-field.ts): display text, safe links,
 *    unsafe schemes rejected;
 *  - Person picker (lib/forms/people-field.ts): single (unchanged shape),
 *    multiple, teams; server membership check and names;
 *  - Multi-select display options.
 */
import { describe, expect, it } from 'vitest'
import { isBlankRichText, richTextPlainText, sanitizeRichText } from '@/lib/forms/rich-text'
import { textListItems, textListText } from '@/lib/forms/text-list'
import { urlLink, urlLinkText } from '@/lib/forms/link-field'
import { normalizePeopleValue, peopleText } from '@/lib/forms/people-field'
import { controlValueText } from '@/lib/forms/control-text'
import { sanitizeHtml } from '@/lib/html-sanitize'
import {
  coerceTaskFieldValues, defaultTaskFieldValues, fieldDefinitionProblems, mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues,
} from '@/lib/task-field-schema'
import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import { formatFieldValue } from '@/components/forms/form-renderer'
import { fieldSchema } from '@/lib/workflow-data-picker'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/* ── Rich text ───────────────────────────────────────────────────────── */

describe('rich text sanitising', () => {
  it('removes scripts, event handlers, styles and unsafe links', () => {
    const html = sanitizeRichText('<p onclick="x()">Hi <script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a> <a href=" JaVa&#x09;script:alert(1)">bad2</a> <a href="data:text/html,<b>x</b>">bad3</a><style>p{}</style><iframe src="https://evil"></iframe></p>')
    expect(html).not.toMatch(/script|onerror|onclick|<img|iframe|style|javascript|data:/i)
    expect(html).toContain('<p>Hi ')
    expect(html).toContain('bad')
    expect(html).not.toMatch(/href=/)
  })

  it('keeps the allowed tags; links https / mailto only, with rel noopener', () => {
    const html = sanitizeRichText('<h3>Title</h3><p><strong>b</strong> <b>b2</b> <em>i</em> <i>i2</i> <u>u</u> <s>s</s> <code>c</code></p><ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><h4>sub</h4><p><a href="https://example.com/a?b=1" title="t" class="x">ok</a> <a href="mailto:ada@example.com">mail</a> <a href="http://example.com">http</a> <a href="/relative">rel</a></p>')
    for (const tag of ['h3', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'ul', 'ol', 'li', 'blockquote', 'h4']) expect(html).toContain(`<${tag}>`)
    expect(html).toContain('<a href="https://example.com/a?b=1" rel="noopener noreferrer" target="_blank">ok</a>')
    expect(html).toContain('<a href="mailto:ada@example.com" rel="noopener noreferrer" target="_blank">mail</a>')
    expect(html).toContain('<a rel="noopener noreferrer" target="_blank">http</a>')
    expect(html).toContain('<a rel="noopener noreferrer" target="_blank">rel</a>')
    expect(html).not.toMatch(/title=|class=/)
  })

  it('maps editor markup onto the allowlist and unwraps the rest', () => {
    expect(sanitizeRichText('<div>one</div><div>two</div>')).toBe('<p>one</p><p>two</p>')
    expect(sanitizeRichText('<h1>Big</h1><h6>small</h6>')).toBe('<h3>Big</h3><h4>small</h4>')
    expect(sanitizeRichText('<p><span style="color:red">red</span> <font>f</font> <table><tr><td>cell</td></tr></table></p>')).toBe('<p>red f cell</p>')
    expect(sanitizeRichText('<p>a <strike>b</strike></p>')).toBe('<p>a <s>b</s></p>')
  })

  it('turns plain text into paragraphs and blanks into nothing; idempotent', () => {
    expect(sanitizeRichText('Line one\nLine <two> & three')).toBe('<p>Line one</p><p>Line &lt;two&gt; &amp; three</p>')
    expect(sanitizeRichText('<p><br></p>')).toBe('')
    expect(isBlankRichText('<p> </p><p><br></p>')).toBe(true)
    const once = sanitizeRichText('<p>x <a href="https://a.example">y</a></p><ul><li>z</li></ul>')
    expect(sanitizeRichText(once)).toBe(once)
    // The description sanitiser keeps its broader default policy.
    expect(sanitizeHtml('<div><img src="https://a.example/x.png"></div>')).toContain('<img')
  })

  it('plain text of a value', () => {
    expect(richTextPlainText('<p>Hello <strong>world</strong></p><ul><li>one</li><li>two</li></ul>')).toBe('Hello world\n- one\n- two')
    expect(richTextPlainText('<p>a<script>secret</script></p>')).toBe('a')
  })

  const fields = normalizeTaskFields([{ key: 'notes', label: 'Notes', type: 'rich_text', required: true, rich_text: { max_length: 10, toolbar: 'full' } }])

  it('normalizes its config', () => {
    expect(fields[0].rich_text).toEqual({ max_length: 10, toolbar: 'full' })
    expect(normalizeTaskFields([{ key: 'n', label: 'N', type: 'rich_text', rich_text: { max_length: 10_000_000, toolbar: 'weird' } }])[0].rich_text).toEqual({ max_length: 100_000 })
  })

  it('validates required (markup without text is blank) and the text length, not the markup', () => {
    expect(validateTaskFieldValues(fields, { notes: '<p><br></p>' }).notes).toMatch(/required/)
    expect(validateTaskFieldValues(fields, { notes: '<p><strong><em>0123456789</em></strong></p>' })).toEqual({})
    expect(validateTaskFieldValues(fields, { notes: '<p>01234567890</p>' }).notes).toMatch(/at most 10 characters/)
    expect(validateTaskFieldValues(fields, { notes: ['x'] }).notes).toMatch(/must be text/)
    expect(validateTaskFieldValues(normalizeTaskFields([{ key: 'n', label: 'N', type: 'rich_text' }]), { n: `<p>${'a'.repeat(20_001)}</p>` }).n).toMatch(/at most 20000/)
  })

  it('stores sanitised HTML and <key>_text on submit (never the browser HTML)', () => {
    const meta = { fields: [{ key: 'notes', label: 'Notes', type: 'rich_text' }] }
    const { errors, templateValues } = mergeTaskFieldValues(meta, { notes: '<p>Hi <b>there</b><img src=x onerror=alert(1)></p>' })
    expect(errors).toEqual({})
    expect(templateValues.notes).toBe('<p>Hi <b>there</b></p>')
    expect(templateValues.notes_text).toBe('Hi there')
    expect(coerceTaskFieldValues(normalizeTaskFields(meta.fields), { notes: '<p></p>' }).notes).toBeNull()
  })

  it('flags a field already using <key>_text', () => {
    const problems = fieldDefinitionProblems(normalizeTaskFields([{ key: 'notes', label: 'Notes', type: 'rich_text' }, { key: 'notes_text', label: 'Other', type: 'text' }]))
    expect(problems.notes).toMatch(/notes_text/)
  })

  it('formats as plain text and shows its plain-text key in the data picker', () => {
    expect(formatFieldValue(fields[0], '<p>One</p><p>Two</p>')).toBe('One\nTwo')
    expect(fieldSchema(fields[0]).description).toMatch(/notes_text/)
  })
})

/* ── Text list ───────────────────────────────────────────────────────── */

describe('text list', () => {
  const fields = normalizeTaskFields([{ key: 'steps', label: 'Steps', type: 'text_list', required: true, text_list: { style: 'numbered', min_items: 2, max_items: 3, item_max_length: 5 } }])

  it('coerces arrays, newline text and JSON arrays; drops blanks', () => {
    expect(textListItems(['  a ', '', null, 'b', 3])).toEqual(['a', 'b', '3'])
    expect(textListItems('first\r\n\nsecond\n  ')).toEqual(['first', 'second'])
    expect(textListItems('["x, y", "z"]')).toEqual(['x, y', 'z'])
    expect(coerceTaskFieldValues(fields, { steps: 'one\ntwo\n\n' }).steps).toEqual(['one', 'two'])
    expect(coerceTaskFieldValues(fields, { steps: null }).steps).toEqual([])
    expect(defaultTaskFieldValues(fields).steps).toEqual([])
    expect(defaultTaskFieldValues(normalizeTaskFields([{ key: 'l', label: 'L', type: 'text_list', default: ['a', 'b, c'] }])).l).toEqual(['a', 'b, c'])
  })

  it('validates required, min / max items and item length', () => {
    expect(validateTaskFieldValues(fields, { steps: ['', ' '] }).steps).toMatch(/required/)
    expect(validateTaskFieldValues(fields, { steps: ['a'] }).steps).toMatch(/at least 2 items/)
    expect(validateTaskFieldValues(fields, { steps: ['a', 'b', 'c', 'd'] }).steps).toMatch(/at most 3 items/)
    expect(validateTaskFieldValues(fields, { steps: ['a', 'toolong'] }).steps).toMatch(/item 2 is longer than 5/)
    expect(validateTaskFieldValues(fields, { steps: ['a', ''] , }).steps).toMatch(/at least 2/)
    expect(validateTaskFieldValues(fields, { steps: ['a', 'b', ''] })).toEqual({})
    expect(validateTaskFieldValues(fields, { steps: [{ x: 1 }] }).steps).toMatch(/list of text items/)
    expect(validateTaskFieldValues(normalizeTaskFields([{ key: 'l', label: 'L', type: 'text_list' }]), { l: Array.from({ length: 51 }, (_, i) => `i${i}`) }).l).toMatch(/at most 50/)
  })

  it('normalizes its config and flags min > max', () => {
    expect(fields[0].text_list).toEqual({ style: 'numbered', min_items: 2, max_items: 3, item_max_length: 5 })
    expect(normalizeTaskFields([{ key: 'l', label: 'L', type: 'text_list', text_list: { style: 'x', max_items: 9999 } }])[0].text_list).toEqual({ max_items: 500 })
    expect(fieldDefinitionProblems(normalizeTaskFields([{ key: 'l', label: 'L', type: 'text_list', text_list: { min_items: 5, max_items: 2 } }])).l).toMatch(/Minimum items/)
  })

  it('displays with its markers', () => {
    expect(textListText(['a', 'b'], 'numbered')).toBe('1. a\n2. b')
    expect(textListText(['a', 'b'])).toBe('• a\n• b')
    expect(textListText(['a', 'b'], 'plain')).toBe('a\nb')
    expect(formatFieldValue(fields[0], ['a', 'b'])).toBe('1. a\n2. b')
    expect(controlValueText(fields[0], ['a', 'b'], { csv: true })).toBe('a\nb')
  })
})

/* ── URL link text ───────────────────────────────────────────────────── */

describe('url link display', () => {
  const fields = normalizeTaskFields([
    { key: 'contract_name', label: 'Contract name', type: 'text' },
    { key: 'contract', label: 'Contract', type: 'url', url_config: { text_field: 'contract_name', link_text: 'Open the contract', new_tab: false } },
    { key: 'site', label: 'Site', type: 'url', url_config: { link_text: '  Our   site ' } },
  ])

  it('normalizes url_config', () => {
    expect(fields[1].url_config).toEqual({ text_field: 'contract_name', link_text: 'Open the contract', new_tab: false })
    expect(fields[2].url_config).toEqual({ link_text: 'Our site' })
    expect(normalizeTaskFields([{ key: 'u', label: 'U', type: 'url', url_config: { junk: 1 } }])[0].url_config).toBeUndefined()
    expect(normalizeTaskFields([{ key: 't', label: 'T', type: 'text', url_config: { link_text: 'x' } }])[0].url_config).toBeUndefined()
  })

  it('shows the text field, then the static text, then the URL', () => {
    expect(urlLink(fields[1], 'https://example.com/c.pdf', { contract_name: 'MSA 2026' })).toEqual({ href: 'https://example.com/c.pdf', text: 'MSA 2026', newTab: false })
    expect(urlLink(fields[1], 'https://example.com/c.pdf', { contract_name: '' })?.text).toBe('Open the contract')
    expect(urlLink(fields[2], 'mailto:sales@example.com')).toEqual({ href: 'mailto:sales@example.com', text: 'Our site', newTab: true })
    expect(urlLink({}, 'https://example.com')?.text).toBe('https://example.com')
    expect(urlLinkText(fields[2], 'https://example.com')).toBe('Our site (https://example.com)')
    expect(formatFieldValue(fields[2], 'https://example.com')).toBe('Our site (https://example.com)')
    expect(urlLink(fields[2], '')).toBeNull()
  })

  it('never links an unsafe scheme', () => {
    expect(urlLink(fields[2], 'javascript:alert(1)')?.href).toBeNull()
    expect(urlLink(fields[2], 'java\tscript:alert(1)')?.href).toBeNull()
    expect(urlLink(fields[2], 'data:text/html,hi')?.href).toBeNull()
  })

  it('rejects unsafe schemes on submit; https, http and mailto pass', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com', 'vbscript:x', 'not a url']) {
      expect(validateTaskFieldValues(fields, { site: bad }).site, bad).toMatch(/http\(s\) URL/)
    }
    for (const ok of ['https://example.com', 'http://example.com', 'mailto:ada@example.com']) expect(validateTaskFieldValues(fields, { site: ok }), ok).toEqual({})
  })

  it('flags a link text field that is missing or not text', () => {
    expect(fieldDefinitionProblems(normalizeTaskFields([{ key: 'u', label: 'U', type: 'url', url_config: { text_field: 'nope' } }])).u).toMatch(/not a field/)
    expect(fieldDefinitionProblems(normalizeTaskFields([{ key: 'n', label: 'N', type: 'number' }, { key: 'u', label: 'U', type: 'url', url_config: { text_field: 'n' } }])).u).toMatch(/not a text field/)
    expect(fieldDefinitionProblems(fields)).toEqual({})
  })
})

/* ── Person / group picker ───────────────────────────────────────────── */

/** A tiny Supabase stand-in: users, memberships and teams of two workspaces. */
function fakeDb() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    user_memberships: [{ user_id: u(1), tenant_id: 't1', is_active: true }, { user_id: u(2), tenant_id: 't1', is_active: true }, { user_id: u(3), tenant_id: 't2', is_active: true }],
    users: [{ id: u(1), display_name: 'Ada Lovelace', email: 'ada@example.com', tenant_id: 't1' }, { id: u(2), display_name: null, email: 'grace@example.com', tenant_id: 't1' }, { id: u(3), display_name: 'Other', email: 'o@example.com', tenant_id: 't2' }],
    teams: [{ id: u(10), name: 'Finance', tenant_id: 't1' }, { id: u(11), name: 'Elsewhere', tenant_id: 't2' }],
  }
  return {
    from(table: string) {
      let rows = tables[table] ?? []
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { rows = rows.filter((r) => r[col] === v); return q },
        in: (col: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[col])); return q },
        then: (resolve: (v: { data: unknown[] }) => unknown) => resolve({ data: rows }),
      }
      return q
    },
  }
}

describe('person / group picker', () => {
  const single = { key: 'owner', label: 'Owner', type: 'user' }
  const many = { key: 'reviewers', label: 'Reviewers', type: 'user', user_config: { multiple: true, max: 2 } }
  const withTeams = { key: 'approvers', label: 'Approvers', type: 'user', user_config: { multiple: true, allow_teams: true } }
  const oneOrTeam = { key: 'handler', label: 'Handler', type: 'user', user_config: { allow_teams: true } }
  const fields = normalizeTaskFields([single, many, withTeams, oneOrTeam])

  it('normalizes user_config (max only with multiple)', () => {
    expect(fields[0].user_config).toBeUndefined()
    expect(fields[1].user_config).toEqual({ multiple: true, max: 2 })
    expect(fields[3].user_config).toEqual({ allow_teams: true })
    expect(normalizeTaskFields([{ key: 'p', label: 'P', type: 'user', user_config: { max: 5 } }])[0].user_config).toBeUndefined()
  })

  it('single person: the value is still one user id string', () => {
    expect(coerceTaskFieldValues([fields[0]], { owner: u(1) }).owner).toBe(u(1))
    expect(validateTaskFieldValues([fields[0]], { owner: 'nope' }).owner).toMatch(/person in this workspace/)
    expect(defaultTaskFieldValues([fields[0]]).owner).toBeNull()
  })

  it('people lists: references from ids, prefixed ids and objects; deduped', () => {
    expect(normalizePeopleValue([u(1), `team:${u(10)}`, { kind: 'user', id: u(1) }, { id: u(2), name: 'G' }, 'junk'])).toEqual([
      { kind: 'user', id: u(1) }, { kind: 'team', id: u(10) }, { kind: 'user', id: u(2), name: 'G' },
    ])
    expect(normalizePeopleValue(`${u(1)}, ${u(2)}`)).toHaveLength(2)
    expect(coerceTaskFieldValues([fields[1]], { reviewers: u(1) }).reviewers).toEqual([{ kind: 'user', id: u(1) }])
    expect(defaultTaskFieldValues([fields[1]]).reviewers).toEqual([])
  })

  it('validates kinds, count and shape', () => {
    expect(validateTaskFieldValues([fields[1]], { reviewers: [u(1), u(2)] })).toEqual({})
    expect(validateTaskFieldValues([fields[1]], { reviewers: [u(1), u(2), u(3)] }).reviewers).toMatch(/at most 2/)
    expect(validateTaskFieldValues([fields[1]], { reviewers: [`team:${u(10)}`] }).reviewers).toMatch(/not teams/)
    expect(validateTaskFieldValues([fields[1]], { reviewers: ['junk'] }).reviewers).toMatch(/must be people/)
    expect(validateTaskFieldValues([fields[2]], { approvers: [`team:${u(10)}`, u(1)] })).toEqual({})
    expect(validateTaskFieldValues([fields[3]], { handler: [`team:${u(10)}`, u(1)] }).handler).toMatch(/choose one/)
    expect(validateTaskFieldValues([{ ...fields[1], required: true }], { reviewers: [] }).reviewers).toMatch(/required/)
  })

  it('the server keeps workspace people / teams only and sets their names (never the browser’s)', async () => {
    const meta = { fields: [single, many, withTeams] }
    const ok = await mergeTaskFieldValuesChecked(fakeDb() as never, 't1', meta, {
      owner: u(1), reviewers: [{ kind: 'user', id: u(2), name: 'Spoofed' }], approvers: [`team:${u(10)}`, u(1)],
    })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues.owner).toBe(u(1))
    expect(ok.templateValues.reviewers).toEqual([{ kind: 'user', id: u(2), name: 'grace@example.com' }])
    expect(ok.templateValues.approvers).toEqual([{ kind: 'team', id: u(10), name: 'Finance' }, { kind: 'user', id: u(1), name: 'Ada Lovelace' }])

    const bad = await mergeTaskFieldValuesChecked(fakeDb() as never, 't1', meta, { owner: u(3), reviewers: [u(3)], approvers: [`team:${u(11)}`] })
    expect(bad.errors.owner).toMatch(/person in this workspace/)
    expect(bad.errors.reviewers).toMatch(/must be people in this workspace/)
    expect(bad.errors.approvers).toMatch(/people or teams in this workspace/)
  })

  it('displays names', () => {
    const value = [{ kind: 'user', id: u(1), name: 'Ada Lovelace' }, { kind: 'team', id: u(10), name: 'Finance' }]
    expect(peopleText(value)).toBe('Ada Lovelace, Finance')
    expect(formatFieldValue(fields[2], value)).toBe('Ada Lovelace, Finance')
    expect(formatFieldValue(fields[0], u(1), new Map([[u(1), 'Ada']]))).toBe('Ada')
    expect(fieldSchema(fields[2]).type).toBe('array')
    expect(fieldSchema(fields[0]).type).toBe('string')
  })
})

/* ── Multi-select display ────────────────────────────────────────────── */

describe('multi-select display', () => {
  it('keeps checkboxes / listbox for multi_choice only', () => {
    const [a, b, c] = normalizeTaskFields([
      { key: 'a', label: 'A', type: 'multi_choice', options: ['x'], display: 'listbox' },
      { key: 'b', label: 'B', type: 'multi_choice', options: ['x'], display: 'checkboxes' },
      { key: 'c', label: 'C', type: 'choice', options: ['x'], display: 'listbox' },
    ])
    expect(a.display).toBe('listbox')
    expect(b.display).toBe('checkboxes')
    expect(c.display).toBeUndefined()
  })
})

describe('rich text editor markup', () => {
  it('puts loose text beside blocks in paragraphs and lifts blocks out of paragraphs', () => {
    expect(sanitizeRichText('Quarterly <b>review</b>&nbsp;now.<p><ul><li>One</li><li>Two</li></ul></p>'))
      .toBe('<p>Quarterly <b>review</b>&nbsp;now.</p><ul><li>One</li><li>Two</li></ul>')
    expect(sanitizeRichText('<p>a<h3>b</h3>c</p>')).toBe('<p>a</p><h3>b</h3><p>c</p>')
    expect(sanitizeRichText('<ul><li>x</li></ul> <br> tail')).toBe('<ul><li>x</li></ul><p><br> tail</p>')
    const once = sanitizeRichText('lead<p>x</p>')
    expect(once).toBe('<p>lead</p><p>x</p>')
    expect(sanitizeRichText(once)).toBe(once)
  })
})
