/**
 * usertasks-gateway — the UserTasks on-premises gateway.
 *
 *   usertasks-gateway register --token utgwr_… [--config gateway.json]
 *   usertasks-gateway run [--config gateway.json]
 *   usertasks-gateway register-and-run --token utgwr_…     (Docker: registers once, then runs)
 *   usertasks-gateway check [--config gateway.json]        (configuration + registration)
 *   usertasks-gateway rotate-key                           (new instance key, signed with the old)
 *   usertasks-gateway status | version
 *
 * Outbound only: one keep-alive HTTPS connection pool to the UserTasks
 * address. Logs are JSON lines on stdout (never secrets, never bodies).
 */
import os from 'node:os'
import { generateEd25519, compareVersions, GATEWAY_PROTOCOL_VERSION, MAX_POLL_WAIT_MS, type GatewayJob, type GatewayJobResult, type GatewayStatusReport, type PollResponse } from '../../../lib/gateway/protocol'
import pkg from '../package.json'
import { ConfigError, defaultConfigFile, loadConfig, type GatewayConfig } from './config'
import { CloudClient, CloudError } from './cloud'
import { readState, writeState, type GatewayState } from './state'
import { executeJob, JobRefused } from './executor'
import { setGatewayEgressAllowlist } from './egress-shim'
import { startRelay } from './relay'

export const VERSION: string = pkg.version

