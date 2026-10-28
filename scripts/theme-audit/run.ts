/**
 * DOM contrast audit: every built-in theme preset × light / dark mode × the
 * main app pages, on a LOCAL stack with the Northwind demo workspace
 * (scripts/screenshots/seed-demo.ts). See scripts/theme-audit/README.md.
 *
 *   npx tsx scripts/theme-audit/run.ts [outDir] [--presets=a,b] [--pages=tasks,designer]
 *
 * For each preset it applies the template through the REST API
 * (POST /api/v1/workspace-theme/apply-preset), then for each page and mode
 * runs axe-core's `color-contrast` rule plus a pixel check: every visible
 * text run's colour against the background actually painted under it,
 * sampled from a screenshot taken with all text made transparent (so
 * gradients, images, translucent washes and overlays count). The workspace's
 * original theme is restored at the end (PUT /api/v1/workspace-theme).
 *
 * Output: <outDir>/results.ndjson (one line per preset/mode/page) and
 * <outDir>/summary.md (failures grouped by element signature).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- browser handles and in-page data are loosely typed */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { APP_URL, DEMO, assertLocal, makeApi, readApiKey, readState, requireTool } from '../screenshots/common'
import { THEME_TEMPLATES } from '@/lib/theme/presets'

assertLocal()
const args = process.argv.slice(2)
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const outDir = resolve(args.find((a) => !a.startsWith('--')) ?? 'theme-audit-dom')
mkdirSync(join(outDir, 'shots'), { recursive: true })
const presets = flag('presets')?.split(',') ?? THEME_TEMPLATES.map((t) => t.id)
const { chromium } = requireTool('playwright-core')
const toolsRequire = createRequire(join(process.env.SCREENSHOT_TOOLS_DIR ?? process.cwd(), 'package.json'))
const AXE_SRC = readFileSync(toolsRequire.resolve('axe-core/axe.min.js'), 'utf8')
const PAGE_CHECKS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page-checks.js'), 'utf8')
const api = makeApi(readApiKey())
const state = readState()
if (!state.workflow_id) throw new Error('No demo state: run scripts/screenshots/seed-demo.ts first.')

