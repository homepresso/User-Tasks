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

describe('sanitizeSvg hardening (QA 2026-11-24)', () => {
  const vectors = [
    '<svg/onload=alert(1)><path d="M0 0"/></svg>',
    '<svg><rect x=""onclick="alert(1)"/></svg>',
    '<svg><a href="&#106;avascript:alert(1)"><circle r="2"/></a></svg>',
    '<svg><a href=javascript:alert(1)><circle r="2"/></a></svg>',
    '<svg><a href=" javascript:alert(1)"><circle r="2"/></a></svg>',
    '<svg><a><set attributeName="href" to="javascript:alert(1)"/><circle r="2"/></a></svg>',
    '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate><circle r="2"/></a></svg>',
    '<svg><image href="https://evil.example/x.svg"/></svg>',
    '<svg onmouseover = "alert(1)" ><path d="M0 0"/></svg>',
  ]
  it.each(vectors)('neutralises %s', (dirty) => {
    const clean = sanitizeSvg(dirty) ?? ''
    expect(clean).not.toMatch(/\son[a-z]+\s*=|[/"']on[a-z]+\s*=/i)
    expect(clean).not.toMatch(/javascript|&#106;|evil\.example/i)
    expect(clean).not.toMatch(/<(set|animate)\b/i)
  })
  it('keeps same-document fragment links', () => {
    const svg = '<svg><defs><linearGradient id="g"/></defs><a href="#g"><rect fill="url(#g)"/></a></svg>'
    expect(sanitizeSvg(svg)).toBe(svg)
  })
})
