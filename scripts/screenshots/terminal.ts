/**
 * Terminal screenshots: run the real `usertasks` CLI against the local demo
 * workspace, redact secrets, render each session as a styled terminal window
 * and screenshot it to public/screenshots/cli-*.webp. The redacted raw
 * transcripts go to scripts/screenshots/transcripts/*.txt.
 *
 *   SCREENSHOT_TOOLS_DIR=/path/with/playwright-core npx tsx scripts/screenshots/terminal.ts [session ...]
 *
 * Commands run through `sh -c` in a scratch work dir with a `usertasks` shim on
 * PATH (USERTASKS_CLI_BIN: built dist/bin.js, else the TypeScript source via
 * tsx), an isolated XDG_CONFIG_HOME and USERTASKS_OUTPUT=table (what a user sees
 * on a TTY). Side effects are cleaned up (the created role, template and log
 * destination are deleted afterwards); the workflow-edit session publishes a
 * real new version of "Invoice approval".
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- playwright types come from an external tools dir */
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_URL, FAKE_TOKEN, MOCK_URL, OUT, ROOT, SHOTS, TRANSCRIPTS, assertLocal, ensureDir, makeApi, readApiKey, readState, requireTool, sleep,
} from './common'

assertLocal()

const KEY = readApiKey()
const state = readState()
const api = makeApi(KEY)
const CRON_SECRET = process.env.CRON_SECRET ?? ''
const WORK = join(OUT, 'terminal-work')
const BIN = join(WORK, 'bin')
const XDG = join(WORK, 'xdg')
const MAX_BYTES = 250 * 1024

// ─── CLI shim + shell ───

function setupWork() {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(BIN, { recursive: true })
  mkdirSync(XDG, { recursive: true })
  const dist = process.env.USERTASKS_CLI_BIN ?? join(ROOT, 'packages', 'cli', 'dist', 'bin.js')
  const useDist = Boolean(process.env.USERTASKS_CLI_BIN) && existsSync(dist)
  const exec = useDist
    ? `exec "${process.execPath}" "${dist}" "$@"`
    : `exec "${process.execPath}" "${join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')}" --tsconfig "${join(ROOT, 'packages', 'cli', 'tsconfig.json')}" "${join(ROOT, 'packages', 'cli', 'src', 'bin.ts')}" "$@"`
  writeFileSync(join(BIN, 'usertasks'), `#!/bin/sh\n${exec}\n`)
  chmodSync(join(BIN, 'usertasks'), 0o755)
}

const shellEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${BIN}:${process.env.PATH}`,
  USERTASKS_API_KEY: '',
  USERTASKS_URL: '',
  USERTASKS_PROFILE: '',
  HOME: WORK,
  XDG_CONFIG_HOME: XDG,
  USERTASKS_OUTPUT: 'table',
  COLUMNS: '110',
  LANG: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  UT_DEMO_KEY: KEY,
})

function sh(command: string, input?: string): string {
  try {
    return execFileSync('/bin/sh', ['-c', `${command} 2>&1`], { cwd: WORK, env: shellEnv(), encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024 })
  } catch (error: any) {
    return String(error.stdout ?? '') + String(error.stderr ?? '')
  }
}

// ─── Sessions ───

type Line = { kind: 'cmd' | 'out' | 'comment'; text: string }
interface Session { name: string; title: string; lines: Line[] }

class Recorder {
  lines: Line[] = []
  /** Show `display` at the prompt, run `run` (defaults to display). */
  run(display: string, run = display, input?: string): string {
    this.lines.push({ kind: 'cmd', text: display })
    const out = sh(run, input).replace(/\s+$/, '')
    if (out) this.lines.push({ kind: 'out', text: out })
    return out
  }
  comment(text: string) { this.lines.push({ kind: 'comment', text: `# ${text}` }) }
  out(text: string) { this.lines.push({ kind: 'out', text }) }
}

