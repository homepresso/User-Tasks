/**
 * Writes the kitchen sink self-test files from lib/kitchen-sink/build.ts:
 *   test-workflows/17-kitchen-sink.json            (the canvas; run by __tests__/test-workflows-run.test.ts)
 *   examples/kitchen-sink/kitchen-sink.bundle.json (the importable bundle)
 *
 *   npm run kitchen-sink:build           write them
 *   npm run kitchen-sink:build -- --check  fail when they are out of date
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildKitchenSink } from '../lib/kitchen-sink/build'

export const KITCHEN_SINK_FILES = {
  workflow: 'test-workflows/17-kitchen-sink.json',
  bundle: 'examples/kitchen-sink/kitchen-sink.bundle.json',
}

const built = buildKitchenSink()
const outputs: Record<string, string> = {
  [KITCHEN_SINK_FILES.workflow]: `${JSON.stringify(built.workflow, null, 2)}\n`,
  [KITCHEN_SINK_FILES.bundle]: `${JSON.stringify(built.bundle, null, 2)}\n`,
}

const check = process.argv.includes('--check')
let stale = 0
for (const [file, content] of Object.entries(outputs)) {
  const full = path.join(process.cwd(), file)
  if (check) {
    let current = ''
    try { current = readFileSync(full, 'utf8') } catch { /* missing */ }
    if (current !== content) { stale++; console.error(`${file} is out of date — run npm run kitchen-sink:build`) }
  } else {
    writeFileSync(full, content)
    console.log(`wrote ${file}`)
  }
}
console.log(`${built.checks.length} checks, ${built.workflow.nodes.length} steps`)
if (stale) process.exit(1)
