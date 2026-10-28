/**
 * Capture the app screenshots for the docs / marketing pages from the seeded
 * "Northwind Trading" demo workspace (run seed-demo.ts first).
 *
 *   SCREENSHOT_TOOLS_DIR=/path/with/playwright-core npx tsx scripts/screenshots/capture.ts [name ...]
 *
 * Signs in as the demo owner in system Chrome (playwright-core, channel
 * "chrome"), renders each page at 1440×900 CSS px with deviceScaleFactor 2 in
 * the light theme, and writes public/screenshots/<name>.webp (sharp, ≤ ~250 KB).
 * Pass shot names to capture only those.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- playwright types come from an external tools dir */
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_URL, DEMO, OUT, SHOTS, assertLocal, ensureDir, readState, requireTool } from './common'

assertLocal()

const MAX_BYTES = 250 * 1024
const VIEWPORT = { width: 1440, height: 900 }
const STATE_FILE = join(OUT, 'browser-state.json')
const state = readState()
if (!state.workflow_id) throw new Error('No demo state: run scripts/screenshots/seed-demo.ts first.')

const { chromium } = requireTool('playwright-core')
const sharp = requireTool('sharp')

/** Freeze motion and hide transient chrome (toasts, the MCP promo banner). */
const CLEAN_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; }
  [data-sonner-toaster], [data-sonner-toast], [role="status"][aria-live], #nextjs-portal, nextjs-portal { display: none !important; }
  ::-webkit-scrollbar { display: none; }
