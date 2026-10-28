import { describe, it, expect } from 'vitest'
import { sanitizeSvg } from '@/lib/sanitize-svg'

describe('sanitizeSvg', () => {
  it('keeps plain vector markup', () => {
    const svg = '<svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z" fill="#fff"/></svg>'
    expect(sanitizeSvg(svg)).toBe(svg)
  })
  it('rejects non-svg input', () => {
    expect(sanitizeSvg('<div>hi</div>')).toBeNull()
    expect(sanitizeSvg('')).toBeNull()
  })
  it('strips script elements and event handlers', () => {
    const dirty = '<svg onload="alert(1)"><script>alert(2)</script><path onclick="x()" d="M0 0"/></svg>'
    const clean = sanitizeSvg(dirty)!
    expect(clean).not.toContain('script')
    expect(clean).not.toContain('onload')
    expect(clean).not.toContain('onclick')
    expect(clean).toContain('<path')
  })
  it('strips foreignObject, use, and javascript hrefs', () => {
    const dirty = '<svg><foreignObject><body/></foreignObject><use xlink:href="javascript:x"/><a href="javascript:alert(1)"><circle r="2"/></a></svg>'
    const clean = sanitizeSvg(dirty)!
    expect(clean).not.toContain('foreignObject')
    expect(clean).not.toContain('<use')
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('<circle')
  })
  it('strips payloads hidden in comments', () => {
    const dirty = '<svg><!-- <script> --><rect width="2"/><!-- </script> --></svg>'
    expect(sanitizeSvg(dirty)).toBe('<svg><rect width="2"/></svg>')
  })
})
