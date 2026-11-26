import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A canvas with hundreds of steps re-rendered every card on any builder
// change (a config keystroke, a selection, a resize move): ~3.6 ms per card
// in a server-render proxy, ~1 s for 300 cards. CanvasNode is memoised and
// gets stable per-step callbacks, so only the changed card renders.
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('workflow canvas re-renders', () => {
  it('memoises CanvasNode and passes it stable per-step callbacks', () => {
    expect(read('components/automations/canvas-node.tsx')).toMatch(/export const CanvasNode = memo\(function CanvasNode\(/)
    const builder = read('components/automations/workflow-builder.tsx')
    expect(builder).toContain('{...canvasCallbacksFor(node.id)}')
    // No inline closures on the card (they would defeat the memo).
    const card = builder.slice(builder.indexOf('<CanvasNode'), builder.indexOf('/>', builder.indexOf('<CanvasNode')))
    expect(card).not.toMatch(/on(Select|Delete|StartConnect|FinishConnect)=\{/)
  })

  it('computes validation, the visible graph and the canvas extent once per change', () => {
    const builder = read('components/automations/workflow-builder.tsx')
    expect(builder).toMatch(/const validation = useMemo\(/)
    expect(builder).toMatch(/const visibleGraph = useMemo\(\(\) => resolveVisibleGraph\(nodes, edges\)/)
    expect(builder.match(/resolveVisibleGraph\(nodes, edges\)/g)).toHaveLength(1)
  })
})
