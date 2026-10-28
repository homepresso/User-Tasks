import { AsyncLocalStorage } from "node:async_hooks"
import { after } from "next/server"
import { getProcessorSecret } from "@/lib/cron-auth"
import { appUrlOrLocalhost } from "@/lib/config/bootstrap"

/**
 * Set while the queue processor runs jobs in this process. A kick from inside
 * a job (a workflow that enqueues another) just tells that processor to claim
 * again before it stops, instead of sending another HTTP request.
 */
export const queueWorkerContext = new AsyncLocalStorage<{ kicked: boolean }>()

/** Jobs one kick asks the processor to run (it stops earlier when the queue is empty or its time budget is spent). */
const KICK_BATCH_SIZE = 100
/** The processor's own budget is ~50 s (WORKFLOW_PROCESSOR_BUDGET_MS); give up waiting a little after it. */
const KICK_TIMEOUT_MS = 65_000

let inFlight: Promise<void> | null = null
let kickAgain = false

/** Sends one kick request and waits for the processor's response. */
async function sendKick(): Promise<void> {
  const baseUrl = appUrlOrLocalhost()
  // Same resolution as the processor's own check (lib/cron-auth.ts), so a
  // deployment that only sets CRON_SECRET is not answered with a 401.
  const secret = getProcessorSecret()
  const response = await fetch(`${baseUrl}/api/workflows/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "X-Processor-Secret": secret } : {}),
    },
    body: JSON.stringify({ batch_size: KICK_BATCH_SIZE }),
    signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
  })
  await response.text().catch(() => "")
}

/**
 * At most one kick request in flight per server instance. Kicks that arrive
 * while one is running are folded into a single follow-up kick sent when it
 * finishes, so a burst of enqueues becomes one or two processor invocations
 * instead of one each. Resolves when the kick (and any follow-up) is done;
 * never rejects — the pg_cron sweep drains whatever a failed kick missed.
 */
export function coalescedKick(): Promise<void> {
  if (inFlight) {
    kickAgain = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      do {
        kickAgain = false
        await sendKick().catch(() => {
          // Silently ignore — queue will be processed on the next cron tick
        })
      } while (kickAgain)
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/**
 * Kicks the workflow queue processor after jobs were enqueued.
 *
 * Inside a request (route handler, server action) the kick is registered with
 * `after()` so the platform keeps the invocation alive until it is delivered;
 * the request itself does not wait. Inside the queue worker it only flags the
 * running processor to claim again. Elsewhere (scripts, tests) it is sent
 * unawaited.
 */
export function kickQueueProcessor() {
  const worker = queueWorkerContext.getStore()
  if (worker) {
    worker.kicked = true
    return
  }

  const kick = coalescedKick()
  try {
    after(() => kick)
  } catch {
    // Outside a request scope: the promise above already runs on its own.
  }
}

/** Test helper: forget any in-flight kick state. */
export function resetQueueKickState() {
  inFlight = null
  kickAgain = false
}

/**
 * Kicks the agent queue processor after a job is enqueued (MCP agents_execute,
 * v1 async execute). Non-blocking; if this fetch dies the cron sweep still
 * drains the job on its next tick.
 */
export function kickAgentQueueProcessor(batchSize = 3) {
  const baseUrl = appUrlOrLocalhost()
  const secret = getProcessorSecret() ?? ""

  fetch(`${baseUrl}/api/agents/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret ? { "x-processor-secret": secret } : {}),
    },
    body: JSON.stringify({ batch_size: batchSize }),
  }).catch(() => {
    // Silently ignore — cron sweep will pick it up
  })
}
