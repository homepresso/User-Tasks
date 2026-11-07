/**
 * The smallest HTMLElement the package needs in Node: an EventTarget with
 * style and dataset. Install it before importing the element / mixin.
 */
export class FakeElement extends EventTarget {
  /** Own properties to put on the next instance, as an upgrade finds them. */
  static preset: Record<string, unknown> | null = null
  constructor() {
    super()
    const preset = FakeElement.preset
    FakeElement.preset = null
    // Own data properties (as on a plain element before upgrade), bypassing setters.
    for (const [name, value] of Object.entries(preset ?? {})) {
      Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true })
    }
  }
  style = {
    values: new Map<string, string>(),
    setProperty(name: string, value: string) { this.values.set(name, value) },
    getPropertyValue(name: string) { return this.values.get(name) ?? '' },
  }
  dataset: Record<string, string> = {}
}

export function installDomStub(): void {
  const g = globalThis as Record<string, unknown>
  g.HTMLElement ??= FakeElement
  g.getComputedStyle ??= (el: FakeElement) => el.style
}

export interface Captured { type: string; detail: unknown; bubbles: boolean; composed: boolean }

export function capture(target: EventTarget, types = ['ut-change', 'ut-blur', 'ut-validity', 'ut-resize', 'ut-request']): Captured[] {
  const out: Captured[] = []
  for (const type of types) {
    target.addEventListener(type, (event) => {
      const e = event as CustomEvent
      out.push({ type: e.type, detail: e.detail, bubbles: e.bubbles, composed: e.composed })
    })
  }
  return out
}