`

type Page = any
interface Shot {
  name: string
  path: string
  viewport?: { width: number; height: number }
  collapseSidebar?: boolean
  /** Pages that keep a connection open never reach networkidle. */
  waitUntil?: 'load' | 'networkidle'
  prepare?: (page: Page) => Promise<void>
}

async function hideByText(page: Page, text: string, levels = 3) {
  await page.evaluate(({ text, levels }: { text: string; levels: number }) => {
    const el = [...document.querySelectorAll('p, span, h2, h3, div')].find((e) => e.childElementCount === 0 && e.textContent?.trim().startsWith(text))
    let target: HTMLElement | null = el as HTMLElement | null
    // Walk up to the banner, but never to a container of the page itself
    // (on /automations four levels up is the whole content column).
    for (let i = 0; i < levels && target?.parentElement && target.parentElement.getBoundingClientRect().height < 160; i++) target = target.parentElement
    if (target) target.style.display = 'none'
  }, { text, levels })
}

async function scrollMain(page: Page, selectorOrY: string | number, offset = 0) {
  await page.evaluate(({ selectorOrY, offset }: { selectorOrY: string | number; offset: number }) => {
    const main = document.querySelector('main') as HTMLElement | null
    if (!main) return
    if (typeof selectorOrY === 'number') { main.scrollTop = selectorOrY; return }
    const el = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && e.textContent?.trim().toLowerCase() === selectorOrY.toLowerCase()) as HTMLElement | undefined
    if (!el) return
    main.scrollTop += el.getBoundingClientRect().top - main.getBoundingClientRect().top - offset
  }, { selectorOrY, offset })
}

async function zoomCanvas(page: Page, clicks: number) {
  const button = page.locator(clicks < 0 ? 'button[title="Zoom out"]' : 'button[title="Zoom in"]').first()
  for (let i = 0; i < Math.abs(clicks); i++) await button.click()
}

/** Open the live instances panel (and the migration wizard up to `step`) on a workflow page. */
async function openMigration(page: Page, step: 'panel' | 'nodes' | 'review') {
  await page.getByText(/live instances? on older versions|live instances?$/).first().click()
  await page.getByRole('checkbox', { name: 'Select all' }).waitFor({ timeout: 15_000 })
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  if (step === 'panel') return
  await page.getByRole('button', { name: /Migrate to version/ }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.waitForTimeout(400)
  if (step === 'nodes') return
  await page.getByRole('button', { name: /Review plan/ }).click()
  await page.getByRole('button', { name: /^Migrate \d+ instance/ }).waitFor({ timeout: 15_000 })
}

/** Open the Run dialog of the "Customer welcome pack" workflow from the workflow list and fill the required input. */
async function openRunDialog(page: Page) {
  await page.getByRole('button', { name: 'Run Customer welcome pack' }).first().click()
  await page.getByLabel(/^Customer name/).waitFor({ timeout: 15_000 })
  await page.getByLabel(/^Customer name/).fill('Harbourside Traders Ltd')
  await page.waitForTimeout(300)
}

const SHOTS_LIST: Shot[] = [
  {
    name: 'designer',
    path: `/automations/${state.workflow_id}`,
    collapseSidebar: true,
    async prepare(page) {
      await zoomCanvas(page, -4) // 60%
      await page.getByText('Approve invoice', { exact: true }).first().click()
      await page.waitForTimeout(600)
      // Scroll the config panel (not the page) to the outcomes + fields.
      await page.evaluate(() => {
        const label = [...document.querySelectorAll('label')].find((l) => l.textContent?.trim() === 'Outcomes')
        let panel = label?.parentElement ?? null
        while (panel && !(panel.scrollHeight > panel.clientHeight + 20 && getComputedStyle(panel).overflowY === 'auto')) panel = panel.parentElement
        if (label && panel) panel.scrollTop += label.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12
      })
    },
  },
  {
    name: 'run-detail',
    path: `/automations/runs/${state.failed_run_id}`,
    async prepare(page) {
      await zoomCanvas(page, -3)
      await scrollMain(page, 'Process View', 230)
    },
  },


  {
    name: 'task-detail',
    path: `/tasks/${state.task_id}`,
    viewport: { width: 1440, height: 1240 },
    async prepare(page) {
      // Fill the typed fields as an approver would (not submitted).
      await page.getByText('Select…', { exact: true }).first().click().catch(() => {})
      await page.waitForTimeout(300)
      await page.getByText('CC-200 Sales', { exact: true }).first().click().catch(() => {})
      await page.getByPlaceholder('Reason for approving or rejecting').fill('PO-8812 matched; consulting hours agreed with Tailspin.').catch(() => {})
      await page.mouse.click(5, 300)
      await page.waitForTimeout(300)
    },
  },
  {
    name: 'integrations',
    path: `/integrations/${state.integration_id}`,
    async prepare(page) {
      await page.getByText('References', { exact: true }).first().click()
      await page.waitForTimeout(1200)
    },
  },
  { name: 'decision-table', path: `/automations/rules/${state.decision_table_id}` },
  { name: 'log-export', path: '/settings/log-export' },
  { name: 'reports', path: `/reports/${state.report_id}` },
  // Nice to have
  { name: 'tasks-queue', path: '/tasks/queue' },
  {
    name: 'email-template',
    path: '/automations/email-templates',
    async prepare(page) {
      await page.locator('button[title*="Edit" i], button[aria-label*="Edit" i]').first().click().catch(async () => {
        await page.getByText('Invoice approved', { exact: true }).first().click()
      })
      await page.waitForTimeout(1200)
    },
  },
  { name: 'data-table', path: `/data/${state.data_table_id}` },
  { name: 'custom-step', path: '/extensibility' },
  {
    name: 'roles',
    path: '/settings/governance',
    async prepare(page) {
      await scrollMain(page, 'Custom roles', 120)
    },
  },
  { name: 'api-keys', path: '/settings/api-keys' },
  // Run dialog for a workflow with three typed inputs (nothing is started).
  { name: 'run-workflow', path: '/automations', prepare: openRunDialog },
  // Live instance migration: Vendor onboarding runs wait on v1, v2 is published.
  // Nothing is migrated (the wizard stops at the plan).
  { name: 'live-instances', path: `/automations/${state.onboarding_workflow_id}`, collapseSidebar: true, prepare: (page) => openMigration(page, 'panel') },
  { name: 'migrate-instances', path: `/automations/${state.onboarding_workflow_id}`, collapseSidebar: true, prepare: (page) => openMigration(page, 'nodes') },
  { name: 'migrate-instances-review', path: `/automations/${state.onboarding_workflow_id}`, collapseSidebar: true, prepare: (page) => openMigration(page, 'review') },
  // Theme designer with an unsaved custom theme (the demo workspace keeps its own theme).
  { name: 'theme-designer', path: '/settings/theme', viewport: { width: 1440, height: 1100 }, waitUntil: 'load', prepare: (page) => customiseTheme(page, 'light') },
  { name: 'theme-designer-dark', path: '/settings/theme', viewport: { width: 1440, height: 1100 }, waitUntil: 'load', prepare: (page) => customiseTheme(page, 'dark') },
]

/** Start from a template, rebrand it (colours, fonts, shape) and show the Colours section. */
async function customiseTheme(page: Page, mode: 'light' | 'dark') {
  await page.getByText('Live preview', { exact: false }).first().waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: /^Midnight Blue/ }).first().click()
  await page.getByRole('textbox', { name: 'Theme name', exact: true }).fill('Northwind brand')
  // Collapse the template list, open Colours, Typography stays closed.
  await page.getByRole('button', { name: /^Start from template/ }).click()
  await page.getByRole('button', { name: /^Colours/ }).click()
  if (mode === 'dark') await page.locator('label', { hasText: /^Dark$/ }).first().click()
  const colour = async (label: string, value: string) => page.getByRole('textbox', { name: label, exact: true }).fill(value)
  if (mode === 'light') {
    await colour('Primary', '#1D4ED8')
    await colour('Primary hover', '#1E40AF')
    await colour('Primary tint', '#DBEAFE')
    await colour('Accent', '#7C3AED')
  } else {
    await colour('Primary', '#60A5FA')
    await colour('Primary hover', '#93C5FD')
    await colour('Accent', '#A78BFA')
  }
  await page.getByRole('button', { name: /^Typography/ }).click()
  await page.getByRole('combobox', { name: 'Body & UI', exact: true }).selectOption('google:Plus Jakarta Sans')
  await page.getByRole('combobox', { name: 'Display (headings)', exact: true }).selectOption('google:Fraunces')
  await page.locator('label', { hasText: /^Display font$/ }).first().click()
  await page.getByRole('button', { name: /^Typography/ }).click()
  await page.getByRole('button', { name: mode === 'dark' ? 'Dark' : 'Light', exact: true }).click()
  // Settings pane back to the top of Colours (the page itself stays at the top).
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.trim().startsWith('Colours')) as HTMLElement | undefined
    let pane = heading?.parentElement ?? null
    while (pane && getComputedStyle(pane).overflowY !== 'auto') pane = pane.parentElement
    if (heading && pane) pane.scrollTop += heading.getBoundingClientRect().top - pane.getBoundingClientRect().top - 120
  })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
}

async function login(browser: any) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' })
  const page = await context.newPage()
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.fill('#tenant', DEMO.slug)
  await page.fill('#email', DEMO.email)
  await page.fill('#password', DEMO.password)
  await page.click('button[type=submit]')
  await page.waitForURL((url: URL) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  if (new URL(page.url()).pathname.startsWith('/onboarding')) {
    throw new Error('Demo owner landed on /onboarding: finish onboarding once in a browser (or mark it complete) and re-run.')
  }
  await page.waitForLoadState('networkidle')
  await context.storageState({ path: STATE_FILE })
  await context.close()
}

async function encode(png: Buffer): Promise<{ data: Buffer; quality: number; width: number; height: number }> {
  let last: Buffer = png
  for (const quality of [80, 76, 72, 68, 64, 60]) {
    last = await sharp(png).webp({ quality, effort: 6, smartSubsample: true }).toBuffer()
    if (last.length <= MAX_BYTES) {
      const meta = await sharp(last).metadata()
      return { data: last, quality, width: meta.width, height: meta.height }
    }
  }
  const meta = await sharp(last).metadata()
  return { data: last, quality: 60, width: meta.width, height: meta.height }
}

async function capture(browser: any, shot: Shot, scale: number) {
  const viewport = shot.viewport ?? VIEWPORT
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'light', storageState: STATE_FILE, reducedMotion: 'reduce' })
  await context.addInitScript((css: string) => {
    try { localStorage.setItem('theme', 'light') } catch { /* ignore */ }
    const add = () => { const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style) }
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add)
  }, CLEAN_CSS)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('response', (r: any) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`) })
  await page.goto(`${APP_URL}${shot.path}`, { waitUntil: shot.waitUntil ?? 'networkidle', timeout: 60_000 })
  if (new URL(page.url()).pathname.startsWith('/login')) throw new Error('Session expired: delete scripts/screenshots/.out/browser-state.json and re-run.')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1200)
  await hideByText(page, 'Build with AI', 4)
  if (shot.collapseSidebar) {
    await page.locator('aside button, nav button').first().click().catch(() => {})
    await page.waitForTimeout(400)
  }
  if (shot.prepare) await shot.prepare(page)
  await page.waitForLoadState('networkidle', { timeout: shot.waitUntil === 'load' ? 3_000 : 30_000 }).catch(() => {})
  await page.waitForTimeout(800)
  const png: Buffer = await page.screenshot({ type: 'png' })
  await context.close()
  return { png, errors }
}

