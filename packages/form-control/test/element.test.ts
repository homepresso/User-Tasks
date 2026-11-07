import { beforeAll, describe, expect, it } from 'vitest'
import { capture, installDomStub } from './dom-stub'
import type * as Pkg from '../src'

let pkg: typeof Pkg
beforeAll(async () => {
  installDomStub()
  pkg = await import('../src')
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('UserTasksControlElement', () => {
  function make() {
    class Rating extends pkg.UserTasksControlElement {
      static override controlProps = ['max', 'value']
      calls: Array<string[]> = []
      protected override stateChanged(changed: ReadonlySet<string>) {
        this.calls.push([...changed].sort())
      }
    }
    return new Rating() as InstanceType<typeof Rating> & { max: unknown }
  }

  it('batches property changes into one stateChanged call per microtask', async () => {
    const el = make()
    await tick()
    expect(el.calls).toHaveLength(1) // the initial render
    el.value = 3
    el.disabled = true
    el.max = 7
    await tick()
    expect(el.calls[1]).toEqual(['disabled', 'max', 'value'])
    el.disabled = true // unchanged: no call
    await tick()
    expect(el.calls).toHaveLength(2)
  })

  it('exposes declared props (not reserved ones) with by-name over props', () => {
    const el = make()
    el.props = { max: 5 }
    expect(el.max).toBe(5)
    el.max = 9
    expect(el.max).toBe(9)
    expect(el.prop('max')).toBe(9)
    expect(el.prop('size', 'medium')).toBe('medium')
    // `value` is a host property, never a declared prop
    el.value = 2
    expect(el.value).toBe(2)
  })

  it('coerces host properties and builds the accessible name and description', () => {
    const el = make()
    el.label = 'Rating'
    el.description = 'Pick one'
    el.error = 'Required'
    expect(el.utLabel).toBe('Rating')
    expect(el.utDescription).toBe('Pick one')
    el.invalid = true
    expect(el.utDescription).toBe('Pick one Required')
    ;(el as unknown as { readonly: unknown }).readonly = 'true'
    expect(el.readonly).toBe(true)
  })

  it('dispatches the contract events (bubbling, composed) and dedupes validity', () => {
    const el = make()
    const events = capture(el)
    el.emitChange(4)
    el.emitBlur()
    el.setValidity(false, 'Choose a rating.')
    el.setValidity(false, 'Choose a rating.')
    el.setValidity(true)
    el.emitResize(41.2)
    el.emitResize(0)
    expect(events.map((e) => [e.type, e.detail])).toEqual([
      ['ut-change', { value: 4 }],
      ['ut-blur', {}],
      ['ut-validity', { valid: false, message: 'Choose a rating.' }],
      ['ut-validity', { valid: true }],
      ['ut-resize', { height: 42 }],
    ])
    expect(events.every((e) => e.bubbles && e.composed)).toBe(true)
    expect(el.value).toBe(4)
  })

  it('requests host services and applies theme tokens', async () => {
    const el = make()
    el.addEventListener('ut-request', (event) => {
      const { kind, payload, resolve } = (event as CustomEvent).detail
      resolve({ id: 'file_1', name: payload.name, size: payload.bytes.byteLength, type: payload.type, kind })
    })
    await expect(el.request('upload', { name: 'a.txt', type: 'text/plain', bytes: new ArrayBuffer(3) })).resolves.toMatchObject({ id: 'file_1', size: 3 })
    el.theme = { mode: 'dark', tokens: { 'ut-primary': '#60a5fa' } }
    expect(el.themeToken('ut-primary')).toBe('#60a5fa')
    expect(el.themeToken('ut-error', '#f00')).toBe('#f00')
    expect((el as unknown as { dataset: Record<string, string> }).dataset.mode).toBe('dark')
  })

  it('keeps properties set before upgrade', async () => {
    const { FakeElement } = await import('./dom-stub')
    class Late extends pkg.UserTasksControlElement {
      static override controlProps = ['max']
    }
    // An upgrade finds own data properties the runtime set on the plain element.
    FakeElement.preset = { value: 3, max: 8, required: 'true' }
    const el = new Late() as Late & { max: unknown }
    expect(Object.prototype.hasOwnProperty.call(el, 'value')).toBe(false)
    expect(el.value).toBe(3)
    expect(el.required).toBe(true)
    expect(el.max).toBe(8)
  })
})

describe('UserTasksControlMixin', () => {
  it('merges the host properties into static properties and adds the helpers', () => {
    class FakeLit extends (globalThis.HTMLElement as unknown as typeof EventTarget) {
      static properties = { other: { type: String } }
      value: unknown = null
      label = 'Score'
      description: string | null = null
      invalid = false
      error: string | null = null
      props: Record<string, unknown> = { max: 5 }
      theme = null
    }
    const Mixed = pkg.UserTasksControlMixin(FakeLit as unknown as Pkg.Constructor<HTMLElement>)
    class Control extends Mixed {
      static override properties = { max: { type: Number } }
    }
    expect(Object.keys(Mixed.properties)).toEqual(['other', ...pkg.HOST_PROPERTY_NAMES])
    expect(Mixed.properties.disabled).toMatchObject({ type: Boolean, reflect: true })
    expect(Control.properties).toEqual({ max: { type: Number } })

    const el = new Control()
    const events = capture(el)
    expect(el.utLabel).toBe('Score')
    expect(el.prop('max')).toBe(5)
    el.emitChange(3)
    expect(el.value).toBe(3)
    el.setValidity(true)
    el.setValidity(true)
    el.emitBlur()
    expect(events.map((e) => e.type)).toEqual(['ut-change', 'ut-validity', 'ut-blur'])
    expect(el.themeToken('ut-primary', '#2563eb')).toBe('#2563eb')
  })
})
