/**
 * The host a processing provider's processor loop runs on
 * (`node worker.cjs --processor`, scripts/worker.ts): core's queue
 * primitives — leased claims with expired-lease recovery, a job runner that
 * keeps leases renewed and handles interrupted runs (checkpoints), agent and
 * media batches, queue health, the minute tick, and the LISTEN connection
 * settings. The provider (an extension) owns the loop: concurrency, wake-ups,
 * backpressure, drain, heartbeats and metrics.
 *
 * Server-only; worker processes only.
 */
import os from "node:os"
import packageJson from "@/package.json"
import type { ProcessorHost, ProcessorJob, QueueHealth } from "@/lib/extensions/sdk"
import { getServiceDb } from "@/lib/providers/db"
import { pgConnectionConfig } from "@/lib/providers/db/pg-auth"
import { listenUrl as gatewayListenUrl } from "@/lib/gateway/notify"
import { createWorkflowJobRunner, workflowConcurrency, type Job } from "@/lib/workflow-queue-processor"
import { processAgentQueueBatch } from "@/lib/jobs/agent-queue"
import { processMediaJobBatch } from "@/lib/media/jobs"
import { markProcessorProcess } from "./handoff"

/* eslint-disable @typescript-eslint/no-explicit-any -- RPC rows */

/** LISTEN connection: PROCESSING_LISTEN_DATABASE_URL ('' / off disables), else the gateway's resolution. */
export function processingListenUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.PROCESSING_LISTEN_DATABASE_URL
  if (explicit !== undefined) return /^(|off|false|0)$/i.test(explicit.trim()) ? null : explicit.trim()
  return gatewayListenUrl(env)
}

export function newWorkerId(hostname = os.hostname()): string {
  return `${hostname.slice(0, 60)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
}

export interface ProcessorHostHandle extends ProcessorHost {
  close(): Promise<void>
}

export async function createProcessorHost(options: { workerId?: string } = {}): Promise<ProcessorHostHandle> {
  markProcessorProcess(true)
  const workerId = options.workerId ?? newWorkerId()
  const db = getServiceDb() as any
  const runner = createWorkflowJobRunner(workerId)
  let scheduler: { start(): void; stop(): Promise<void> } | null = null

  const toJob = (row: Job & Record<string, any>): ProcessorJob => ({
    id: row.id,
    workflow_id: row.workflow_id,
    tenant_id: row.tenant_id,
    trigger_type: row.trigger_type ?? null,
    priority: Number(row.priority) || 0,
    attempts: Number(row.attempts) || 0,
    lease_lost_count: Number(row.lease_lost_count) || 0,
  })
  const claimed = new Map<string, Job>()

  return {
    version: packageJson.version,
    workerId,
    hostname: os.hostname(),
    concurrency: workflowConcurrency(),
    leaseSeconds: runner.leaseSeconds,
    workflows: {
      async claim(limit) {
        const jobs = await runner.claim(limit)
        for (const job of jobs) claimed.set(job.id, job)
        return jobs.map((job) => toJob(job as Job & Record<string, any>))
      },
      async run(job) {
        const full = claimed.get(job.id)
        claimed.delete(job.id)
        if (!full) return { status: "failed", error: "Not claimed by this process" }
        try {
          const result = await runner.run(full)
          const status = result.status === "lease_lost" ? "lease_lost" : result.status === "failed" ? "failed" : "completed"
          return {
            status,
            ...(typeof result.run_status === "string" ? { run_status: result.run_status } : {}),
            ...(typeof result.error === "string" ? { error: result.error } : {}),
          }
        } catch (error) {
          return { status: "failed", error: error instanceof Error ? error.message : String(error) }
        }
      },
      async release(jobIds) {
        for (const id of jobIds) claimed.delete(id)
        return runner.release(jobIds)
      },
      running: () => runner.running(),
    },
    agents: {
      async processBatch(input) {
        const result = await processAgentQueueBatch({ batchSize: input.batchSize, deadline: input.deadline })
        return { processed: result.processed }
      },
    },
    media: {
      async processBatch(input) {
        const result = await processMediaJobBatch({ batchSize: input.batchSize, deadline: input.deadline })
        return { processed: result.processed }
      },
    },
    async queueHealth(): Promise<QueueHealth | null> {
      const { data, error } = await db.rpc("get_queue_health", { p_tenant_id: null })
      return error || !data ? null : (data as QueueHealth)
    },
    scheduler: {
      start() {
        void (async () => {
          const [{ getProviderConfig }, { createSchedulerWorker }] = await Promise.all([
            import("@/lib/config"),
            import("@/lib/scheduler/runtime"),
          ])
          const config = await getProviderConfig("scheduler")
          scheduler = createSchedulerWorker(config.options)
          scheduler.start()
        })().catch((error) => console.warn(`[processor] scheduler did not start: ${error instanceof Error ? error.message : String(error)}`))
      },
      async stop() {
        await scheduler?.stop()
        scheduler = null
      },
    },
    listenUrl: () => processingListenUrl(),
    pgConfig: (url, extra) => pgConnectionConfig(url, extra ?? {}) as Record<string, unknown>,
    db,
    async close() {
      runner.stop()
      if (claimed.size) await runner.release([...claimed.keys()]).catch(() => 0)
      claimed.clear()
      await scheduler?.stop()
    },
  }
}
