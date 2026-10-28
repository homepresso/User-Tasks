import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { Io } from '../src/io'
import { run } from '../src/main'

export interface Recorded {
  url: URL
  method: string
  headers: Record<string, string>
  body: unknown
}

export type Responder = (request: Recorded) => { status?: number; body?: unknown; headers?: Record<string, string> }

export function tempConfigPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'usertasks-cli-')), 'usertasks', 'config.json')
}

/** In-process CLI harness: captured stdout/stderr, recorded HTTP calls, temp config. */
export function harness(options: { responder?: Responder; env?: Record<string, string>; stdin?: string; tty?: boolean; confirm?: boolean; configPath?: string; answers?: string[] } = {}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const requests: Recorded[] = []
  const responder: Responder = options.responder ?? (() => ({ body: { success: true, data: {} } }))
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const request: Recorded = {
      url: new URL(String(input)),
      method: init.method ?? 'GET',
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    }
    requests.push(request)
    const reply = responder(request)
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...reply.headers },
    })
  })
  const confirm = vi.fn(async () => options.confirm ?? false)
  const answers = [...(options.answers ?? [])]
  const prompt = vi.fn<(question: string) => Promise<string>>(async () => answers.shift() ?? '')
  const io: Io = {
    env: { ...options.env },
    stdout: { write: (chunk: string) => stdout.push(chunk), isTTY: options.tty ?? false },
    stderr: { write: (chunk: string) => stderr.push(chunk), isTTY: options.tty ?? false },
    stdinIsTTY: options.tty ?? false,
    readStdin: async () => options.stdin ?? '',
    confirm,
    promptSecret: async () => options.stdin ?? '',
    prompt,
    fetch: fetchImpl as unknown as typeof fetch,
    configPath: options.configPath ?? tempConfigPath(),
  }
  return {
    io,
    requests,
    confirm,
    prompt,
    stdout: () => stdout.join(''),
    stderr: () => stderr.join(''),
    run: (...args: string[]) => run(args, io),
  }
}

export const ok = (data: unknown) => ({ body: { success: true, data } })
