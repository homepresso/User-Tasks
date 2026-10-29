import { describe, expect, it } from 'vitest'
import { diffJson, diffRows, diffText, redlineBlocks } from '@/lib/documents/diff'
import { writeDocx } from '@/lib/documents/docx'
import { readDocument } from '@/lib/documents/read'
import type { Block } from '@/lib/documents/model'

/** Compare documents: text modes with stats, keyed spreadsheet diffs, JSON paths, reports and redlines. */

const V1 = 'Supply Agreement\nThe term is 12 months.\nPayment within 30 days.\nGoverning law: New Zealand.\n'
const V2 = 'Supply Agreement\nThe term is 24 months.\nPayment within 30 days.\nGoverning law: New Zealand.\nTermination on 90 days notice.\n'

describe('text diff', () => {
  it('lines: stats, changes with line numbers, unified diff, similarity, side-by-side report', async () => {
    const r = await diffText(V1, V2, { mode: 'lines', oldName: 'v1.docx', newName: 'v2.docx' })
    expect(r.identical).toBe(false)
    expect(r.stats).toMatchObject({ changed: 1, added: 1, removed: 0, added_lines: 2, removed_lines: 1 })
    expect(r.changes).toEqual([
      { type: 'changed', old_text: 'The term is 12 months.\n', new_text: 'The term is 24 months.\n', old_line: 2, new_line: 2 },
      { type: 'added', new_text: 'Termination on 90 days notice.\n', new_line: 5 },
    ])
    expect(r.unified).toContain('--- v1.docx')
    expect(r.unified).toContain('-The term is 12 months.')
    expect(r.unified).toContain('+The term is 24 months.')
    expect(r.similarity).toBeGreaterThan(70)
    expect(r.similarity).toBeLessThan(100)
    expect(r.html).toContain('1 changed · 1 added · 0 removed')
    expect(r.html).toMatch(/text-decoration:line-through">12</)
    expect(r.html).toMatch(/text-decoration:underline">24</)
  })

  it('words and characters', async () => {
    const w = await diffText('the quick brown fox', 'the quick red fox', { mode: 'words' })
    expect(w.changes).toEqual([{ type: 'changed', old_text: 'brown', new_text: 'red' }])
    expect(w.stats).toMatchObject({ added_words: 1, removed_words: 1 })
    const c = await diffText('colour', 'color', { mode: 'characters' })
    expect(c.changes).toEqual([{ type: 'removed', old_text: 'u' }])
    expect(c.similarity).toBe(90.9)
  })

  it('identical texts, and ignore whitespace / case / punctuation', async () => {
    expect((await diffText('Same text', 'Same text')).identical).toBe(true)
    expect((await diffText('Hello,  World!', 'hello world', { mode: 'words', ignoreCase: true, ignorePunctuation: true, ignoreWhitespace: true })).identical).toBe(true)
    expect((await diffText('a  b\n', 'a b\n', { mode: 'lines', ignoreWhitespace: true })).identical).toBe(true)
    expect((await diffText('Hello', 'hello', { mode: 'words' })).identical).toBe(false)
  })

  it('report HTML is built from escaped text only', async () => {
    const r = await diffText('<b>safe</b>', '<script>alert(1)</script><img src=x onerror=alert(2)>', { mode: 'lines' })
    expect(r.html).not.toMatch(/<script|<img|<b>/)
    expect(r.html).toContain('&lt;')
    expect(r.html).toContain('alert(1)')
    expect(r.inline_html).not.toMatch(/<script|<img/)
  })
})

describe('spreadsheet diff (keyed)', () => {
  const v1 = [
    { OrderID: 10248, Customer: 'VINET', Qty: 12, Price: 14 },
    { OrderID: 10249, Customer: 'TOMSP', Qty: 9, Price: 18.6 },
    { OrderID: 10250, Customer: 'HANAR', Qty: 10, Price: 7.7 },
  ]
  const v2 = [
    { OrderID: 10249, Customer: 'TOMSP', Qty: 10, Price: 18.6 },
    { OrderID: 10248, Customer: 'vinet ', Qty: 12, Price: 14.001 },
    { OrderID: 10251, Customer: 'VICTE', Qty: 6, Price: 16.8 },
  ]

  it('matches rows by key, reports added / removed / changed rows with per-column old and new', () => {
    const r = diffRows(v1, v2, { keyColumns: ['OrderID'] })
    expect(r.stats).toMatchObject({ rows_old: 3, rows_new: 3, added: 1, removed: 1, changed: 2, unchanged: 0, cells_changed: 3 })
    const byType = (t: string) => r.changes.filter((c) => c.type === t)
    expect(byType('removed')[0]).toMatchObject({ key: { OrderID: 10250 }, old_row: 3 })
    expect(byType('added')[0]).toMatchObject({ key: { OrderID: 10251 }, new_row: 3, new: { Customer: 'VICTE' } })
    expect(byType('changed').find((c) => c.key.OrderID === 10249)!.columns).toEqual([{ column: 'Qty', old: 9, new: 10 }])
    expect(r.html).toContain('Spreadsheet comparison')
  })

  it('tolerances and ignore options; ignored columns; positional when there is no key', () => {
    const r = diffRows(v1, v2, { keyColumns: ['OrderID'], ignoreCase: true, ignoreWhitespace: true, numericTolerance: 0.01, ignoreColumns: ['Qty'] })
    expect(r.stats).toMatchObject({ changed: 0, unchanged: 2, added: 1, removed: 1 })
    const p = diffRows([{ a: 1 }, { a: 2 }], [{ a: 1 }, { a: 3 }])
    expect(p.changes).toEqual([{ type: 'changed', key: { row: 2 }, old_row: 2, new_row: 2, columns: [{ column: 'a', old: 2, new: 3 }] }])
  })

  it('reports column changes and duplicate keys', () => {
    const r = diffRows([{ id: 1, a: 'x' }, { id: 1, a: 'y' }], [{ id: 1, b: 'x' }], { keyColumns: ['id'] })
    expect(r.stats.columns_added).toEqual(['b'])
    expect(r.stats.columns_removed).toEqual(['a'])
    expect(r.warnings.join(' ')).toMatch(/Duplicate key/)
  })
})

describe('JSON diff', () => {
  it('deep paths for added / removed / changed values, arrays by position or key', () => {
    const a = { customer: { name: 'Alfreds', city: 'Berlin' }, lines: [{ sku: 'A', qty: 1 }, { sku: 'B', qty: 2 }], tags: ['x'] }
    const b = { customer: { name: 'Alfreds', city: 'Hamburg', vip: true }, lines: [{ sku: 'B', qty: 3 }, { sku: 'A', qty: 1 }], tags: [] }
    const byPos = diffJson(a, b)
    expect(byPos.changes).toEqual(expect.arrayContaining([
      { type: 'changed', path: 'customer.city', old: 'Berlin', new: 'Hamburg' },
      { type: 'added', path: 'customer.vip', new: true },
      { type: 'removed', path: 'tags[0]', old: 'x' },
    ]))
    const byKey = diffJson(a, b, { arrayKey: 'sku' })
    expect(byKey.changes.filter((c) => c.path.startsWith('lines'))).toEqual([{ type: 'changed', path: 'lines[sku="B"].qty', old: 2, new: 3 }])
    expect(diffJson({ x: [1, 2] }, { x: [1, 2] }).identical).toBe(true)
  })
})

describe('redline', () => {
  it('keeps unchanged paragraphs, word-diffs changed ones, marks inserted / deleted blocks; writes a DOCX with tracked changes', async () => {
    const a: Block[] = [
      { type: 'heading', level: 1, inlines: [{ text: 'Agreement' }] },
      { type: 'paragraph', inlines: [{ text: 'The term is 12 months.' }] },
      { type: 'paragraph', inlines: [{ text: 'Old clause removed.' }] },
    ]
    const b: Block[] = [
      { type: 'heading', level: 1, inlines: [{ text: 'Agreement' }] },
      { type: 'paragraph', inlines: [{ text: 'The term is 24 months.' }] },
      { type: 'paragraph', inlines: [{ text: 'New clause added.' }] },
      { type: 'paragraph', inlines: [{ text: 'Another new clause.' }] },
    ]
    const red = await redlineBlocks(a, b)
    expect(red[0]).toEqual(b[0])
    const second = red[1] as Extract<Block, { type: 'paragraph' }>
    expect(second.inlines.filter((i) => i.del).map((i) => i.text)).toEqual(['12'])
    expect(second.inlines.filter((i) => i.ins).map((i) => i.text)).toEqual(['24'])
    expect(red.length).toBe(4)
    const docx = await writeDocx(red, { redlineStyle: 'tracked', changeAuthor: 'Compare' })
    const read = await readDocument(docx, 'redline.docx', null, { trackedChanges: 'show' })
    expect(read.structure.tracked_changes!.insertions).toBeGreaterThanOrEqual(2)
    expect(read.structure.tracked_changes!.deletions).toBeGreaterThanOrEqual(1)
    const accepted = await readDocument(docx, 'redline.docx', null)
    expect(accepted.text).toContain('The term is 24 months.')
    expect(accepted.text).not.toContain('12')
  })
})
