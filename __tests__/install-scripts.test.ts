import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { INSTALL_SCRIPTS, readInstallScript } from '@/lib/install-scripts/serve'
import { INSTALL_PS1, INSTALL_SH } from '@/components/marketing/install-page'
import { GET as getInstallSh } from '@/app/install.sh/route'
import { GET as getInstallPs1 } from '@/app/install.ps1/route'

/**
 * The one-line installer (deploy/install/install.sh, install.ps1) and the
 * `usertasks` host wrapper (deploy/install/usertasks, usertasks.ps1). The
 * full flow runs end to end in scripts/install-e2e.sh (Docker); these checks
 * cover the shape of the scripts and the wrapper's pure helpers.
 */

const ROOT = path.resolve(__dirname, '..')
const INSTALL = path.join(ROOT, 'deploy/install')
const read = (name: string) => readFileSync(path.join(INSTALL, name), 'utf8')
// A scratch folder inside the worktree (git-ignored by name), removed afterwards.
const SCRATCH = mkdtempSync(path.join(ROOT, '__tests__', '.install-scripts-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

function sh(script: string, env: Record<string, string> = {}) {
  return spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: SCRATCH, NO_COLOR: '1', ...env } as unknown as NodeJS.ProcessEnv })
}
/** Runs `code` with the wrapper's functions loaded (main is skipped). */
function wrapper(code: string) {
  return sh(`USERTASKS_WRAPPER_NO_MAIN=1; . "${path.join(INSTALL, 'usertasks')}"; ${code}`)
}

