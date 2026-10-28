/**
 * Packages screenshots (docs page "Packages"): the library, Complete setup,
 * the install / upgrade wizard and the "Needs configuration" banner, taken
 * in a TARGET workspace that installed a package built in the demo
 * workspace (see the Packages section of README.md here).
 *
 *   PKG_TARGET_SLUG=… PKG_TARGET_EMAIL=… PKG_TARGET_PASSWORD=… PKG_WORKFLOW_ID=<installed workflow id> \
 *   PKG_REQUIREMENT_VALUES='{"<requirement id>":{"<field>":"value"}}' \
 *     npx tsx scripts/screenshots/packages.ts incomplete      # banner, library (incomplete), Complete setup (submits it)
 *   PKG_TARGET_… PKG_FILE=invoice-approval-1.0.1.utpkg npx tsx scripts/screenshots/packages.ts upgrade   # wizard (not applied)
 *   npx tsx scripts/screenshots/packages.ts authored          # Authored tab + package editor in the demo workspace
 *
 * Same conventions as capture.ts: system Chrome via playwright-core
 * (SCREENSHOT_TOOLS_DIR), 1440×900 @2x light theme, webp ≤ ~250 KB in
 * public/screenshots/.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- playwright types come from an external tools dir */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { APP_URL, DEMO, SHOTS, assertLocal, ensureDir, requireTool } from './common'

assertLocal()

const MAX_BYTES = 250 * 1024
const VIEWPORT = { width: 1440, height: 900 }
const { chromium } = requireTool('playwright-core')
const sharp = requireTool('sharp')
const CLEAN_CSS = `
  *, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; caret-color: transparent !important; }
  [data-sonner-toaster], [data-sonner-toast], #nextjs-portal, nextjs-portal { display: none !important; }
  ::-webkit-scrollbar { display: none; }
`

async function encode(png: Buffer): Promise<Buffer> {
  let last: Buffer = png
  for (const quality of [80, 74, 68, 62, 56]) {
    last = await sharp(png).webp({ quality, effort: 6, smartSubsample: true }).toBuffer()
    if (last.length <= MAX_BYTES) return last
  }
  return last
}

async function shoot(page: any, name: string) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(900)
  const data = await encode(await page.screenshot({ type: 'png' }))
  writeFileSync(join(SHOTS, `${name}.webp`), data)
  console.log(`${name.padEnd(30)} ${(data.length / 1024).toFixed(0)} KB`)
}

async function session(browser: any, creds: { slug: string; email: string; password: string }) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript((css: string) => {
    try { localStorage.setItem('theme', 'light') } catch { /* ignore */ }
    const add = () => { const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style) }
    if (document.head) add(); else document.addEventListener('DOMContentLoaded', add)
  }, CLEAN_CSS)
  const page = await context.newPage()
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.fill('#tenant', creds.slug)
  await page.fill('#email', creds.email)
  await page.fill('#password', creds.password)
  await page.click('button[type=submit]')
  await page.waitForURL((url: URL) => !url.pathname.startsWith('/login'), { timeout: 30_000 })
  return { context, page }
}

const target = () => ({ slug: process.env.PKG_TARGET_SLUG!, email: process.env.PKG_TARGET_EMAIL!, password: process.env.PKG_TARGET_PASSWORD ?? DEMO.password })

async function incomplete(browser: any) {
  const { context, page } = await session(browser, target())
  if (process.env.PKG_WORKFLOW_ID) {
    await page.goto(`${APP_URL}/automations/${process.env.PKG_WORKFLOW_ID}`, { waitUntil: 'networkidle' })
    await page.getByTestId('package-setup-banner').waitFor({ timeout: 20_000 })
    await shoot(page, 'packages-needs-configuration')
  }
  await page.goto(`${APP_URL}/settings/packages`, { waitUntil: 'load' })
  await page.getByTestId('install-checklist').waitFor({ timeout: 20_000 })
  await shoot(page, 'packages-library-incomplete')
  await page.getByTestId('complete-setup').click()
  await page.getByTestId('requirements-form').waitFor()
  const values = JSON.parse(process.env.PKG_REQUIREMENT_VALUES ?? '{}') as Record<string, Record<string, string>>
  for (const [requirement, fields] of Object.entries(values)) {
    for (const [field, value] of Object.entries(fields)) {
      await page.locator(`input[data-requirement="${requirement}"][data-field="${field}"]`).fill(value)
    }
  }
  await shoot(page, 'packages-complete-setup')
  await page.getByTestId('complete-submit').click()
  await page.getByText('setup complete').waitFor({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Details' }).first().click().catch(() => {})
  await page.waitForTimeout(800)
  await shoot(page, 'packages-library-complete')
  await context.close()
}

async function upgrade(browser: any) {
  const { context, page } = await session(browser, target())
  await page.goto(`${APP_URL}/settings/packages`, { waitUntil: 'load' })
  await page.getByRole('button', { name: 'Upgrade' }).first().click()
  await page.getByTestId('package-file').setInputFiles(resolve(process.env.PKG_FILE!))
  await page.getByRole('button', { name: 'Review changes' }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-testid="wizard-next"]')?.hasAttribute('disabled'), null, { timeout: 30_000 })
  await shoot(page, 'packages-wizard-package')
  await page.getByTestId('wizard-next').click()
  await page.getByTestId('install-plan').waitFor({ timeout: 60_000 })
  await shoot(page, 'packages-wizard-changes')
  await page.getByTestId('wizard-next').click()
  await page.getByTestId('requirements-form').waitFor()
  await shoot(page, 'packages-wizard-configure')
  await context.close()
}

async function authored(browser: any) {
  const { context, page } = await session(browser, DEMO)
  await page.goto(`${APP_URL}/settings/packages`, { waitUntil: 'load' })
  await page.getByRole('tab', { name: /Authored here/ }).click()
  await page.getByTestId('build-version').first().waitFor({ timeout: 20_000 })
  await shoot(page, 'packages-authored')
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByTestId('package-contents').waitFor({ timeout: 20_000 })
  await page.getByText('Asked for on install').waitFor({ timeout: 30_000 })
  await shoot(page, 'packages-editor')
  await context.close()
}

async function main() {
  ensureDir(SHOTS)
  const phase = process.argv[2] ?? 'incomplete'
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    if (phase === 'incomplete') await incomplete(browser)
    else if (phase === 'upgrade') await upgrade(browser)
    else if (phase === 'authored') await authored(browser)
    else throw new Error(`Unknown phase ${phase} (incomplete | upgrade | authored)`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