type Level = 'debug' | 'info' | 'warn' | 'error'
export function log(level: Level, message: string, detail: Record<string, unknown> = {}): void {
  if (level === 'debug' && process.env.UTGW_DEBUG !== '1') return
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg: message, ...detail })}\n`)
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i >= 0) return args[i + 1]
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : undefined
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

function allowlistFor(config: GatewayConfig): string[] {
  const hosts = new Set<string>()
  for (const t of config.targets) {
    hosts.add(new URL(t.origin).hostname)
    if (t.proxy) hosts.add(new URL(t.proxy).hostname)
  }
  return [...hosts]
}

/* ── register ──────────────────────────────────────────────────────── */

export async function register(config: GatewayConfig, token: string): Promise<GatewayState> {
  const keys = generateEd25519()
  const client = new CloudClient(config.cloudUrl, { ca: config.cloudCa, proxy: config.cloudProxy }, () => null)
  try {
    const reply = await client.register({ token, publicKey: keys.publicKey, instanceName: config.instanceName, hostname: os.hostname(), platform: `${process.platform}-${process.arch} node${process.versions.node}`, version: VERSION })
    const body = reply.body as { protocol: number; gatewayId: string; gatewayName: string; keyId: string; cloudKeys: Array<{ id: string; publicKey: string }> }
    if (body.protocol !== GATEWAY_PROTOCOL_VERSION) throw new Error(`The cloud speaks gateway protocol ${body.protocol}; this gateway speaks ${GATEWAY_PROTOCOL_VERSION}. Upgrade the gateway.`)
    const now = new Date().toISOString()
    const state: GatewayState = {
      version: 1, cloudUrl: config.cloudUrl, gatewayId: body.gatewayId, gatewayName: body.gatewayName ?? null, keyId: body.keyId,
      privateKeyPem: keys.privateKeyPem, publicKey: keys.publicKey, cloudKeys: body.cloudKeys, registeredAt: now, keyCreatedAt: now,
    }
    writeState(config.stateDir, state)
    log('info', 'registered', { gateway: body.gatewayName, gatewayId: body.gatewayId, keyId: body.keyId })
    return state
  } finally {
    client.close()
  }
}

/* ── run ───────────────────────────────────────────────────────────── */

export class GatewayRunner {
  private state: GatewayState
  private readonly client: CloudClient
  private inflight = 0
  private stopped = false
  private readonly abort = new AbortController()
  private lastPollOk = 0
  private events: NonNullable<GatewayStatusReport['events']> = []
  private warnedVersion = ''
  private slotWaiters: Array<() => void> = []
  private readonly running = new Set<string>()
  private currentPoll: Promise<unknown> | null = null

  constructor(private readonly config: GatewayConfig, state: GatewayState) {
    if (state.cloudUrl !== config.cloudUrl) throw new ConfigError(`This instance is registered with ${state.cloudUrl}, not ${config.cloudUrl}: register again`)
    this.state = state
    this.client = new CloudClient(config.cloudUrl, { ca: config.cloudCa, proxy: config.cloudProxy }, () => this.state)
    setGatewayEgressAllowlist(allowlistFor(config))
  }

  healthy(): boolean { return !this.stopped && Date.now() - this.lastPollOk < 60_000 }

  securityEvent(type: string, message: string, detail?: Record<string, unknown>): void {
    log('warn', message, { event: type, ...(detail ?? {}) })
    if (this.events.length < 50) this.events.push({ type, message, at: Date.now(), detail })
  }

  private status(): GatewayStatusReport {
    const events = this.events.splice(0, 50)
    return {
      version: VERSION, protocol: GATEWAY_PROTOCOL_VERSION, platform: `${process.platform}-${process.arch}`, hostname: os.hostname(), instanceName: this.config.instanceName,
      targets: this.config.targets.map((t) => ({ id: t.id, origin: t.origin })),
      relayUrl: this.config.relay?.publicUrl ?? null, inflight: this.inflight, capacity: this.config.maxConcurrent, events,
    }
  }

  async start(): Promise<void> {
    log('info', 'gateway starting', { version: VERSION, gateway: this.state.gatewayName, keyId: this.state.keyId, targets: this.config.targets.map((t) => `${t.id}=${t.origin}`), maxConcurrent: this.config.maxConcurrent })
    let relay: ReturnType<typeof startRelay> | null = null
    if (this.config.relay) {
      relay = startRelay(this.config.relay, {
        forward: (input) => this.relay(input),
        healthy: () => this.healthy(),
        log: (level, message, detail) => log(level, message, detail),
        securityEvent: (type, message, detail) => this.securityEvent(type, message, detail),
      })
      log('info', 'relay listening', { listen: `${this.config.relay.host}:${this.config.relay.port}`, publicUrl: this.config.relay.publicUrl, tls: Boolean(this.config.relay.tls) })
    }
    const shutdown = async (sig: string) => {
      if (this.stopped) return
      log('info', 'stopping', { signal: sig, inflight: this.inflight })
      this.stopped = true
      relay?.close()
      // Let the poll in flight finish (≤ 25 s) rather than cut it: the cloud may already have
      // claimed jobs for it. Its jobs run, then everything still held goes back to the queue.
      const deadline = Date.now() + 60_000
      await Promise.race([this.currentPoll ?? Promise.resolve(), sleep(30_000)])
      while (this.inflight > 0 && Date.now() < deadline) await sleep(200)
      await this.client.call('POST', 'release', { running: [...this.running] }, { timeoutMs: 5_000 })
        .then((r) => log('info', 'released unstarted jobs', { released: (r.body as { released?: number }).released ?? 0 }))
        .catch((error) => log('warn', 'could not release jobs', { error: (error as Error).message }))
      this.abort.abort()
      this.client.close()
      process.exit(0)
    }
    process.on('SIGTERM', () => void shutdown('SIGTERM'))
    process.on('SIGINT', () => void shutdown('SIGINT'))
    this.startHeartbeat()
    await this.loop()
  }

  private async maybeRotate(): Promise<void> {
    const days = this.config.keyRotationDays
    if (!days || Date.now() - Date.parse(this.state.keyCreatedAt) < days * 86_400_000) return
    await this.rotateKey()
  }

  async rotateKey(): Promise<void> {
    const keys = generateEd25519()
    const reply = await this.client.call<{ keyId: string }>('POST', 'rotate', { publicKey: keys.publicKey })
    this.state = { ...this.state, keyId: reply.body.keyId, privateKeyPem: keys.privateKeyPem, publicKey: keys.publicKey, keyCreatedAt: new Date().toISOString() }
    writeState(this.config.stateDir, this.state)
    log('info', 'instance key rotated', { keyId: this.state.keyId })
  }

  private waitForSlot(): Promise<void> {
    if (this.inflight < this.config.maxConcurrent) return Promise.resolve()
    return new Promise((resolve) => this.slotWaiters.push(resolve))
  }

  /**
   * Every 5 s while jobs run: a poll that claims nothing. It renews the
   * leases of this instance's jobs (and keeps it online when all slots are
   * busy), so a long request is never handed to another instance while it
   * is still in progress — and an instance that dies loses its leases.
   */
  private startHeartbeat(): void {
    const timer = setInterval(() => {
      if (this.stopped || this.inflight === 0) return
      void this.client.call<PollResponse>('POST', 'poll', { waitMs: 0, max: 0, status: this.status() }, { timeoutMs: 4_500 })
        .then((r) => { this.lastPollOk = Date.now(); this.absorb(r.body) })
        .catch((error) => log('warn', 'heartbeat failed', { error: (error as Error).message }))
    }, 5_000)
    timer.unref()
  }

  private async loop(): Promise<void> {
    let backoff = 1000
    while (!this.stopped) {
      await this.waitForSlot()
      try {
        await this.maybeRotate()
        this.currentPoll = this.client.call<PollResponse>('POST', 'poll', { waitMs: MAX_POLL_WAIT_MS, max: this.config.maxConcurrent - this.inflight, status: this.status() }, { timeoutMs: MAX_POLL_WAIT_MS + 20_000, signal: this.abort.signal })
        const reply = (await this.currentPoll) as { body: PollResponse }
        this.currentPoll = null
        this.lastPollOk = Date.now()
        backoff = 1000
        this.absorb(reply.body)
        for (const job of reply.body.jobs ?? []) void this.run(job)
      } catch (error) {
        this.currentPoll = null
        if (this.stopped) break
        const e = error as CloudError
        if (e instanceof CloudError && (e.code === 'gateway_revoked' || e.status === 403)) {
          log('error', 'this gateway instance was revoked or rotated away; not polling. Register a new instance.', { code: e.code })
          await sleep(300_000, this.abort.signal)
          continue
        }
        log('warn', 'poll failed', { error: e.message, code: (e as CloudError).code, retryInMs: backoff })
        await sleep(backoff + Math.floor(Math.random() * 500), this.abort.signal)
        backoff = Math.min(30_000, backoff * 2)
      }
    }
  }

  private absorb(reply: PollResponse): void {
    // New cloud keys arrive only inside an answer signed by a key already trusted (CloudClient verified it).
    const known = new Set(this.state.cloudKeys.map((k) => k.id))
    const added = (reply.cloudKeys ?? []).filter((k) => k && typeof k.id === 'string' && typeof k.publicKey === 'string' && !known.has(k.id))
    if (added.length) {
      this.state = { ...this.state, cloudKeys: [...this.state.cloudKeys, ...added].slice(-4) }
      writeState(this.config.stateDir, this.state)
      log('info', 'trusting an additional cloud key', { ids: added.map((k) => k.id) })
    }
    if (reply.minVersion && compareVersions(VERSION, reply.minVersion) < 0 && this.warnedVersion !== reply.minVersion) {
      this.warnedVersion = reply.minVersion
      log('error', `this gateway (${VERSION}) is older than the minimum ${reply.minVersion}: it gets no work until upgraded`)
    } else if (reply.latestVersion && compareVersions(VERSION, reply.latestVersion) < 0 && this.warnedVersion !== reply.latestVersion) {
      this.warnedVersion = reply.latestVersion
      log('warn', `a newer gateway is available (${reply.latestVersion}; this is ${VERSION})`)
    }
  }

  private release(): void {
    this.inflight--
    const waiters = this.slotWaiters.splice(0)
    for (const w of waiters) w()
  }

  private async run(job: GatewayJob): Promise<void> {
    this.inflight++
    this.running.add(job.id)
    let result: GatewayJobResult
    let target = job.target
    const started = Date.now()
    try {
      const out = await executeJob(this.config, job, {
        requestPart: async (jobId, n) => Buffer.from(String((await this.client.call<{ data: string }>('GET', `jobs/${jobId}/request-parts/${n}`, null)).body.data), 'base64'),
        responsePart: async (jobId, n, data) => { await this.client.call('PUT', `jobs/${jobId}/parts/${n}`, data, { timeoutMs: 120_000 }) },
      })
      result = out.result
      target = out.target
    } catch (error) {
      const refused = error instanceof JobRefused
      if (refused && ['target_not_allowed', 'path_not_allowed', 'method_not_allowed'].includes((error as JobRefused).code)) {
        this.securityEvent('allowlist_refused', `Refused a request: ${(error as Error).message}`, { job: job.id, target: job.target, method: job.method })
      }
      const name = (error as Error).name
      result = {
        status: 0, headers: {}, body: null, durationMs: Date.now() - started,
        error: refused ? { code: (error as JobRefused).code, message: (error as Error).message }
          : { code: name === 'TimeoutError' || name === 'AbortError' ? 'gateway_target_timeout' : 'gateway_target_unreachable', message: `${(error as Error).message}`.slice(0, 500) },
      }
    }
    try {
      await this.postResult(job.id, result)
      log('info', 'job', { job: job.id, target, method: job.method, status: result.status || undefined, error: result.error?.code, ms: result.durationMs, attempt: job.attempt })
    } finally {
      this.running.delete(job.id)
      this.release()
    }
  }

  private async postResult(jobId: string, result: GatewayJobResult): Promise<void> {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await this.client.call('POST', `jobs/${jobId}/result`, result, { timeoutMs: 30_000 })
        return
      } catch (error) {
        const e = error as CloudError
        if (e.status === 404 || e.status === 400 || e.status === 403 || attempt === 4) { log('warn', 'could not deliver a result', { job: jobId, error: e.message }); return }
        await sleep(300 * attempt)
      }
    }
  }

  private async relay(input: { method: string; path: string; headers: Record<string, string>; body: Buffer }) {
    const reply = await this.client.call<{ status: number; headers: Record<string, string>; body: string }>('POST', 'relay', { method: input.method, path: input.path, headers: input.headers, body: input.body.toString('base64') }, { timeoutMs: 30_000 })
    return { status: reply.body.status, headers: reply.body.headers ?? {}, body: Buffer.from(reply.body.body ?? '', 'base64') }
  }
}

/* ── CLI ───────────────────────────────────────────────────────────── */

async function main(argv: string[]): Promise<number> {
  const [command = 'help', ...args] = argv
  if (command === 'version' || command === '--version') { console.log(VERSION); return 0 }
  if (command === 'help' || command === '--help') {
    console.log('usertasks-gateway <register|run|register-and-run|check|rotate-key|status|version> [--config gateway.json] [--token utgwr_…]')
    return 0
  }
  const file = arg(args, 'config') ?? defaultConfigFile()
  const config = loadConfig(file)
  if (arg(args, 'cloud-url') && arg(args, 'cloud-url') !== config.cloudUrl) throw new ConfigError(`--cloud-url ${arg(args, 'cloud-url')} differs from cloudUrl in ${file}`)
  const token = arg(args, 'token') ?? process.env.UTGW_REGISTRATION_TOKEN

  switch (command) {
    case 'check': {
      log('info', 'configuration ok', { file, cloudUrl: config.cloudUrl, targets: config.targets.map((t) => `${t.id}=${t.origin} (${t.auth.type})`), relay: config.relay?.publicUrl ?? null })
      const state = readState(config.stateDir)
      log('info', state ? 'registered' : 'not registered', state ? { gatewayId: state.gatewayId, keyId: state.keyId } : {})
      return 0
    }
    case 'status': {
      const state = readState(config.stateDir)
      console.log(JSON.stringify(state ? { registered: true, cloudUrl: state.cloudUrl, gatewayId: state.gatewayId, gateway: state.gatewayName, keyId: state.keyId, registeredAt: state.registeredAt, keyCreatedAt: state.keyCreatedAt, version: VERSION } : { registered: false, version: VERSION }, null, 2))
      return 0
    }
    case 'register': {
      if (!token) throw new ConfigError('--token is required')
      await register(config, token)
      return 0
    }
    case 'rotate-key': {
      const state = readState(config.stateDir)
      if (!state) throw new ConfigError('Not registered')
      await new GatewayRunner(config, state).rotateKey()
      return 0
    }
    case 'register-and-run':
    case 'run': {
      let state = readState(config.stateDir)
      if (!state && command === 'register-and-run') {
        if (!token) throw new ConfigError('Not registered yet: pass --token (or UTGW_REGISTRATION_TOKEN)')
        state = await register(config, token)
      }
      if (!state) throw new ConfigError(`Not registered: run "usertasks-gateway register --token …" first (state: ${config.stateDir})`)
      await new GatewayRunner(config, state).start()
      return 0
    }
    default:
      throw new ConfigError(`Unknown command "${command}"`)
  }
}

const isEntry = process.argv[1] && /usertasks-gateway(\.mjs)?$|main\.ts$/.test(process.argv[1])
if (isEntry) {
  main(process.argv.slice(2)).then((code) => { if (code) process.exit(code) }).catch((error) => {
    log('error', (error as Error).message, { kind: (error as Error).name })
    process.exit(error instanceof ConfigError ? 2 : 1)
  })
}
