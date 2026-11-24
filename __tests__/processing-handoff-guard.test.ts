/**
 * Source guard for the processing hand-off (lib/processing/handoff.ts): with
 * separate processing workers (queue mode) the web app must never run work
 * inline. Every call that executes runs or drains a queue —
 * executeWorkflow, resumeWorkflow, resumeTimedPause, recoverRunFromCheckpoint,
 * processWorkflowQueueBatch, processAgentQueueBatch, processMediaJobBatch —
 * lives either in a file listed here with the reason it is safe, or in a
 * file that checks the hand-off (handsOff / processingHandoff). A new caller
 * fails this test: route it through lib/processing/dispatch (startRun /
 * resumeRun) or gate it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')
const CALLS = /\b(executeWorkflow|resumeWorkflow|resumeTimedPause|recoverRunFromCheckpoint|processWorkflowQueueBatch|processAgentQueueBatch|processMediaJobBatch)\s*\(/g

/** Files allowed to execute directly, and why. */
const ALLOWED: Record<string, string> = {
  'lib/workflow-engine.ts': 'the engine itself (sub-workflows and error-trigger runs belong to the run being executed, wherever it runs)',
  'lib/workflow-queue-processor.ts': 'the queue processor (runs where the queue is drained: worker, or the web app in web mode)',
  'lib/processing/dispatch.ts': 'the hand-off: executes only when handsOff() says web / processor',
  'lib/processing/processor-host.ts': 'the processor host (worker process only)',
  'lib/workflow-resume-queue.ts': 'worker side of queued task resumes (called by the processor)',
  'lib/jobs/agent-queue.ts': 'the agent queue processor (defines processAgentQueueBatch)',
  'lib/gallery/verify-core.ts': 'the gallery verification CLI (a script, never a request)',
  'app/api/workflows/process/route.ts': 'explicit processor endpoint (manual / external triggers; the web app no longer kicks it in queue mode)',
  'app/api/agents/process/route.ts': 'explicit processor endpoint',
  'app/api/cron/process-workflows/route.ts': 'explicit processor endpoint (legacy cron route)',
  'app/api/cron/process-agents/route.ts': 'explicit processor endpoint (legacy cron route)',
  'app/api/cron/process-media/route.ts': 'explicit processor endpoint (legacy cron route)',
}

/** Files that execute only behind a hand-off check. */
const GATED = /\b(handsOff|processingHandoff|processingHere)\s*\(/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'generated' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`])\/\/.*$/gm, '$1')
}

describe('processing hand-off source guard', () => {
  const files = ['lib', 'app', 'components'].flatMap((d) => walk(path.join(ROOT, d)))
  const callers = files
    .map((file) => ({ rel: path.relative(ROOT, file).split(path.sep).join('/'), source: stripComments(readFileSync(file, 'utf8')) }))
    .filter(({ source }) => {
      CALLS.lastIndex = 0
      return [...source.matchAll(CALLS)].some((m) => !/function\s+$/.test(source.slice(Math.max(0, m.index! - 20), m.index)))
    })

  it('finds the known executors (the scan works)', () => {
    const rels = callers.map((c) => c.rel)
    expect(rels).toContain('lib/workflow-queue-processor.ts')
    expect(rels).toContain('lib/processing/dispatch.ts')
  })

  it('every direct executor is allow-listed or gated by the hand-off', () => {
    const offenders = callers.filter(({ rel, source }) => !ALLOWED[rel] && !GATED.test(source)).map((c) => c.rel)
    expect(offenders, `run inline outside the processing hand-off — use lib/processing/dispatch: ${offenders.join(', ')}`).toEqual([])
  })

  it('request paths that used to run inline now go through the dispatch', () => {
    for (const rel of [
      'lib/services/workflow-start.ts',
      'lib/services/workflow-runs.ts',
      'app/api/v1/workflows/events/[id]/complete/route.ts',
      'app/api/workflows/execute-stream/route.ts',
      'app/api/workflows/execute/route.ts',
      'app/api/webhooks/inbound/route.ts',
      'lib/agents/tools/actions.ts',
      'lib/licensing/paused-runs.ts',
      'lib/jobs/retention.ts',
      'lib/workflow-sla.ts',
    ]) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8')
      expect(source, rel).toMatch(/@\/lib\/processing\/dispatch/)
      expect(stripComments(source), rel).not.toMatch(/\b(executeWorkflow|resumeWorkflow)\s*\(/)
    }
  })

  it('kicks and media starts consult the hand-off', () => {
    expect(readFileSync(path.join(ROOT, 'lib/process-queue.ts'), 'utf8')).toMatch(/processingHandoff\(\)/)
    expect(readFileSync(path.join(ROOT, 'lib/media/jobs.ts'), 'utf8')).toMatch(/processingHandoff\(\)/)
    expect(readFileSync(path.join(ROOT, 'lib/jobs/registry.ts'), 'utf8')).toMatch(/processingHere\(probed\('workflow_queue'\)\)/)
  })

  it('engine calls run only on engine_call jobs; the key is stripped from every other job (like the resume keys)', () => {
    const src = readFileSync(path.join(ROOT, 'lib/workflow-queue-processor.ts'), 'utf8')
    const body = src.slice(src.indexOf('export async function runJob'))
    expect(body).toMatch(/job\.trigger_type === ENGINE_CALL_TRIGGER_TYPE \? triggerData\?\.\[ENGINE_CALL_KEY\] : undefined/)
    expect(body).toMatch(/if \(triggerData && !engineCall\) delete triggerData\[ENGINE_CALL_KEY\]/)
    expect(body).not.toMatch(/triggerData\?\.\[ENGINE_CALL_KEY\]\s*\n?\s*\?/)
  })
})
