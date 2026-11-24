/**
 * Processing hand-off: where queued work and runs started by a request are
 * executed.
 *
 *   web    (default, and the only mode without a processing provider) — the
 *          web app runs work itself: kicks POST to its own
 *          /api/workflows/process and /api/agents/process, synchronous starts,
 *          test runs, middleware webhooks and resumes run inside the request,
 *          media jobs start with after(). Today's behaviour, unchanged.
 *   queue  a processing provider (an extension's `processing` hook, e.g. the
 *          separate-workers add-on) runs the work elsewhere: every hand-off
 *          path enqueues and returns (lib/processing/dispatch.ts), kicks only
 *          wake the provider's workers (notify), and callers that need a
 *          result wait for the queued job, bounded.
 *
 * The mode comes from the first compatible extension whose server module has
 * a `processing` provider and whose licence (instance-wide, the provider's
 * `feature`) allows it. Its answer is cached per process for a few seconds;
 * any error answers `web`, so a broken provider never stalls work.
 *
 * Inside a processor process (`node worker.cjs --processor`, see
 * markProcessorProcess) work that was handed off runs locally: the process IS
 * the worker.
 *
 * Server-only. Imports nothing from the extension runtime: the provider
 * resolver is registered at startup (lib/processing/provider-registry).
 */
import type { ExtensionContext, ProcessingProvider, ProcessingWorkKind } from '@/lib/extensions/sdk'
import { hasExtensions } from '@/lib/extensions/registry'

export type HandoffMode = 'web' | 'queue'

export interface ResolvedProcessingProvider {
  extensionId: string
  provider: ProcessingProvider
  ctx: ExtensionContext
}

const CACHE_MS = 5_000

type State = {
  processor: boolean
  cached: { at: number; mode: HandoffMode; testRuns: boolean } | null
  inflight: Promise<{ mode: HandoffMode; testRuns: boolean }> | null
  override: ((() => Promise<ResolvedProcessingProvider | null>) | null)
  resolver?: (() => Promise<ResolvedProcessingProvider | null>) | null
}
const SLOT = Symbol.for('usertasks.processing.handoff')
const state: State = ((globalThis as unknown as Record<symbol, State>)[SLOT] ??= { processor: false, cached: null, inflight: null, override: null })

/** This process is a processor (worker): handed-off work runs here. */
export function markProcessorProcess(on = true): void {
  state.processor = on
}

export function isProcessorProcess(): boolean {
  return state.processor
}

/**
 * How the provider is found: registered at server start
 * (registerProcessingProviderResolver in lib/processing/provider-registry,
 * called by instrumentation.ts and scripts/worker.ts). This module stays free
 * of the extension / services graph on purpose: it is imported by the queue
 * kick, which every server function reaches (__tests__/function-trace-guards).
 */
export function setProcessingProviderResolver(resolver: (() => Promise<ResolvedProcessingProvider | null>) | null): void {
  state.resolver = resolver
  state.cached = null
}

/**
 * The licensed processing provider of this build, or null (no extension
 * provides one, it is not licensed, the build has no extensions, or no
 * resolver was registered).
 */
export async function resolveProcessingProvider(): Promise<ResolvedProcessingProvider | null> {
  if (state.override) return state.override()
  if (!hasExtensions() || !state.resolver) return null
  return state.resolver()
}

async function decide(): Promise<{ mode: HandoffMode; testRuns: boolean }> {
  try {
    const resolved = await resolveProcessingProvider()
    if (!resolved) return { mode: 'web', testRuns: false }
    const mode = (await resolved.provider.handoff({ ctx: resolved.ctx })) === 'queue' ? 'queue' : 'web'
    const testRuns = mode === 'queue' && resolved.provider.testRunsOnWorkers
      ? (await resolved.provider.testRunsOnWorkers({ ctx: resolved.ctx })) === true
      : false
    return { mode, testRuns }
  } catch (error) {
    console.warn(`[processing] provider failed; processing in the web app: ${error instanceof Error ? error.message : String(error)}`)
    return { mode: 'web', testRuns: false }
  }
}

async function current(): Promise<{ mode: HandoffMode; testRuns: boolean }> {
  const hit = state.cached
  if (hit && Date.now() - hit.at < CACHE_MS) return hit
  state.inflight ??= decide().then((answer) => {
    state.cached = { at: Date.now(), ...answer }
    return answer
  }).finally(() => { state.inflight = null })
  return state.inflight
}

/** `web` (run here) or `queue` (enqueue only; a processing provider's workers run it). */
export async function processingHandoff(): Promise<HandoffMode> {
  return (await current()).mode
}

/** In `queue` mode: should designer test runs go through the queue too (provider option)? */
export async function testRunsOnWorkers(): Promise<boolean> {
  const answer = await current()
  return answer.mode === 'queue' && answer.testRuns
}

/** Wake the provider's workers after work of `kind` was enqueued. Best effort, never throws. */
export async function notifyProcessing(kind: ProcessingWorkKind): Promise<void> {
  try {
    const resolved = await resolveProcessingProvider()
    await resolved?.provider.notify?.({ ctx: resolved.ctx, kind })
  } catch {
    // Workers also poll; a lost wake-up only delays the pick-up.
  }
}

/** Forget the cached mode (the provider's setting changed). */
export function invalidateProcessingHandoff(): void {
  state.cached = null
}

/** Test hook: a fixed provider (null = no provider), or undefined to restore the registry lookup. */
export function __setProcessingProviderForTests(resolved: ResolvedProcessingProvider | null | undefined): void {
  state.override = resolved === undefined ? null : async () => resolved
  state.cached = null
  state.inflight = null
}
