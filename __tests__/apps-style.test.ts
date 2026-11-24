import { describe, expect, it } from 'vitest'
import {
  appStyleSchema, contrastRatio, contrastWarnings, isColor, isStyled, meetsAA, mergeStyles, modeValue, parseColor, resolveWidgetStyle, styleCss, widgetStyleSchema,
} from '@/lib/apps/style'
import { normalisePageLayout, appCreateSchema, actionButtonSchema } from '@/lib/apps/schema'
import { groupColors } from '@/lib/apps/colors'

describe('colour validation', () => {
  it('accepts tokens, hex, rgb(a) and hsl(a)', () => {
    for (const c of ['token:primary', 'token:chart-3', '#fff', '#ffff', '#2563eb', '#2563eb80', 'rgb(37, 99, 235)', 'rgba(37,99,235,0.5)', 'hsl(220, 80%, 50%)', 'hsla(220deg, 80%, 50%, 50%)']) expect(isColor(c), c).toBe(true)
  })
  it('rejects CSS injection and anything that is not a colour', () => {
    for (const c of ['red; background:url(https://evil.example/x)', 'red', 'token:nope', '#12', 'url(x)', 'rgb(1,2,3);color:red', 'expression(alert(1))', 'var(--x)', '#2563eb !important', 'rgb(1,2,3)) ; x', '']) expect(isColor(c), c).toBe(false)
    expect(widgetStyleSchema.safeParse({ colors: { background: 'red; background:url(https://evil.example/x)' } }).success).toBe(false)
    expect(widgetStyleSchema.safeParse({ colors: { background: { light: '#fff', dark: 'blue;}' } } }).success).toBe(false)
    expect(widgetStyleSchema.safeParse({ background_image: { kind: 'image', url: 'https://x.example/a.png") ; background: url("https://evil' } }).success).toBe(false)
    expect(widgetStyleSchema.safeParse({ background_image: { kind: 'image', url: 'javascript:alert(1)' } }).success).toBe(false)
    expect(widgetStyleSchema.safeParse({ background_image: { kind: 'image', url: 'https://cdn.example.com/hero.png' } }).success).toBe(true)
    expect(widgetStyleSchema.safeParse({ css: 'color:red' }).success).toBe(false)
  })
  it('parses colours', () => {
    expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 1)
    expect(parseColor('hsl(0, 100%, 50%)')).toMatchObject({ r: 255, g: 0, b: 0 })
    expect(parseColor('token:primary')).toBeNull()
  })
})

describe('contrast', () => {
  it('computes WCAG ratios and AA', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
    expect(meetsAA('#777777', '#ffffff')).toBe(false)
    expect(meetsAA('#777777', '#ffffff', true)).toBe(true)
    expect(meetsAA('token:text', '#ffffff')).toBeNull()
  })
  it('warns about unreadable text in either mode', () => {
    expect(contrastWarnings({ colors: { background: '#ffffff', text: '#eeeeee' } }).some((w) => /Body text.*light/.test(w))).toBe(true)
    expect(contrastWarnings({ colors: { background: '#ffffff', text: '#111111' } })).toEqual([])
    expect(contrastWarnings({ colors: { button_bg: '#2563eb', button_text: '#3b82f6' } }).some((w) => /Button text/.test(w))).toBe(true)
  })
  it('derives readable dark-mode values from a single value', () => {
    expect(modeValue('#ffffff', 'dark', 'background')).not.toBe('#ffffff')
    expect(modeValue('#111111', 'dark', 'text')).not.toBe('#111111')
    expect(modeValue('#2563eb', 'dark', 'accent')).toBe('#2563eb')
    expect(modeValue({ light: '#fff', dark: '#000' }, 'dark', 'background')).toBe('#000')
  })
})

