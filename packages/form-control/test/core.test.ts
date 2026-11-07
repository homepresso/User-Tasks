import { describe, expect, it } from 'vitest'
import {
  CONTROL_EVENTS,
  HOST_PROPERTY_NAMES,
  LIT_HOST_PROPERTIES,
  RESERVED_ELEMENT_PROPERTIES,
  THEME_TOKENS,
  accessibleDescription,
  coerceHostProperty,
  defaultHostProperties,
  dispatchRequest,
  isDeclarablePropName,
  isThemeToken,
  resolveProp,
  resolveThemeToken,
  validityDetail,
} from '../src'

describe('host properties', () => {
  it('cover the contract and are all reserved', () => {
    expect(Object.keys(defaultHostProperties())).toEqual([...HOST_PROPERTY_NAMES])
    expect(Object.keys(LIT_HOST_PROPERTIES)).toEqual([...HOST_PROPERTY_NAMES])
    for (const name of HOST_PROPERTY_NAMES) expect(RESERVED_ELEMENT_PROPERTIES.has(name), name).toBe(true)
  })

  it('are coerced to their types', () => {
    expect(coerceHostProperty('disabled', 'true')).toBe(true)
    expect(coerceHostProperty('disabled', 1)).toBe(false)
    expect(coerceHostProperty('error', '')).toBeNull()
    expect(coerceHostProperty('error', 42)).toBe('42')
    expect(coerceHostProperty('label', undefined)).toBe('')
    expect(coerceHostProperty('locale', '')).toBe('en')
    expect(coerceHostProperty('props', [1])).toEqual({})
    expect(coerceHostProperty('theme', { mode: 'dark', tokens: { 'ut-primary': '#fff' } })).toEqual({ mode: 'dark', tokens: { 'ut-primary': '#fff' } })
    expect(coerceHostProperty('theme', { mode: 'sepia' })).toBeNull()
    expect(coerceHostProperty('value', undefined)).toBeNull()
    expect(coerceHostProperty('value', 0)).toBe(0)
  })
})

describe('helpers', () => {
  it('resolve a prop: set by name, then props, then fallback', () => {
    expect(resolveProp({ max: 7 }, { max: 5 }, 'max', 3)).toBe(7)
    expect(resolveProp({}, { max: 5 }, 'max', 3)).toBe(5)
    expect(resolveProp({}, null, 'max', 3)).toBe(3)
  })

  it('only declare props that are identifiers and not reserved', () => {
    expect(isDeclarablePropName('max')).toBe(true)
    expect(isDeclarablePropName('allow_clear')).toBe(true)
    expect(isDeclarablePropName('value')).toBe(false)
    expect(isDeclarablePropName('innerHTML')).toBe(false)
    expect(isDeclarablePropName('__proto__')).toBe(false)
    expect(isDeclarablePropName('bad-name')).toBe(false)
  })

  it('build validity details and descriptions', () => {
    expect(validityDetail(true, 'ignored')).toEqual({ valid: true })
    expect(validityDetail(false)).toEqual({ valid: false })
    expect(validityDetail(false, 'x'.repeat(600)).message).toHaveLength(500)
    expect(accessibleDescription('Help', false, 'Error')).toBe('Help')
    expect(accessibleDescription('Help', true, 'Error')).toBe('Help Error')
    expect(accessibleDescription(null, true, null)).toBeNull()
  })

  it('resolve theme tokens from the theme, then CSS, then a fallback', () => {
    expect(resolveThemeToken({ mode: 'light', tokens: { 'ut-primary': '#123456' } }, 'ut-primary', '#000')).toBe('#123456')
    expect(resolveThemeToken(null, 'ut-primary', '  #abcdef ')).toBe('#abcdef')
    expect(resolveThemeToken(null, 'ut-primary', '', 'blue')).toBe('blue')
    expect(THEME_TOKENS.every(isThemeToken)).toBe(true)
    expect(isThemeToken('ut-nope')).toBe(false)
  })
})

describe('dispatchRequest', () => {
  it('dispatches a bubbling, composed ut-request and settles with the host answer', async () => {
    const target = new EventTarget()
    target.addEventListener(CONTROL_EVENTS.request, (event) => {
      const e = event as CustomEvent
      expect(e.bubbles && e.composed).toBe(true)
      expect(e.detail.kind).toBe('lookup')
      e.detail.resolve({ items: [{ value: 'nz', label: 'New Zealand' }] })
      e.detail.reject(new Error('ignored: already settled'))
    })
    await expect(dispatchRequest(target, 'lookup', { query: 'new' })).resolves.toEqual({ items: [{ value: 'nz', label: 'New Zealand' }] })
  })

  it('rejects when the host rejects or never answers', async () => {
    const target = new EventTarget()
    target.addEventListener(CONTROL_EVENTS.request, (event) => (event as CustomEvent).detail.reject('nope'))
    await expect(dispatchRequest(target, 'upload', {})).rejects.toThrow('nope')
    await expect(dispatchRequest(new EventTarget(), 'lookup', { query: '' }, 10)).rejects.toThrow('timed out')
  })
})