const short = (id: string) => id

async function cron(path: string) {
  await fetch(`${APP_URL}${path}`, { method: 'POST', headers: { authorization: `Bearer ${CRON_SECRET}`, 'content-type': 'application/json' }, body: '{}' }).catch(() => null)
}

async function sessionLogin(): Promise<Session> {
  const r = new Recorder()
  r.run(`echo "$USERTASKS_API_KEY" | usertasks login --url ${APP_URL} --api-key -`, `printf '%s\\n' "$UT_DEMO_KEY" | usertasks login --url ${APP_URL} --api-key -`)
  r.run('usertasks whoami')
  r.run('usertasks workflows list')
  return { name: 'cli-login', title: 'usertasks — login', lines: r.lines }
}

async function sessionEditWorkflow(): Promise<Session> {
  const id = short(state.workflow_id)
  const r = new Recorder()
  r.run(`usertasks workflows definition ${id} -o json > wf.json`)
  r.comment('Give approvers one day instead of two')
  r.run(`jq '(.nodes[] | select(.id == "approve") | .config.due_offset_amount) = 1' wf.json > wf.next && mv wf.next wf.json`)
  r.run(`usertasks workflows update ${id} -f wf.json`)
  r.run(`usertasks workflows publish ${id} --set notes="Approvers get 1 day instead of 2"`)
  r.run(`usertasks workflows versions ${id}`)
  // Restore the 2-day due date (unpublished draft only) so re-runs keep showing a change.
  sh(`jq '(.nodes[] | select(.id == "approve") | .config.due_offset_amount) = 2' wf.json > wf.next && usertasks workflows update ${id} -f wf.next -o json`)
  return { name: 'cli-edit-workflow', title: 'usertasks — edit a workflow as code', lines: r.lines }
}

async function sessionCrud(): Promise<Session> {
  const r = new Recorder()
  writeFileSync(join(WORK, 'role.yaml'), [
    'name: Payments clerk',
    'description: Prepares vendor payments; cannot approve them',
    'permissions:',
    '  - tasks.view_own',
    '  - workflows.view',
    '  - data.view',
    '  - data.manage_rows',
    '',
  ].join('\n'))
  const tplOut = r.run(`usertasks email-templates create --set name="Payment scheduled" --set subject="Payment for {{invoice_number}} scheduled" --set html_body="<p>{{vendor_name}} will be paid on {{scheduled_for}}.</p>" -o yaml`)
  r.run('cat role.yaml')
  const roleOut = r.run('usertasks roles create -f role.yaml -o yaml')
  const roleId = (roleOut.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [])[0]
  if (roleId) {
    r.run(`usertasks roles update ${roleId} --set permissions:='["tasks.view_own","tasks.complete","workflows.view","data.view","data.manage_rows"]' -o yaml`)
    r.run(`usertasks roles delete ${roleId} --yes`)
  }
  // Clean up the template (not shown).
  const tplId = (tplOut.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [])[0]
  if (tplId) await api('DELETE', `/email-templates/${tplId}`).catch(() => null)
  return { name: 'cli-crud', title: 'usertasks — create, update, delete', lines: r.lines }
}

async function sessionMigrateInstances(): Promise<Session> {
  const id = short(state.onboarding_workflow_id)
  const r = new Recorder()
  r.run(`usertasks workflows instances ${id} -o table`)
  r.run(`V2=$(usertasks workflows versions ${id} -o json | jq -r '.versions[0].id')`)
  const v2 = sh(`usertasks workflows versions ${id} -o json | jq -r '.versions[0].id'`).trim()
  r.comment('Plan only: every live instance → the newest version, continuing at the same node')
  r.run(`usertasks workflows migrate-instances ${id} --to $V2 --all --dry-run -o table`, `usertasks workflows migrate-instances ${id} --to ${v2} --all --dry-run -o table`)
  return { name: 'cli-migrate-instances', title: 'usertasks — migrate live instances', lines: r.lines }
}

