import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The root not-found page is part of every server function outside the
 * dashboard (marketing, auth, docs, /form, /p/…). Turbopack gives each of
 * those functions its own copy of every chunk reachable through a dynamic
 * import, so a path from not-found into the services / workflow engine graph
 * multiplied it across ~37 functions (release-dec13: server chunks
 * 70 MB → 98 MB, deployed functions ~79 MB → ~105 MB median). These guards
 * walk the import graph (static and dynamic imports, not `import type`) the
 * way the bundler does and keep that path closed.
 */

const ROOT = path.resolve(__dirname, '..')
const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx']
const STATIC_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g
const DYNAMIC_RE = /import\(\s*(?:\/\*[^*]*\*\/\s*)?['"]([^'"]+)['"]\s*\)/g

function resolve(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(path.join(ROOT, from)), spec)
  else return null
  for (const ext of EXTS) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return path.relative(ROOT, p)
  }
  return null
}

function imports(file: string): string[] {
  const text = readFileSync(path.join(ROOT, file), 'utf8')
  const out: string[] = []
  for (const m of text.matchAll(STATIC_RE)) {
    if (m[1]) continue
    const r = resolve(file, m[2])
    if (r) out.push(r)
  }
  for (const m of text.matchAll(DYNAMIC_RE)) {
    const r = resolve(file, m[1])
    if (r) out.push(r)
  }
  return out
}

/** The import chain from `from` to `to`, or null. */
function importPath(from: string, to: string): string[] | null {
  const prev = new Map<string, string | null>([[from, null]])
  const queue = [from]
  while (queue.length) {
    const file = queue.shift()!
    if (file === to) {
      const chain: string[] = []
      for (let f: string | null = to; f; f = prev.get(f) ?? null) chain.unshift(f)
      return chain
    }
    for (const next of imports(file)) {
      if (!prev.has(next)) {
        prev.set(next, file)
        queue.push(next)
      }
    }
  }
  return null
}

describe('server function trace guards', () => {
  const entries = ['app/not-found.tsx', 'app/global-error.tsx', 'app/layout.tsx']
  const heavy = ['app/actions/search.ts', 'lib/services/forms.ts', 'lib/workflow-engine.ts', 'lib/documents/limits.ts']
  for (const entry of entries) {
    it(`${entry} does not reach the services / workflow engine graph`, () => {
      for (const target of heavy) expect(importPath(entry, target), `${entry} → ${target}`).toBeNull()
    })
  }

  it('the walker finds a known path (sanity check)', () => {
    expect(importPath('components/layout/global-search.tsx', 'app/actions/search.ts')).not.toBeNull()
  })
})
