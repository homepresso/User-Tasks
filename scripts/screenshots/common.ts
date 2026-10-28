/**
 * Shared helpers for the screenshot scripts (seed-demo, capture, terminal).
 * Local stack only: every entry point calls assertLocal() first.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed API payloads */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')
/** State dir (API key, ids). DEMO_OUT_DIR keeps another stack's demo apart (scripts/e2e-instance-migration.ts). */
export const OUT = process.env.DEMO_OUT_DIR ? resolve(process.env.DEMO_OUT_DIR) : join(HERE, '.out')
export const SHOTS = join(ROOT, 'public', 'screenshots')
export const TRANSCRIPTS = join(HERE, 'transcripts')

export const DEMO = {
  org: 'Northwind Trading',
  slug: 'northwind-trading',
  name: 'Ada Lovelace',
  email: 'ada@northwind.example',
  password: 'demo-password-2026',
}

export const APP_URL = (process.env.DEMO_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100').replace(/\/+$/, '')
export const MOCK_URL = (process.env.MOCK_URL ?? 'http://127.0.0.1:4010').replace(/\/+$/, '')
export const FAKE_TOKEN = '00000000-0000-0000-0000-000000000000'

function isLocalUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const host = new URL(value).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/** Refuse to run against anything but a local Supabase stack and a local app. */
export function assertLocal(): void {
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!isLocalUrl(sb)) {
    console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL (${sb ?? 'unset'}) is not a localhost/127.0.0.1 URL. These scripts write demo data and must never point at a real project.`)
    process.exit(2)
  }
  if (!isLocalUrl(APP_URL)) {
    console.error(`Refusing to run: app URL ${APP_URL} is not local.`)
    process.exit(2)
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY must be set (local stack service-role key).')
    process.exit(2)
  }
}

/** Resolve a package from the screenshot tools dir (SCREENSHOT_TOOLS_DIR) or the repo. */
export function requireTool<T = any>(name: string): T {
  const dirs = [process.env.SCREENSHOT_TOOLS_DIR, ROOT].filter(Boolean) as string[]
  for (const dir of dirs) {
    try {
      return createRequire(join(dir, 'package.json'))(name)
    } catch { /* try next */ }
  }
  throw new Error(`Cannot find "${name}". Install it in a tools dir (npm i ${name}) and set SCREENSHOT_TOOLS_DIR to that dir.`)
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

export function readState(): Record<string, any> {
  const file = join(OUT, 'demo-state.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

export function writeState(state: Record<string, any>): void {
  ensureDir(OUT)
  writeFileSync(join(OUT, 'demo-state.json'), JSON.stringify(state, null, 2) + '\n')
}

export function readApiKey(): string {
  const file = join(OUT, 'api-key.txt')
  if (!existsSync(file)) throw new Error('No demo API key yet: run scripts/screenshots/seed-demo.ts first.')
  return readFileSync(file, 'utf8').trim()
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: any) {
    super(message)
  }
}

export function makeApi(key: string) {
  return async function api(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${APP_URL}/api/v1${path}`
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    }
    const text = await res.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* non-JSON */ }
    if (!res.ok || json?.success === false) {
      throw new ApiError(`${method} ${path} → ${res.status} ${JSON.stringify(json?.error ?? json?.details ?? text).slice(0, 400)}`, res.status, json)
    }
    return json && typeof json === 'object' && 'data' in json ? json.data : json
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