async function sessionLogDestinations(): Promise<Session> {
  const r = new Recorder()
  // Remove a leftover from an earlier run.
  for (const d of (await api('GET', '/log-destinations?limit=100')).log_destinations ?? []) {
    if (d.name === 'Splunk (audit)') await api('DELETE', `/log-destinations/${d.id}`).catch(() => null)
  }
  // The HEC base URL: the shipper appends /services/collector/event (lib/log-export/formats/splunk-hec.ts).
  writeFileSync(join(WORK, 'splunk.json'), [
    '{',
    '  "name": "Splunk (audit)",',
    '  "type": "splunk_hec",',
    `  "config": { "url": "${MOCK_URL}", "index": "usertasks_audit" },`,
    `  "credentials": { "token": "${FAKE_TOKEN}" },`,
    '  "filters": { "categories": ["workflow", "task", "audit"], "min_severity": "info" },',
    '  "start_from": "retention_start"',
    '}',
    '',
  ].join('\n'))
  r.run('cat splunk.json')
  const created = r.run(`usertasks log-destinations create -f splunk.json -o json | jq '.log_destination | {id, name, type, status}'`)
  const id = (created.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) ?? [])[0]
  if (CRON_SECRET) { await cron('/api/cron/ship-events?budget_ms=5000'); await cron('/api/cron/ship-events?budget_ms=3000') }
  if (id) {
    r.run(`usertasks log-destinations status ${id}`)
    await api('DELETE', `/log-destinations/${id}`).catch(() => null)
  }
  return { name: 'cli-log-destinations', title: 'usertasks — log export', lines: r.lines }
}

async function sessionLogsTail(): Promise<Session> {
  const r = new Recorder()
  const display = 'usertasks logs tail --category workflow'
  r.lines.push({ kind: 'cmd', text: display })
  const child = spawn('/bin/sh', ['-c', `${display} 2>&1`], { cwd: WORK, env: shellEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  let buf = ''
  child.stdout.on('data', (c: Buffer) => { buf += c.toString() })
  await sleep(2500)
  // Start a few invoices in parallel and let the queue processor run them.
  const invoices = [
    { invoice_number: 'INV-24031', vendor_id: 'V-1005', amount: 380, currency: 'NZD', requester_name: 'Grace Hopper', requester_email: 'grace@northwind.example' },
    { invoice_number: 'INV-24032', vendor_id: 'V-1002', amount: 6120, currency: 'NZD', requester_name: 'Alan Turing', requester_email: 'alan@northwind.example' },
    { invoice_number: 'INV-24033', vendor_id: 'V-1001', amount: 95.4, currency: 'NZD', requester_name: 'Margaret Hamilton', requester_email: 'margaret@northwind.example' },
  ]
  await Promise.all(invoices.map((variables) => api('POST', '/workflows/start', { workflow_id: state.workflow_id, variables, async: true })))
  if (CRON_SECRET) { await cron('/api/workflows/process'); await sleep(1500); await cron('/api/workflows/process') }
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && buf.split('\n').filter(Boolean).length < 18) await sleep(500)
  await sleep(1500)
  // Ctrl-C the whole process group (sh → tsx → node).
  try { process.kill(-child.pid!, 'SIGINT') } catch { /* already gone */ }
  await sleep(500)
  try { process.kill(-child.pid!, 'SIGKILL') } catch { /* already gone */ }
  const lines = buf.replace(/\s+$/, '').split('\n').slice(0, 18)
  r.out(lines.join('\n'))
  r.out('^C')
  return { name: 'cli-logs-tail', title: 'usertasks — logs tail', lines: r.lines }
}

async function sessionConfigDiff(): Promise<Session> {
  const r = new Recorder()
  r.run('usertasks config export ./config')
  const file = sh('ls config/decision-tables/ | head -1').trim()
  r.comment('Raise the auto-approve limit from 1,000 to 1,500')
  r.run(`sed -i '' 's/"value": "1000"/"value": "1500"/' config/decision-tables/${file}`, `sed -i.bak 's/"value": "1000"/"value": "1500"/' config/decision-tables/${file} && rm -f config/decision-tables/${file}.bak`)
  r.run('usertasks config diff ./config')
  return { name: 'cli-config-diff', title: 'usertasks — config as code', lines: r.lines }
}

// ─── Redaction ───

function redact(text: string): string {
  return text
    .split(KEY).join('ut_••••••••')
    .replace(/\but_[0-9a-f]{16,}\b/g, 'ut_••••••••')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, 'whsec_••••••••')
    .replace(/(bearer|token|secret|password|api[_-]?key)("?\s*[:=]\s*"?)(?!__SECRET__|00000000-|ut_••)[A-Za-z0-9._\-]{16,}/gi, `$1$2${FAKE_TOKEN}`)
    .split(WORK).join('~/northwind')
    .split(XDG).join('~/.config')
}

