/**
 * Nintex Forms reader on hostile input (synthetic): linear-time envelope
 * extraction, and control types that collide with Object.prototype names.
 */
import { describe, expect, it } from 'vitest'
import { parseNintexForm } from '@/lib/importers/nintex/forms'

describe('Nintex Forms: hostile input', () => {
  it('many unclosed <FormContent> / <FormXml> tags do not stall the reader', () => {
    // A lazy `<T>([\s\S]*?)</T>` regex re-scanned to the end from each open tag (quadratic: minutes here).
    const raw = '<FormContent>'.repeat(200_000) + '<FormXml>'.repeat(200_000) + '<ActionId>'.repeat(200_000)
    const started = Date.now()
    expect(() => parseNintexForm(Buffer.from(raw), 'Form1.xml')).toThrow()
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('still reads the envelope: <ActionId> and <FormXml>', () => {
    const inner = '<Form><FormControlProperties xmlns:i="i" i:type="SingleLineTextFormControlProperties"><Name>Title</Name></FormControlProperties></Form>'
    const esc = inner.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const model = parseNintexForm(Buffer.from(`<Envelope><ActionId> a1 </ActionId><FormXml>${esc}</FormXml></Envelope>`), 'Forms/Form1.xml')
    expect(model.actionId).toBe('a1')
    expect(model.kind).toBe('classic')
  })

  it('control types named like Object.prototype members are skipped, not given a function as their type', () => {
    const classic = parseNintexForm(Buffer.from('<Form><FormControlProperties xmlns:i="i" i:type="constructorFormControlProperties"><Name>a</Name></FormControlProperties></Form>'), 'f.xml')
    expect(classic.fields).toEqual([])
    expect(classic.skipped[0].reason).toBe('no matching field type')
    const responsive = parseNintexForm(Buffer.from(JSON.stringify({ rows: [{ widget: 'toString', properties: { name: 'x' } }] })), 'f.json')
    expect(responsive.fields).toEqual([])
  })
})

describe('Nintex Forms: deeply nested responsive JSON', () => {
  it('gives a clean error, not a stack overflow', () => {
    const deep = '{"rows":' + '['.repeat(20_000) + ']'.repeat(20_000) + '}'
    let error: unknown
    try { parseNintexForm(Buffer.from(deep), 'f.json') } catch (e) { error = e }
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(RangeError)
    expect(String((error as Error).message)).toMatch(/nested|not valid JSON/)
  })
})