type Page = any
const clickButton = (re: RegExp) => async (page: Page) => { await page.getByRole('button', { name: re }).first().click({ timeout: 5000 }) }
async function selectLabelledEdge(page: Page) {
  await page.getByRole('button', { name: /^Tidy$/ }).first().click({ timeout: 5000 })
  await page.waitForTimeout(1800)
  const edges = page.locator('path[data-edge-id]')
  const n = await edges.count()
  for (let i = 0; i < n; i++) {
    await edges.nth(i).dispatchEvent('click')
    await page.waitForTimeout(150)
    if (await page.locator('svg text').count()) break
  }
  await page.locator('[data-edge-delete]').waitFor({ timeout: 3000 })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
}
const ALL_SCENARIOS: Array<{ id: string; path: string; act?: (page: Page) => Promise<void>; shot?: boolean }> = [
  { id: 'tasks', path: '/tasks', shot: true },
  { id: 'task-detail', path: `/tasks/${state.task_id}` },
  { id: 'queue', path: '/tasks/queue' },
  { id: 'automations', path: '/automations' },
  { id: 'designer', path: `/automations/${state.workflow_id}`, shot: true },
  { id: 'designer-config', path: `/automations/${state.workflow_id}`, act: async (p) => { await p.locator('[data-canvas-node="true"]').nth(1).click({ timeout: 5000 }); await p.waitForTimeout(700) }, shot: true },
  // A selected connection after Tidy (fits the flow in view; not saved): highlight ring, faded
  // steps, dimmed lines, the label badge of a labelled (branch) connection and its delete button.
  { id: 'designer-edge', path: `/automations/${state.workflow_id}`, act: selectLabelledEdge, shot: true },
  { id: 'run-dialog', path: `/automations/${state.workflow_id}`, act: clickButton(/^Run$/) },
  { id: 'live-instances', path: `/automations/${state.workflow_id}`, act: async (p) => { await p.locator('button[title^="Live (waiting"]').first().click({ timeout: 5000 }) } },
  { id: 'run-viewer', path: `/automations/runs/${state.completed_run_id}` },
  // The process view scrolled to the branch connector labels (SVG text).
  { id: 'run-viewer-flow', path: `/automations/runs/${state.completed_run_id}`, act: async (p) => { await p.locator('svg text', { hasText: /\S/ }).first().scrollIntoViewIfNeeded({ timeout: 5000 }); await p.mouse.move(0, 0); await p.waitForTimeout(300) } },
  { id: 'integrations', path: '/integrations' },
  { id: 'rules', path: `/automations/rules/${state.decision_table_id}` },
  { id: 'reports', path: '/reports' },
  { id: 'report', path: `/reports/${state.report_id}` },
  { id: 'data', path: `/data/${state.data_table_id}` },
  { id: 'settings', path: '/settings' },
  { id: 'settings-appearance', path: '/settings', act: clickButton(/^Appearance$/) },
  { id: 'theme-designer', path: '/settings/theme' },
  { id: 'log-export', path: '/settings/log-export' },
  { id: 'api-keys', path: '/settings/api-keys' },
  { id: 'activity', path: '/activity' },
  { id: 'search', path: '/tasks', act: async (p) => { await p.keyboard.press('Meta+k'); await p.waitForTimeout(300); await p.keyboard.type('invoice'); await p.waitForTimeout(1200) } },
  { id: 'bell', path: '/tasks', act: async (p) => { await p.locator('header button:has(svg.lucide-bell)').first().click({ timeout: 5000 }); await p.waitForTimeout(800) } },
]
const SCENARIOS = ALL_SCENARIOS.filter((s) => !flag('pages') || flag('pages')!.split(',').includes(s.id))

const CLEAN = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}[data-sonner-toaster],nextjs-portal{display:none!important}'
const HIDE = '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important}::placeholder{color:transparent!important}svg text,svg tspan{fill:transparent!important;stroke:transparent!important}'

async function auditPage(page: Page) {
  await page.addScriptTag({ content: PAGE_CHECKS })
  const items = await page.evaluate(() => (window as any).__themeAudit.collectText())
  const hide = await page.addStyleTag({ content: HIDE })
  await page.waitForTimeout(80)
  const png = (await page.screenshot({ type: 'png' })).toString('base64')
  await hide.evaluate((el: Element) => el.remove())
  const custom = await page.evaluate((arg: unknown) => (window as any).__themeAudit.sampleContrast(arg), { png, items })
  await page.addScriptTag({ content: AXE_SRC })
  const axe = await page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] })
    return r.violations.flatMap((v: any) => v.nodes.map((n: any) => ({ target: n.target.join(' '), html: n.html.slice(0, 240), data: n.any[0]?.data ?? null })))
  })
  return { custom, axe }
}

async function login(browser: any) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#tenant', DEMO.slug); await page.fill('#email', DEMO.email); await page.fill('#password', DEMO.password)
  await page.click('button[type=submit]')
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  const storage = await ctx.storageState(); await ctx.close()
  return storage
}