describe('one-line installer scripts', () => {
  it('parse as POSIX sh', () => {
    for (const f of ['install.sh', 'usertasks']) {
      const r = spawnSync('sh', ['-n', path.join(INSTALL, f)], { encoding: 'utf8' })
      expect(r.status, `${f}: ${r.stderr}`).toBe(0)
    }
  })

  it('install.sh only runs once fully downloaded: everything in functions, the call on the last line', () => {
    const lines = read('install.sh').trimEnd().split('\n')
    expect(lines.slice(-2)).toEqual(['ut_colors', 'ut_install "$@"'])
    // Top level: comments, function definitions, the key assignment, and the two calls at the end.
    let depth = 0
    let inKey = false
    for (const line of lines.slice(0, -2)) {
      if (inKey) { if (line === "'") inKey = false; continue }
      if (depth === 0) {
        if (line.startsWith("USERTASKS_RELEASE_PUBLIC_KEY='")) { inKey = true; continue }
        expect(line === '' || line.startsWith('#') || /^[a-z0-9_]+\(\) \{/.test(line), `top-level line: ${line}`).toBe(true)
      }
      if (/^[a-z0-9_]+\(\) \{/.test(line) && !line.trimEnd().endsWith('}')) depth++
      else if (line === '}') depth--
    }
    expect(depth).toBe(0)
  })

  it('install.ps1 defines everything in functions and calls the installer last', () => {
    const lines = read('install.ps1').trimEnd().split('\n')
    expect(lines.at(-1)).toBe('Invoke-UserTasksInstall @args')
    // Windows PowerShell 5.1: no ??, no && / || pipeline chains (outside strings).
    for (const f of ['install.ps1', 'usertasks.ps1']) {
      const code = read(f).split('\n').filter((l) => !l.trimStart().startsWith('#')).map((l) => l.replace(/'[^']*'|"[^"]*"/g, "''")).join('\n')
      expect(code, f).not.toMatch(/\?\?|\s&&\s|\s\|\|\s/)
    }
  })

  it('verifies the signature and checksum before unpacking or running anything from a release', () => {
    const body = (text: string, start: string) => text.slice(text.indexOf(start), text.indexOf('\n}', text.indexOf(start)))
    for (const [file, fn, verify, checksum, unpack] of [
      ['install.sh', 'ut_fetch() {', 'ut_verify_sig "$_dl/SHA256SUMS"', 'ut_sha256 "$_dl/$_b"', 'tar -xzf'],
      ['usertasks', 'fetch_release() {', 'verify_sig "$_dl/SHA256SUMS"', 'sha256_of "$_dl/$_bundle"', 'tar -xzf'],
      ['install.ps1', 'function Get-UtRelease', 'Test-UtSignature', 'Get-FileHash', '& tar -xzf'],
      ['usertasks.ps1', 'function Get-Release', 'Test-Signature', 'Get-FileHash', '& tar -xzf'],
    ] as const) {
      const b = body(read(file), fn)
      expect(b.indexOf(verify), file).toBeGreaterThan(0)
      expect(b.indexOf(verify), file).toBeLessThan(b.indexOf(checksum))
      expect(b.indexOf(checksum), file).toBeLessThan(b.indexOf(unpack))
    }
    const main = body(read('install.sh'), 'ut_install() {')
    expect(main.indexOf('ut_fetch "$V"')).toBeGreaterThan(0)
    expect(main.indexOf('ut_fetch "$V"')).toBeLessThan(main.indexOf('sh "$DIR/releases/$V/usertasks"'))
  })

  it('pins the signature-check image by digest', () => {
    for (const f of ['install.sh', 'install.ps1', 'usertasks', 'usertasks.ps1']) {
      const refs = [...read(f).matchAll(/node:22-alpine(@sha256:[0-9a-f]{64})?/g)]
      expect(refs.length, f).toBeGreaterThan(0)
      for (const m of refs) expect(m[1], f).toBeTruthy()
    }
  })

  it('offers the same server commands in the sh and PowerShell wrappers', () => {
    const shCmds = ['status', 'logs', 'backup', 'restore', 'upgrade', 'config', 'uninstall', 'setup-code', 'admin', 'start', 'stop', 'restart', 'version']
    const shText = read('usertasks')
    const psText = read('usertasks.ps1')
    for (const c of shCmds) {
      expect(shText, c).toMatch(new RegExp(`\\b${c}\\)`))
      expect(psText, c).toContain(`'${c}'`)
    }
    expect(shText).toContain('usertasks-host-wrapper')
    expect(psText).toContain('usertasks-host-wrapper')
  })

  it('wrapper: compares versions like the releases are numbered', () => {
    const cases: Array<[string, string, string]> = [
      ['0.1.0', '0.1.0', '0'], ['0.2.0', '0.1.9', '1'], ['0.1.10', '0.1.9', '1'], ['1.0.0', '1.0.0-rc.1', '1'],
      ['1.0.0-rc.1', '1.0.0', '-1'], ['0.9.9', '1.0.0', '-1'],
    ]
    for (const [a, b, want] of cases) expect(wrapper(`version_cmp ${a} ${b}`).stdout.trim(), `${a} vs ${b}`).toBe(want)
    expect(wrapper('valid_version 1.2.3 && echo y; valid_version "1.2.3;x" || echo n').stdout.split('\n').slice(0, 2)).toEqual(['y', 'n'])
  })

  it('wrapper: makes setup codes in the server format', () => {
    const codes = wrapper('for i in 1 2 3 4 5; do gen_setup_code; done').stdout.trim().split('\n')
    expect(codes).toHaveLength(5)
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/)
    expect(new Set(codes).size).toBe(5)
  })

  it('wrapper: edits env files in place without touching other lines or running them', () => {
    const file = path.join(SCRATCH, 'test.env')
    writeFileSync(file, 'A=1\nEMAIL_FROM=UserTasks <noreply@usertasks.local>\nB=$(touch pwned)\n')
    const r = wrapper(`env_set A 2 "${file}"; env_set C 'x y' "${file}"; env_get EMAIL_FROM "${file}"; env_get B "${file}"`)
    expect(r.stdout.split('\n').slice(0, 2)).toEqual(['UserTasks <noreply@usertasks.local>', '$(touch pwned)'])
    expect(readFileSync(file, 'utf8')).toBe('A=2\nEMAIL_FROM=UserTasks <noreply@usertasks.local>\nB=$(touch pwned)\nC=x y\n')
  })

  it('wrapper: prints help, and refuses to run without an install', () => {
    const help = sh(`sh "${path.join(INSTALL, 'usertasks')}" help`)
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('usertasks upgrade [--to <version>]')
    const none = sh(`sh "${path.join(INSTALL, 'usertasks')}" status`, { USERTASKS_DIR: path.join(SCRATCH, 'nothing') })
    expect(none.status).toBe(1)
    expect(none.stderr).toContain('no UserTasks install found')
  })

  it('install.sh fails closed without a release key', () => {
    if (readInstallScript('install.sh').includes('BEGIN PUBLIC KEY-----\n-----END')) {
      const r = sh(`sh "${path.join(INSTALL, 'install.sh')}" --non-interactive --dir "${path.join(SCRATCH, 'inst')}"`)
      // Either Docker is missing here (stops earlier) or the key check stops it: never a download.
      expect(r.status).not.toBe(0)
      expect(r.stdout + r.stderr).not.toContain('Downloading UserTasks')
    }
  })

  it('serves the installers at /install.sh and /install.ps1, byte for byte', async () => {
    for (const [name, get] of [['install.sh', getInstallSh], ['install.ps1', getInstallPs1]] as const) {
      const res = get()
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe(INSTALL_SCRIPTS[name].type)
      expect(await res.text()).toBe(read(name))
    }
  })

  it('documents the commands the routes serve', () => {
    expect(INSTALL_SH).toBe('curl -fsSL https://usertasks.com/install.sh | sh')
    expect(INSTALL_PS1).toBe('irm https://usertasks.com/install.ps1 | iex')
    const guide = readFileSync(path.join(ROOT, 'lib/docs/content/self-hosting-guide.ts'), 'utf8')
    expect(guide).toContain(INSTALL_SH)
    expect(guide).toContain(INSTALL_PS1)
    expect(guide).toContain('## One-line installer')
    expect(guide).toContain('### One-line installer')
  })
})