// ─── Rendering ───

const ANSI_COLORS: Record<number, string> = {
  30: '#4b5563', 31: '#f87171', 32: '#4ade80', 33: '#facc15', 34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e5e7eb',
  90: '#6b7280', 91: '#fca5a5', 92: '#86efac', 93: '#fde047', 94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#f9fafb',
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** SGR (colour / bold / dim) escapes → spans; other escapes are dropped. */
function ansiToHtml(text: string): string {
  let html = ''
  let open = 0
  const parts = text.split(/(\x1b\[[0-9;]*m)/)
  for (const part of parts) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/)
    if (!m) { html += escapeHtml(part.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')); continue }
    const codes = m[1].split(';').filter(Boolean).map(Number)
    if (codes.length === 0 || codes.includes(0)) { html += '</span>'.repeat(open); open = 0; continue }
    const style: string[] = []
    for (const c of codes) {
      if (c === 1) style.push('font-weight:700')
      else if (c === 2) style.push('opacity:.65')
      else if (ANSI_COLORS[c]) style.push(`color:${ANSI_COLORS[c]}`)
    }
    if (style.length) { html += `<span style="${style.join(';')}">`; open++ }
  }
  return html + '</span>'.repeat(open)
}

/** Light syntax tint for the prompt line: the binary, flags and strings. */
function highlightCommand(cmd: string): string {
  return escapeHtml(cmd)
    .replace(/(&quot;|")([^"]*?)\1|'([^']*)'/g, (m) => `<span class="str">${m}</span>`)
    .replace(/(^|\s)(usertasks)(?=\s)/g, '$1<span class="bin">$2</span>')
    .replace(/(\s)(--?[a-z][a-z-]*)/g, '$1<span class="flag">$2</span>')
}

