import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

/** Everything the CLI touches outside its own code, injectable for tests. */
export interface Io {
  env: NodeJS.ProcessEnv
  stdout: { write(chunk: string): unknown; isTTY?: boolean }
  stderr: { write(chunk: string): unknown; isTTY?: boolean }
  stdinIsTTY: boolean
  /** Read all of stdin (for `-f -` and `--api-key -`). */
  readStdin(): Promise<string>
  /** Ask a yes/no question on the terminal. */
  confirm(question: string): Promise<boolean>
  /** Prompt without echo (API keys). */
  promptSecret(question: string): Promise<string>
  /** Prompt for a line of text (workflow inputs); absent = no interactive prompts. */
  prompt?(question: string): Promise<string>
  fetch?: typeof fetch
  /** Override the config file location (tests). */
  configPath?: string
  /** Open a URL in the user's browser (browser login). */
  openBrowser?(url: string): Promise<void>
  /** Override the 5-minute browser-login timeout (tests). */
  loginTimeoutMs?: number
  /** Stops long-running commands (`logs tail`); defaults to Ctrl-C / SIGTERM. */
  signal?: AbortSignal
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function ask(question: string, muted: boolean): Promise<string> {
  let silenced = false
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!silenced) process.stderr.write(chunk)
      callback()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      if (muted) process.stderr.write('\n')
      resolve(answer)
    })
    silenced = muted
  })
}

/**
 * Launch the platform URL opener directly — never through a shell, so the
 * URL can't be interpreted as shell syntax. Resolves once spawned.
 */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error(`Refusing to open a non-http URL: ${url}`))
  const [command, args] =
    platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : ['xdg-open', [url]]
  return new Promise((resolve, reject) => {
    const child = spawn(command, args as string[], { stdio: 'ignore', detached: true, shell: false })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export function processIo(): Io {
  return {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: () => readAll(process.stdin),
    confirm: async (question) => /^y(es)?$/i.test((await ask(`${question} [y/N] `, false)).trim()),
    promptSecret: (question) => ask(question, true),
    prompt: (question) => ask(question, false),
    openBrowser: (url) => openInBrowser(url),
  }
}
