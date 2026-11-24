import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Icons passed as Badge children (spinner + "Running") must sit beside the
// text, not stack above it: lucide svgs are display:block by default.
describe('Badge icon layout', () => {
  it('keeps svg children inline with the label text', () => {
    const src = readFileSync('components/ui/badge.tsx', 'utf8')
    expect(src).toMatch(/\[&>svg\]:inline-block/)
  })
})
