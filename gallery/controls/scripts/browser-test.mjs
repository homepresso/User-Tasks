/**
 * Contract tests for the official gallery controls in headless Chrome
 * (playwright-core + the installed Chrome / Chromium; CHROME_PATH to choose).
 *
 *   npm test                 # every control
 *   npm test -- chart map    # some
 *
 * For every control the harness mounts the built module (dist/) the way the
 * frame runtime does — host properties set as properties, each declared prop
 * by name, theme tokens as --ut-* custom properties — answers ut-request
 * with the control's fixtures, and checks the contract:
 *
 *   1. it defines its tag and renders;
 *   2. light and dark themes (tokens change the computed colours);
 *   3. read-only: keyboard and clicks never emit ut-change;
 *   4. accessibility: axe-core (WCAG 2.1 A/AA rules) finds no serious or
 *      critical violation, and every interactive part has an accessible name;
 *   5. mobile: no horizontal overflow at 360 px;
 *   6. the control's own spec (<slug>/test.mjs): keyboard operation, the
 *      value it emits, validity, host requests.
 *
 * Screenshots land in .harness/ (git-ignored) for a visual check.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { controlSlugs, readManifest } from './build.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(ROOT, '..', '..')
const OUT = join(ROOT, '.harness')
const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')

const LIGHT = { mode: 'light', tokens: { 'ut-primary': '#2f5fd0', 'ut-on-primary': '#ffffff', 'ut-text': '#1b1916', 'ut-muted-text': '#5f5a50', 'ut-surface': '#f5f3ee', 'ut-card': '#ffffff', 'ut-border': '#cfc9bb', 'ut-input-bg': '#ffffff', 'ut-input-text': '#1b1916', 'ut-focus-ring': '#2f5fd0', 'ut-error': '#b42318', 'ut-success': '#2f7a4b', 'ut-radius': '8px', 'ut-font-family': 'system-ui, sans-serif', 'ut-font-size': '14px' } }
const DARK = { mode: 'dark', tokens: { 'ut-primary': '#7ea2ff', 'ut-on-primary': '#0d1220', 'ut-text': '#eceae4', 'ut-muted-text': '#a8a397', 'ut-surface': '#1c1b19', 'ut-card': '#262522', 'ut-border': '#4a473f', 'ut-input-bg': '#1f1e1b', 'ut-input-text': '#eceae4', 'ut-focus-ring': '#7ea2ff', 'ut-error': '#f97066', 'ut-success': '#6fcf97', 'ut-radius': '8px', 'ut-font-family': 'system-ui, sans-serif', 'ut-font-size': '14px' } }

function harnessHtml(bundle) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;padding:0}body{font-family:var(--ut-font-family,system-ui);color:var(--ut-text);background:var(--ut-card,#fff)}#ut-root{padding:8px}</style></head>
<body><div id="ut-root"></div>
<script>
window.__events = []; window.__answers = {}; window.__requests = [];
window.__mount = function (tag, state, propNames) {
  var root = document.getElementById('ut-root'); root.innerHTML = '';
  var el = document.createElement(tag);
  ['ut-change','ut-blur','ut-validity','ut-resize'].forEach(function (t) { el.addEventListener(t, function (e) { window.__events.push({ type: t, detail: JSON.parse(JSON.stringify(e.detail || {})) }); }); });
  el.addEventListener('ut-request', function (e) {
    var d = e.detail || {}; window.__requests.push({ kind: d.kind, payload: d.payload instanceof Object && !(d.payload.bytes) ? d.payload : { name: d.payload && d.payload.name, type: d.payload && d.payload.type, size: d.payload && d.payload.bytes && d.payload.bytes.byteLength } });
    var answer = window.__answers[d.kind];
    if (answer === undefined) { d.reject(new Error('No fixture for ' + d.kind)); return; }
    Promise.resolve(typeof answer === 'function' ? answer(d.payload) : answer).then(d.resolve, d.reject);
  });
  window.__apply(el, state, propNames);
  root.appendChild(el);
  return true;
};
window.__apply = function (el, state, propNames) {
  el = el || document.querySelector('#ut-root > *');
  if (state.theme) { var s = document.documentElement.style; Object.keys(state.theme.tokens || {}).forEach(function (k) { s.setProperty('--' + k, state.theme.tokens[k]); }); document.documentElement.setAttribute('data-theme', state.theme.mode); }
  ['value','disabled','readonly','required','invalid','error','props','theme','locale','context','label','description','capabilities'].forEach(function (k) { if (k in state) el[k] = state[k]; });
  if ('readonly' in state) el.readOnly = !!state.readonly;
  if (state.props) (propNames || []).forEach(function (p) { if (p in state.props) el[p] = state.props[p]; });
  if ('label' in state) el.setAttribute('aria-label', state.label || '');
};
</script>
<script type="module">${bundle.replace(/<\/(script)/gi, '<\\u002f$1')}</script>
</body></html>`
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

async function run() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const slugs = only.length ? only : controlSlugs()
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }) })
  const axeDir = join(REPO, 'node_modules', 'axe-core')
  const axe = readFileSync(join(axeDir, existsSync(join(axeDir, 'axe.min.js')) ? 'axe.min.js' : 'axe.js'), 'utf8')
  let failed = 0
  for (const slug of slugs) {
    const manifest = readManifest(slug)
    const entry = manifest.entry ?? `${manifest.tag}.js`
    const bundlePath = join(ROOT, slug, 'dist', entry)
    const specPath = join(ROOT, slug, 'test.mjs')
    const spec = existsSync(specPath) ? await import(pathToFileURL(specPath).href) : {}
    const fixtures = spec.fixtures ?? {}
    const propNames = (manifest.props ?? []).map((p) => p.name)
    const defaults = Object.fromEntries((manifest.props ?? []).filter((p) => p.default !== undefined).map((p) => [p.name, p.default]))
    const baseState = (over = {}) => ({
      value: null, disabled: false, readonly: false, required: false, invalid: false, error: null,
      theme: LIGHT, locale: 'en-NZ', label: spec.label ?? manifest.name, description: 'Help text for the field',
      context: { fields: {}, field_key: 'field', form_id: null, task_id: null, workflow_id: null },
      capabilities: manifest.capabilities ?? [],
      ...over,
      props: { ...defaults, ...(spec.props ?? {}), ...(over.props ?? {}) },
    })
    const context = await browser.newContext({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 1 })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    if (spec.routes) for (const [pattern, handler] of Object.entries(spec.routes)) await page.route(pattern, handler)
    const steps = []
    const step = async (name, fn) => {
      try { await fn(); steps.push(`  ✓ ${name}`) } catch (error) { steps.push(`  ✗ ${name}: ${error.message.split('\n')[0]}`); throw error }
    }
    const h = {
      page, manifest, assert, LIGHT, DARK,
      async mount(over = {}) {
        await page.evaluate(() => { window.__events = []; window.__requests = [] })
        await page.evaluate(([fx]) => {
          window.__answers = {}
          for (const [kind, value] of Object.entries(fx)) {
            if (value && typeof value === 'object' && value.__bytes) {
              window.__answers[kind] = { ...value, bytes: Uint8Array.from(atob(value.__bytes), (c) => c.charCodeAt(0)).buffer, __bytes: undefined }
            } else window.__answers[kind] = value
          }
        }, [fixtures])
        await page.evaluate(([tag, state, names]) => window.__mount(tag, state, names), [manifest.tag, baseState(over), propNames])
        await page.waitForTimeout(spec.settle ?? 150)
        return page.locator(manifest.tag)
      },
      async update(state) { await page.evaluate(([s, names]) => window.__apply(null, s, names), [state, propNames]); await page.waitForTimeout(80) },
      events: (type) => page.evaluate((t) => window.__events.filter((e) => !t || e.type === t), type),
      requests: () => page.evaluate(() => window.__requests),
      lastValue: async () => { const changes = await page.evaluate(() => window.__events.filter((e) => e.type === 'ut-change')); return changes.length ? changes[changes.length - 1].detail.value : undefined },
      shadow: (selector) => page.locator(`${manifest.tag} >> ${selector}`),
      shot: (name) => page.screenshot({ path: join(OUT, `${slug}-${name}.png`), fullPage: true }),
    }
    try {
      await page.setContent(harnessHtml(readFileSync(bundlePath, 'utf8')), { waitUntil: 'load' })
      await step('defines the tag and renders', async () => {
        assert(await page.evaluate((t) => Boolean(customElements.get(t)), manifest.tag), `customElements.get('${manifest.tag}') is empty`)
        await h.mount({ value: spec.sampleValue ?? null })
        const text = await page.evaluate((t) => { const el = document.querySelector(t); return (el.shadowRoot ?? el).innerHTML.length }, manifest.tag)
        assert(text > 20, 'the shadow root is empty')
      })
      await step('light and dark theme', async () => {
        await h.mount({ value: spec.sampleValue ?? null, theme: LIGHT })
        await h.shot('light')
        const light = await page.evaluate((t) => getComputedStyle(document.querySelector(t)).color, manifest.tag)
        await h.mount({ value: spec.sampleValue ?? null, theme: DARK })
        await page.evaluate(() => { document.body.style.background = '#262522' })
        await h.shot('dark')
        const dark = await page.evaluate((t) => getComputedStyle(document.querySelector(t)).color, manifest.tag)
        assert(light !== dark, `text colour did not follow the theme (${light} / ${dark})`)
        await page.evaluate(() => { document.body.style.background = '' })
      })
      await step('read-only never emits ut-change', async () => {
        await h.mount({ value: spec.sampleValue ?? null, readonly: true })
        const el = page.locator(manifest.tag)
        await el.click({ position: { x: 20, y: 14 } }).catch(() => {})
        for (const key of ['Tab', 'ArrowRight', 'ArrowDown', 'Enter', ' ', 'Home', 'End', 'Delete', 'a']) await page.keyboard.press(key)
        const changes = await h.events('ut-change')
        assert(changes.length === 0, `emitted ${changes.length} ut-change while read-only`)
        await h.shot('readonly')
      })
      await step('accessibility (axe-core, WCAG 2.1 A/AA)', async () => {
        await h.mount({ value: spec.sampleValue ?? null })
        await page.addScriptTag({ content: axe }).catch(() => {})
        const result = await page.evaluate(async (t) => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document.querySelector(t), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { region: { enabled: false } } })
          return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`)
        }, manifest.tag)
        assert(result.length === 0, result.join('; '))
      })
      await step('mobile: no horizontal overflow at 360 px', async () => {
        await page.setViewportSize({ width: 360, height: 800 })
        await h.mount({ value: spec.sampleValue ?? null })
        await page.waitForTimeout(250)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        await h.shot('mobile')
        assert(overflow <= 1, `the page scrolls sideways by ${overflow}px`)
        await page.setViewportSize({ width: 720, height: 900 })
      })
      if (spec.default) await step('control spec', () => spec.default(h))
      const real = errors.filter((e) => !(spec.ignoreErrors ?? []).some((re) => new RegExp(re).test(e)))
      assert(real.length === 0, `page errors: ${real.slice(0, 3).join(' | ')}`)
      console.log(`✓ ${slug}\n${steps.join('\n')}`)
    } catch (error) {
      failed++
      console.log(`✗ ${slug}\n${steps.join('\n')}\n    ${error.message}${errors.length ? `\n    page errors: ${errors.slice(0, 3).join(' | ')}` : ''}`)
      await page.screenshot({ path: join(OUT, `${slug}-failure.png`), fullPage: true }).catch(() => {})
    } finally {
      await context.close()
    }
  }
  await browser.close()
  if (failed) { console.log(`\n${failed} control${failed === 1 ? '' : 's'} failed`); process.exit(1) }
  console.log(`\n✓ ${slugs.length} control${slugs.length === 1 ? '' : 's'} pass the contract tests`)
}

await run()