describe('inheritance', () => {
  const app = appStyleSchema.parse({ default: { radius: 'lg', colors: { accent: '#7c3aed', text: '#111111' } }, presets: [{ name: 'Alert', style: { colors: { background: '#fef2f2', accent: '#dc2626' }, shadow: 'md' } }] })
  it('app default → preset → widget', () => {
    const s = resolveWidgetStyle(app, { preset: 'Alert', colors: { accent: '#16a34a' }, padding: 'spacious' })
    expect(s).toMatchObject({ radius: 'lg', shadow: 'md', padding: 'spacious', colors: { text: '#111111', background: '#fef2f2', accent: '#16a34a' } })
    expect(resolveWidgetStyle(app, null)).toMatchObject({ radius: 'lg', colors: { accent: '#7c3aed' } })
    expect(resolveWidgetStyle(app, { preset: 'Missing' }).colors?.background).toBeUndefined()
    expect(mergeStyles({ colors: { text: '#000' } }, { colors: { text: null } }).colors?.text).toBe('#000')
    expect(isStyled({})).toBe(false)
    expect(isStyled({ colors: {} })).toBe(false)
    expect(isStyled({ radius: 'sm' })).toBe(true)
  })
})

describe('CSS variables', () => {
  it('scopes colours as light / dark pairs and token overrides, never raw CSS', () => {
    const css = styleCss({ colors: { background: '#ffffff', accent: 'token:success', table_header: { light: '#eeeeee', dark: '#222222' } }, palette: ['#ff0000', '#00ff00'], radius: 'xl', shadow: 'lg', value_colors: [{ value: 'Approved', color: '#16a34a' }], background_image: { kind: 'gradient', from: '#000', to: 'token:primary', angle: 90 } })
    expect(css.vars['--wl-bg']).toBe('#ffffff')
    expect(css.vars['--wd-bg']).not.toBe('#ffffff')
    expect(css.vars['--theme-card-bg']).toBe('var(--w-bg)')
    expect(css.vars['--theme-primary']).toBe('var(--w-accent)')
    expect(css.vars['--wl-accent']).toBe('var(--theme-success)')
    expect(css.vars['--wd-th']).toBe('#222222')
    expect(css.vars['--app-chart-2']).toBe('#00ff00')
    expect(css.box).toMatchObject({ background: 'var(--w-bg)', borderRadius: '20px', boxShadow: 'var(--shadow-elev-3)', backgroundImage: 'linear-gradient(90deg, #000, var(--theme-primary))' })
    expect(css.flags.split(' ')).toEqual(expect.arrayContaining(['bg', 'accent', 'th']))
    expect(css.valueColors).toEqual({ approved: '#16a34a' })
    // A forged (unvalidated) object still can't inject: invalid values are skipped.
    const forged = styleCss({ colors: { background: 'red;}body{display:none' } } as never)
    expect(Object.keys(forged.vars)).toEqual([])
  })
  it('value colours feed chart groups', () => {
    expect(groupColors(['approved', 'other'], false, { approved: '#16a34a' })).toEqual(['#16a34a', 'var(--app-chart-1)'])
  })
})

describe('schema placement', () => {
  it('widgets, buttons and apps carry styles; invalid styles drop the widget', () => {
    const layout = normalisePageLayout({ widgets: [
      { id: 'a', type: 'heading', w: 12, h: 2, config: { text: 'Hi' }, style: { colors: { title: '#2563eb' }, title_size: 'xl' } },
      { id: 'b', type: 'heading', w: 12, h: 2, config: { text: 'Bad' }, style: { colors: { title: 'red;}' } } },
    ] })
    expect(layout.widgets.map((w) => w.id)).toEqual(['a'])
    expect(layout.widgets[0].style?.title_size).toBe('xl')
    expect(actionButtonSchema.safeParse({ label: 'Go', action: { kind: 'copy_link' }, colors: { bg: '#16a34a', text: { light: '#fff' } } }).success).toBe(true)
    expect(actionButtonSchema.safeParse({ label: 'Go', action: { kind: 'copy_link' }, colors: { bg: 'url(x)' } }).success).toBe(false)
    expect(appCreateSchema.safeParse({ name: 'X', style: { default: { radius: 'sm' }, presets: [{ name: 'Calm', style: { shadow: 'none' } }] } }).success).toBe(true)
  })
})
