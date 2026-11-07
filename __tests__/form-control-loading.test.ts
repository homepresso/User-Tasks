import { describe, expect, it } from 'vitest'
import {
  ControlReadyGate, READY_WAIT_MS, consistentThemeTokens, heightMemoryId, rememberHeight, rememberedHeight, reservedHeight, widthBucket, HEIGHT_MEMORY_KEY,
} from '@/lib/forms/custom-controls/loading'
import { FRAME_RUNTIME, buildFrameDocument, frameContentSecurityPolicy } from '@/lib/forms/custom-controls/frame'
import { acceptFrameMessage } from '@/lib/forms/custom-controls/bridge'
import { builtFrameDocument, frameETag } from '@/lib/services/form-control-frame'
import { isDarkColor, parseColor } from '@/lib/theme/colors'

/** A gate on a fake clock. */
function fakeGate(maxWait = READY_WAIT_MS) {
  let now = 0
  const timers: Array<{ at: number; fn: () => void; id: number }> = []
  let seq = 0
  let reveals = 0
  const gate = new ControlReadyGate({
    maxWait,
    onReveal: () => { reveals++ },
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ at: now + ms, fn, id }); return id },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) },
  })
  const advance = (ms: number) => {
    now += ms
    for (const t of [...timers].sort((a, b) => a.at - b.at)) if (t.at <= now) { timers.splice(timers.indexOf(t), 1); t.fn() }
  }
  return { gate, advance, reveals: () => reveals }
}

describe('ready gate', () => {
  it('reveals once every control is ready', () => {
    const { gate, reveals } = fakeGate()
    gate.register('a'); gate.register('b')
    expect(gate.waiting).toBe(true)
    gate.ready('a')
    expect(gate.revealed).toBe(false)
    gate.ready('b')
    expect(gate.revealed).toBe(true)
    expect(reveals()).toBe(1)
  })

  it('reveals after the bounded wait when a control is slow, and only once', () => {
    const { gate, advance, reveals } = fakeGate()
    gate.register('slow')
    advance(READY_WAIT_MS - 1)
    expect(gate.revealed).toBe(false)
    advance(1)
    expect(gate.revealed).toBe(true)
    gate.ready('slow')
    expect(reveals()).toBe(1)
    expect(READY_WAIT_MS).toBeLessThanOrEqual(1500)
  })

  it('a part without controls is never held; controls arriving after the reveal do not hide it again', () => {
    const { gate } = fakeGate()
    gate.settle()
    expect(gate.revealed).toBe(true)
    gate.register('late')
    expect(gate.waiting).toBe(false)
  })

  it('a control that goes away stops holding the form, but a re-mount in the same moment still holds it', () => {
    const { gate, advance } = fakeGate()
    gate.register('a')
    gate.unregister('a'); gate.register('a') // React's development double mount
    advance(0)
    expect(gate.revealed).toBe(false)
    gate.unregister('a')
    advance(0)
    expect(gate.revealed).toBe(true)
  })
})

describe('height reservation', () => {
  const store = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, data } }

  it('starts at the manifest default inside its bounds', () => {
    expect(reservedHeight({ default_height: 216, min_height: 120, max_height: 900 }, null)).toBe(216)
    expect(reservedHeight({ default_height: 50, min_height: 120 }, null)).toBe(120)
    expect(reservedHeight(undefined, null)).toBe(44)
  })

  it('remembers the last measured height per control version, field and width', () => {
    const s = store()
    const id = heightMemoryId('ut-map', '1.1.0', 'where', 680)
    expect(rememberedHeight(s, id)).toBeNull()
    rememberHeight(s, id, 357)
    expect(rememberedHeight(s, id)).toBe(357)
    expect(reservedHeight({ default_height: 400, min_height: 200, max_height: 960 }, rememberedHeight(s, id))).toBe(357)
    // Another width bucket (a phone) or version is its own entry.
    expect(rememberedHeight(s, heightMemoryId('ut-map', '1.1.0', 'where', 360))).toBeNull()
    expect(rememberedHeight(s, heightMemoryId('ut-map', '1.2.0', 'where', 680))).toBeNull()
    expect(widthBucket(680)).toBe(widthBucket(700))
  })

  it('ignores garbage and stays bounded', () => {
    const s = store()
    s.setItem(HEIGHT_MEMORY_KEY, '{not json')
    expect(rememberedHeight(s, 'x')).toBeNull()
    s.setItem(HEIGHT_MEMORY_KEY, JSON.stringify({ x: 99999 }))
    expect(rememberedHeight(s, 'x')).toBeNull()
    for (let i = 0; i < 400; i++) rememberHeight(s, `k${i}`, 100)
    expect(Object.keys(JSON.parse(s.data.get(HEIGHT_MEMORY_KEY)!)).length).toBe(300)
    expect(rememberedHeight(s, 'k399')).toBe(100)
  })
})

