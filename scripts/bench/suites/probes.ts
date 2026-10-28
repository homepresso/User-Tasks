/**
 * Correctness/micro probes for audit findings, recorded alongside the
 * numbers so later phases can show them fixed:
 *  - delay > 30 s: the delay node should pause the run; today it returns at once.
 *  - whole-string {{=FUNC()}} is evaluated twice (args resolved twice).
 *  - resolveExpression cost for strings with no "{{" (no early return today).
 */
import { resolveExpression } from '../../../lib/expression-resolver'
import { engineHarness, runOnce } from './engine'
import type { SuiteResult } from '../lib/results'

/** Count reads of one variable while resolving `expr`. */
function variableReads(expr: string): number {
  let reads = 0
  const variables: Record<string, unknown> = {}
  Object.defineProperty(variables, 'probe', { enumerable: true, get: () => { reads++; return 'abc' } })
  resolveExpression(expr, { variables })
  return reads
}

/** Average µs per resolveExpression call. */
function timeResolve(expr: string, ctx: { variables: Record<string, unknown> }, iterations = 50_000): number {
  for (let i = 0; i < 2_000; i++) resolveExpression(expr, ctx) // warm-up
  const started = performance.now()
  for (let i = 0; i < iterations; i++) resolveExpression(expr, ctx)
  return Math.round(((performance.now() - started) * 1000) / iterations * 100) / 100
}

export async function runProbes(): Promise<SuiteResult> {
  const { state, counter, executeWorkflow, db } = await engineHarness()
  try {
    // ── delay > 30 s ──
    process.stdout.write('  probe delay 45 s … ')
    const sample = await runOnce(executeWorkflow, counter, state.workflowIds.delayProbe, state.versionIds.delayProbe)
    const { rows: [run] } = await db.query<{ status: string; node_results: Record<string, { output?: unknown }> }>(
      `SELECT status, node_results FROM public.workflow_runs WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT 1`, [state.workflowIds.delayProbe],
    )
    const waitOutput = run?.node_results?.wait?.output ?? run?.node_results?.wait ?? null
    const delaySkipped = sample.status === 'completed' && sample.wallMs < 45_000
    console.log(`${Math.round(sample.wallMs)} ms, status ${sample.status}`)

    // ── double evaluation ──
    const wholeReads = variableReads('{{=UPPER(probe)}}')
    const mixedReads = variableReads('x {{=UPPER(probe)}}')

    // ── resolveExpression cost ──
    const bigCtx = { variables: Object.fromEntries([...Array(200)].map((_, i) => [`var_${i}`, i])) as Record<string, unknown> }
    bigCtx.variables.name = 'Ada'
    const plainUs = timeResolve('Plain text with no template', bigCtx)
    const varUs = timeResolve('Hello {{name}}', bigCtx)
    const wholeFnUs = timeResolve('{{=UPPER(CONCAT("a", name))}}', bigCtx)
    const mixedFnUs = timeResolve('x {{=UPPER(CONCAT("a", name))}}', bigCtx)

    return {
      data: {
        delay_over_30s: { configured_ms: 45_000, wall_ms: Math.round(sample.wallMs), status: sample.status, run_status: run?.status ?? null, node_output: waitOutput, skipped: delaySkipped },
        double_evaluation: { whole_string_variable_reads: wholeReads, mixed_string_variable_reads: mixedReads, evaluated_twice: wholeReads > mixedReads },
        resolve_expression_us: { plain_no_braces_200_vars: plainUs, single_variable: varUs, whole_string_function: wholeFnUs, mixed_string_function: mixedFnUs },
      },
      tables: [
        {
          title: 'Correctness probes',
          columns: ['probe', 'observed', 'verdict'],
          rows: [
            ['delay node, 45 s (cap 30 s)', `run ${sample.status} in ${Math.round(sample.wallMs)} ms; node output ${JSON.stringify(waitOutput)}`, delaySkipped ? 'BUG: delay silently skipped' : 'ok: run waited/paused'],
            ['{{=UPPER(probe)}} vs "x {{=UPPER(probe)}}"', `variable read ${wholeReads}× vs ${mixedReads}×`, wholeReads > mixedReads ? 'BUG: whole-string function evaluated twice' : 'ok: evaluated once'],
          ],
        },
        {
          title: 'resolveExpression cost (µs/call, ctx with 200 variables)',
          columns: ['expression', 'µs/call'],
          rows: [
            ['plain text, no {{', plainUs],
            ['"Hello {{name}}"', varUs],
            ['{{=UPPER(CONCAT("a", name))}} (whole string)', wholeFnUs],
            ['x {{=UPPER(CONCAT("a", name))}} (mixed)', mixedFnUs],
          ],
        },
      ],
    }
  } finally {
    await db.end()
    counter.uninstall()
  }
}
