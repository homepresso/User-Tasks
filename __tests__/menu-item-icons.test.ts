/**
 * Menu items take their icon through DropdownMenuItem's `icon` prop (aligned,
 * muted, 16px, beside the label). An icon written as the item's first child
 * renders on its own line above the label (the Forms → Import menu did).
 */
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('menu item icons', () => {
  it('no DropdownMenuItem starts with an inline icon element', () => {
    const files = execSync("git ls-files 'app/**/*.tsx' 'components/**/*.tsx'", { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    const offenders: string[] = []
    for (const file of files) {
      const lines = readFileSync(path.join(root, file), 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (/<DropdownMenuItem\b[^]*>\s*$/.test(line) && /^\s*<[A-Z][A-Za-z0-9]* className="(size-4|h-4 w-4)[^"]*"[^>]*\/>\s*\S/.test(lines[i + 1] ?? '')) offenders.push(`${file}:${i + 2}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
