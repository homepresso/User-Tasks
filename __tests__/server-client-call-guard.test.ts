import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A server component can render a client component, but it can't CALL a
 * plain function exported from a 'use client' module: in production that
 * throws "Attempted to call X() from the server" (release-dec18d: /form-login
 * 500'd on signInErrorMessage). Tests and tsc don't catch it, so this scans
 * every server page / layout for calls to lower-case named imports that
 * come from a 'use client' file.
 */

const ROOT = path.resolve(__dirname, '..')
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/^(page|layout|template|not-found|default)\.tsx$/.test(name)) out.push(p)
  }
  return out
}

function resolve(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const ext of ['', ...EXTS]) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}

const isClient = (file: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(readFileSync(file, 'utf8'))

describe('server components never call client-module functions', () => {
  it('no server page / layout calls a function imported from a "use client" module', () => {
    const problems: string[] = []
    for (const file of walk(path.join(ROOT, 'app'))) {
      const text = readFileSync(file, 'utf8')
      if (isClient(file)) continue
      for (const m of text.matchAll(/import\s+(?!type\b)\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
        const target = resolve(m[2], file)
        if (!target || !isClient(target)) continue
        const names = m[1].split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type '))
          .map((s) => s.split(/\s+as\s+/).pop()!.trim())
        for (const name of names) {
          if (!/^[a-z]/.test(name)) continue // Components / constants render, they aren't called
          if (new RegExp(`(?<![\\w.])${name}\\s*\\(`).test(text.replace(m[0], ''))) {
            problems.push(`${path.relative(ROOT, file)} calls ${name}() from client module ${path.relative(ROOT, target)}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })
})