async function main() {
  ensureDir(SHOTS)
  const only = process.argv.slice(2)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    if (!existsSync(STATE_FILE) || process.env.FRESH_LOGIN) await login(browser)
    // Drain the log shipper so Log Export shows caught-up destinations.
    if (process.env.CRON_SECRET) {
      for (let i = 0; i < 2; i++) {
        await fetch(`${APP_URL}/api/cron/ship-events?budget_ms=4000`, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }).catch(() => null)
      }
    }
    for (const shot of SHOTS_LIST) {
      if (only.length && !only.includes(shot.name)) continue
      let scale = 2
      let { png, errors } = await capture(browser, shot, scale)
      let out = await encode(png)
      if (out.data.length > MAX_BYTES) {
        scale = 1.5
        ;({ png, errors } = await capture(browser, shot, scale))
        out = await encode(png)
      }
      const file = join(SHOTS, `${shot.name}.webp`)
      writeFileSync(file, out.data)
      if (process.env.SCREENSHOT_DEBUG_DIR) writeFileSync(join(process.env.SCREENSHOT_DEBUG_DIR, `${shot.name}.png`), png)
      console.log(`${shot.name.padEnd(22)} ${String(out.width)}×${out.height}  ${(out.data.length / 1024).toFixed(0)} KB  q${out.quality} @${scale}x  ${shot.path}${errors.length ? `  (5xx: ${errors.join(', ')})` : ''}`)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
