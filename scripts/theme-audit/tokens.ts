/**
 * Token contrast audit: every built-in preset × light / dark against the full
 * pair list in lib/theme/contrast.ts.
 *
 *   npx tsx scripts/theme-audit/tokens.ts [outDir]
 *
 * Writes tokens.json (every failure) and tokens.md (a table per preset/mode)
 * to outDir (default: ./theme-audit). Exit code 1 when anything fails.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { paletteContrastIssues, type ContrastIssue } from '@/lib/theme/contrast'
import { THEME_TEMPLATES, presetToWorkspaceTheme } from '@/lib/theme/presets'

const outDir = path.resolve(process.argv[2] ?? 'theme-audit')
mkdirSync(outDir, { recursive: true })
const rows: Array<ContrastIssue & { preset: string }> = []
for (const t of THEME_TEMPLATES) {
  const theme = presetToWorkspaceTheme(t.id)!
  for (const mode of ['light', 'dark'] as const) {
    for (const i of paletteContrastIssues(theme.colors[mode], mode, theme.chrome)) rows.push({ preset: t.id, ...i })
  }
}
writeFileSync(path.join(outDir, 'tokens.json'), JSON.stringify(rows, null, 2))
const byPair = new Map<string, number>()
for (const r of rows) byPair.set(r.pair, (byPair.get(r.pair) ?? 0) + 1)
const lines = [
  `# Theme token contrast audit`, '',
  `${rows.length} failing pairs across ${new Set(rows.map((r) => `${r.preset}/${r.mode}`)).size} preset-modes (${THEME_TEMPLATES.length} presets × 2 modes).`, '',
  '## By pair', '', '| pair | failures |', '|---|---|',
  ...[...byPair].sort((a, b) => b[1] - a[1]).map(([p, n]) => `| ${p} | ${n} |`), '',
  '## By preset / mode', '', '| preset | mode | pair | fg | bg | ratio | needs | level |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.preset} | ${r.mode} | ${r.pair} | ${r.foreground} | ${r.background} | ${r.ratio} | ${r.required} | ${r.level} |`),
]
writeFileSync(path.join(outDir, 'tokens.md'), lines.join('\n') + '\n')
console.log(`${rows.length} failures → ${outDir}/tokens.md`)
process.exitCode = rows.length ? 1 : 0