function renderHtml(session: Session): string {
  // Shrink the font (13.5 → ≥ 11 px) until the widest line fits the 1160 px window.
  const longest = Math.max(...session.lines.flatMap((l) => redact(l.text).split('\n').map((t) => t.replace(/\x1b\[[0-9;]*m/g, '').length + (l.kind === 'cmd' ? 2 : 0))))
  const fontSize = Math.max(11, Math.min(13.5, Math.floor((1060 / (0.6 * longest)) * 10) / 10))
  const body = session.lines.map((line) => {
    if (line.kind === 'cmd') return `<div class="line"><span class="prompt">$</span> ${highlightCommand(redact(line.text))}</div>`
    if (line.kind === 'comment') return `<div class="line comment">${escapeHtml(line.text)}</div>`
    return `<div class="out">${ansiToHtml(redact(line.text))}</div>`
  }).join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
  html, body { margin: 0; background: transparent; }
  body { padding: 28px; width: 1160px; box-sizing: border-box; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
  .window { background: #0f1115; border-radius: 12px; box-shadow: 0 20px 50px rgba(15,17,21,.35), 0 0 0 1px rgba(255,255,255,.06) inset; overflow: hidden; }
  .bar { height: 40px; background: #1a1d24; display: flex; align-items: center; padding: 0 16px; position: relative; border-bottom: 1px solid #262a33; }
  .dot { width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; }
  .title { position: absolute; left: 0; right: 0; text-align: center; color: #9aa3b2; font-size: 13px; font-family: -apple-system, 'Segoe UI', Inter, sans-serif; pointer-events: none; }
  .content { padding: 18px 22px 22px; color: #d7dce5; font-size: ${fontSize}px; line-height: 1.55; font-variant-ligatures: none; }
  .line { white-space: pre-wrap; word-break: break-word; margin-top: 10px; color: #f3f4f6; }
  .line:first-child { margin-top: 0; }
  .prompt { color: #4ade80; font-weight: 600; }
  .bin { color: #93c5fd; font-weight: 600; }
  .flag { color: #fbbf24; }
  .str { color: #86efac; }
  .comment { color: #7c8596; font-style: italic; }
  .out { white-space: pre; color: #c9d1dc; overflow: hidden; }
  </style></head><body><div class="window"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><div class="title">${escapeHtml(session.title)}</div></div><div class="content">${body}</div></div></body></html>`
}

function transcript(session: Session): string {
  return session.lines.map((line) => line.kind === 'cmd' ? `$ ${redact(line.text)}` : redact(line.text)).join('\n') + '\n'
}

async function screenshot(browser: any, sharp: any, session: Session) {
  const htmlFile = join(WORK, `${session.name}.html`)
  writeFileSync(htmlFile, renderHtml(session))
  for (const scale of [2, 1.5]) {
    const context = await browser.newContext({ viewport: { width: 1160, height: 400 }, deviceScaleFactor: scale })
    const page = await context.newPage()
    await page.goto(`file://${htmlFile}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    const png: Buffer = await page.locator('body').screenshot({ type: 'png', omitBackground: true })
    await context.close()
    for (const quality of [82, 78, 74, 70, 66, 62]) {
      const data: Buffer = await sharp(png).webp({ quality, effort: 6, alphaQuality: 90 }).toBuffer()
      if (data.length <= MAX_BYTES || (scale === 1.5 && quality === 62)) {
        const meta = await sharp(data).metadata()
        writeFileSync(join(SHOTS, `${session.name}.webp`), data)
        console.log(`${session.name.padEnd(22)} ${meta.width}×${meta.height}  ${(data.length / 1024).toFixed(0)} KB  q${quality} @${scale}x`)
        return
      }
    }
  }
}

// ─── Main ───

const SESSIONS: Record<string, () => Promise<Session>> = {
  'cli-login': sessionLogin,
  'cli-edit-workflow': sessionEditWorkflow,
  'cli-crud': sessionCrud,
  'cli-log-destinations': sessionLogDestinations,
  'cli-migrate-instances': sessionMigrateInstances,
  'cli-logs-tail': sessionLogsTail,
  'cli-config-diff': sessionConfigDiff,
}

async function main() {
  const only = process.argv.slice(2)
  setupWork()
  ensureDir(SHOTS)
  ensureDir(TRANSCRIPTS)
  // Every session after the first relies on the saved profile.
  if (only.length && !only.includes('cli-login')) sh(`printf '%s\\n' "$UT_DEMO_KEY" | usertasks login --url ${APP_URL} --api-key - --quiet`)
  const { chromium } = requireTool('playwright-core')
  const sharp = requireTool('sharp')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    for (const [name, run] of Object.entries(SESSIONS)) {
      if (only.length && !only.includes(name)) continue
      const session = await run()
      const text = transcript(session)
      if (text.includes(KEY)) throw new Error(`${name}: API key leaked into the transcript`)
      writeFileSync(join(TRANSCRIPTS, `${name}.txt`), text)
      await screenshot(browser, sharp, session)
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