async function main() {
  const original = await api('GET', '/workspace-theme')
  writeFileSync(join(outDir, 'original-theme.json'), JSON.stringify(original, null, 2))
  const resultsFile = join(outDir, 'results.ndjson')
  writeFileSync(resultsFile, '')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const id of presets) {
      await api('POST', '/workspace-theme/apply-preset', { preset_id: id })
      const storage = await login(browser)
      const jobs = (['light', 'dark'] as const).flatMap((scheme) => SCENARIOS.map((sc) => ({ scheme, sc })))
      let next = 0
      const worker = async () => {
        while (next < jobs.length) {
          const { scheme, sc } = jobs[next++]
          const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, storageState: storage, reducedMotion: 'reduce', bypassCSP: true, deviceScaleFactor: 1 })
          await ctx.addInitScript((css: string) => { const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s) }; if (document.head) add(); else document.addEventListener('DOMContentLoaded', add) }, CLEAN)
          const page = await ctx.newPage()
          const rec: Record<string, unknown> = { preset: id, mode: scheme, scenario: sc.id }
          try {
            for (let attempt = 0; attempt < 3; attempt++) {
              await page.goto(`${APP_URL}${sc.path}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {})
              await page.evaluate(() => document.fonts.ready)
              await page.waitForTimeout(900)
              const ready = await page.evaluate(() => !!document.documentElement.getAttribute('data-theme-mode') && document.body.innerText.length > 200 && !document.querySelector('[aria-busy="true"]'))
              if (ready) break
              await page.waitForTimeout(1500)
            }
            if (sc.act) { try { await sc.act(page); rec.act = 'ok' } catch (e) { rec.act = `failed: ${String((e as Error).message).split('\n')[0]}` } }
            await page.waitForTimeout(500)
            rec.htmlMode = await page.evaluate(() => document.documentElement.getAttribute('data-theme-mode'))
            if (sc.shot) await page.screenshot({ path: join(outDir, 'shots', `${id}-${scheme}-${sc.id}.jpg`), type: 'jpeg', quality: 70 })
            Object.assign(rec, await auditPage(page))
          } catch (e) { rec.error = String((e as Error).message).split('\n')[0] }
          appendFileSync(resultsFile, JSON.stringify(rec) + '\n')
          await ctx.close()
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      console.log(`audited ${id}`)
    }
  } finally {
    // Restore the workspace's theme.
    // GET returns { workspace_theme } (older builds: { theme }).
    const { workspace_theme, theme: legacy } = original as { workspace_theme?: Record<string, unknown>; theme?: Record<string, unknown> }
    const theme = workspace_theme ?? legacy
    await api('PUT', '/workspace-theme', theme).catch((e: Error) => console.error(`Could not restore the original theme: ${e.message} (saved in ${join(outDir, 'original-theme.json')})`))
    await browser.close()
  }
  writeSummary(resultsFile, join(outDir, 'summary.md'))
}

/** Failures (pixel ratio < 3:1, not disabled) grouped by element signature, plus per page/mode counts. */
function writeSummary(resultsFile: string, out: string) {
  const rows = readFileSync(resultsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const groups = new Map<string, { n: number; where: Set<string>; example: string }>()
  const perPage = new Map<string, { custom: number; axe: number }>()
  for (const r of rows) {
    const key = `${r.scenario}/${r.mode}`
    const fails = (r.custom ?? []).filter((x: any) => x.ratio < 3 && !x.disabled)
    const agg = perPage.get(key) ?? { custom: 0, axe: 0 }
    agg.custom += fails.length; agg.axe += (r.axe ?? []).length
    perPage.set(key, agg)
    for (const x of fails) {
      const sig = `${x.sig} < ${x.anc?.[0] ?? ''}`
      const g = groups.get(sig) ?? { n: 0, where: new Set<string>(), example: `${r.preset}/${r.mode}/${r.scenario} "${x.text.slice(0, 30)}" ${x.fg} on ${x.bg} = ${x.ratio}:1` }
      g.n++; g.where.add(`${r.preset}/${r.mode}`)
      groups.set(sig, g)
    }
  }
  const lines = ['# Theme DOM contrast audit', '', '| page / mode | text < 3:1 | axe color-contrast |', '|---|---|---|',
    ...[...perPage].sort().map(([k, v]) => `| ${k} | ${v.custom} | ${v.axe} |`), '',
    '## Failures by element (text < 3:1)', '', '| count | presets×modes | element < parent | example |', '|---|---|---|---|',
    ...[...groups].sort((a, b) => b[1].n - a[1].n).map(([k, g]) => `| ${g.n} | ${g.where.size} | \`${k.replace(/\|/g, '\\|').slice(0, 160)}\` | ${g.example.replace(/\|/g, '\\|')} |`)]
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(`→ ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