describe('theme tokens', () => {
  const dark = (c: string) => (parseColor(c) ? isDarkColor(c) : null)
  it('drops workspace colours that contradict a dark form card (no white bars in dark mode)', () => {
    const out = consistentThemeTokens({ mode: 'dark', tokens: { 'ut-card': '#1F1E1B', 'ut-surface': '#F5F3EE', 'ut-text': '#ECEAE4', 'ut-muted-text': '#5F5A50', 'ut-primary': '#7EA2FF' } }, dark)
    expect(out.tokens).toEqual({ 'ut-card': '#1F1E1B', 'ut-text': '#ECEAE4', 'ut-primary': '#7EA2FF' })
  })
  it('keeps consistent tokens and anything it cannot read', () => {
    const tokens = { 'ut-card': '#FFFFFF', 'ut-surface': 'var(--x)', 'ut-text': '#1B1916', 'ut-radius': '8px' }
    expect(consistentThemeTokens({ mode: 'light', tokens }, dark).tokens).toEqual(tokens)
  })
})

describe('frame runtime handshake', () => {
  it('asks for its state first (hello), mounts only after init, and never reports a 0 height', () => {
    expect(FRAME_RUNTIME).toContain("post({ type: 'hello' })")
    expect(FRAME_RUNTIME).not.toContain("post({ type: 'resize', height: 0 })")
    expect(FRAME_RUNTIME).toMatch(/if \(el \|\| !defined \|\| !initialised\) return;/)
    // The mode in the hash styles the first paint; the document follows the frame's colour scheme.
    expect(FRAME_RUNTIME).toContain('[#&]m=(dark|light)')
    const { html } = buildFrameDocument({ tag: 'ut-x', version: '1.0.0', props: [], name: 'X' }, 'customElements.define("ut-x", class extends HTMLElement {})')
    expect(html).toContain('<meta name="color-scheme" content="light dark">')
    expect(html).toContain('background: transparent')
  })

  it('the bridge accepts hello from the frame only', () => {
    const frame = {}
    expect(acceptFrameMessage({ source: frame, origin: 'null', data: { ut: 1, channel: 'c', type: 'hello' } }, { frameWindow: frame, channel: 'c', capabilities: [] })).toEqual({ ok: true, message: { ut: 1, channel: 'c', type: 'hello' } })
    expect(acceptFrameMessage({ source: {}, origin: 'null', data: { ut: 1, channel: 'c', type: 'hello' } }, { frameWindow: frame, channel: 'c', capabilities: [] }).ok).toBe(false)
  })

  it('the CSP is unchanged: two hashed scripts, no network, sandboxed', () => {
    const csp = frameContentSecurityPolicy({ scriptHashes: ['a', 'b'], approvedHosts: [] })
    expect(csp).toContain("script-src 'sha256-a' 'sha256-b'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('sandbox allow-scripts')
    expect(csp).toContain("frame-ancestors 'self'")
  })

  it('reuses a built document per immutable version and validates with a strong ETag', () => {
    const manifest = { tag: 'ut-y', version: '1.0.0', props: [], name: 'Y' }
    const a = builtFrameDocument(manifest, 'customElements.define("ut-y", class extends HTMLElement {})', 'sha-1')
    const b = builtFrameDocument(manifest, 'customElements.define("ut-y", class extends HTMLElement {})', 'sha-1')
    expect(b).toBe(a)
    expect(a.hashes).toHaveLength(2)
    expect(frameETag('sha-1', a.hashes, [])).toBe(frameETag('sha-1', a.hashes, []))
    // Approving a host changes the response headers: a new validator.
    expect(frameETag('sha-1', a.hashes, ['tile.openstreetmap.org'])).not.toBe(frameETag('sha-1', a.hashes, []))
  })
})
