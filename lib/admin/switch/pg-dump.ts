import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { ensurePrivateDir } from './log'

/*
 * The pg_dump backup of a switch (./backup re-exports it as pgDump). Its own
 * module, imported on use: the app's file tracer would otherwise treat the
 * child process as a reason to trace the whole project.
 */

/** pg_dump -Fc into `file`. Resolves with an error message instead of throwing. */
export function runPgDump(url: string, file: string, options: { schemas?: string[]; binary: string; timeoutMs?: number }): Promise<{ ok: boolean; error?: string }> {
  ensurePrivateDir(path.dirname(/*turbopackIgnore: true*/ file))
  // The password goes through PGPASSWORD, not the command line (ps shows argv).
  let dbname = url
  const env: NodeJS.ProcessEnv = { ...process.env }
  try {
    const parsed = new URL(url)
    if (parsed.password) {
      env.PGPASSWORD = decodeURIComponent(parsed.password)
      parsed.password = ''
      dbname = parsed.toString()
    }
  } catch { /* key=value connection strings are passed as given */ }
  const args = ['--format=custom', '--no-owner', '--file', file, ...(options.schemas ?? []).flatMap((s) => ['--schema', s]), '--dbname', dbname]
  return new Promise((resolve) => {
    let stderr = ''
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(options.binary, args, { stdio: ['ignore', 'ignore', 'pipe'], env })
    } catch (error) {
      resolve({ ok: false, error: (error as Error).message })
      return
    }
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs ?? 30 * 60_000)
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, error: error.message }) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0 && existsSync(/*turbopackIgnore: true*/ file) && statSync(/*turbopackIgnore: true*/ file).size > 0) resolve({ ok: true })
      else resolve({ ok: false, error: stderr.trim().split('\n').slice(-2).join(' ') || `pg_dump exited with ${code}` })
    })
  })
}
