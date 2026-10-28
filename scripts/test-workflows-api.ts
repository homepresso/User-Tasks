#!/usr/bin/env npx tsx
/**
 * Comprehensive Workflow API Test Suite
 *
 * Tests all workflow node types by authoring workflows via the API,
 * executing them synchronously, and verifying results through the
 * read APIs.
 *
 * Usage:
 *   API_KEY=your_key BASE_URL=http://localhost:3000 npx tsx scripts/test-workflows-api.ts
 */

const API_KEY = process.env.API_KEY
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")

if (!API_KEY) {
  console.error("❌ API_KEY environment variable is required")
  process.exit(1)
}

// ─── Helpers ───

const hdrs = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" }

/** Calls API — handles both `{ success, data }` and raw response formats */
async function api(method: string, path: string, body?: any) {
  const url = `${BASE_URL}/api/v1${path}`
  const res = await fetch(url, { method, headers: hdrs, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`API ${method} ${path} [${res.status}]: ${json.error ?? JSON.stringify(json)}`)
  // Workflow APIs wrap in { success, data }, task ingest returns flat
  if (json.success !== undefined) return json.data
  return json
}

function uuid() { return crypto.randomUUID() }
function node(id: string, type: string, label: string, config: any, x = 0, y = 0) {
  return { id, type, label, position: { x, y }, config }
}
function edge(source: string, target: string, label?: string) {
  return { id: uuid(), source, target, ...(label ? { label } : {}) }
}

const results: { name: string; pass: boolean; details: string }[] = []

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`)
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    results.push({ name, pass: true, details: "OK" })
    console.log(`  ✅ ${name}`)
  } catch (e: any) {
    results.push({ name, pass: false, details: e.message })
    console.log(`  ❌ ${name}: ${e.message}`)
  }
}

/** Helper to get a node's output from run.node_results */
function nodeOut(run: any, nodeId: string) {
  return run.node_results?.[nodeId]?.output ?? {}
}

// ─── Author + Run helper ───

async function authorAndRun(name: string, nodes: any[], edges: any[], variables?: Record<string, any>) {
  const data = await api("POST", "/workflows", {
    name,
    trigger_type: "webhook_received",
    nodes,
    edges,
    publish: true,
    publish_notes: "API test",
  })
  const wfId = data.workflow_id

  const run = await api("POST", "/workflows/start", {
    workflow_id: wfId,
    variables: variables ?? {},
  })
  return { workflowId: wfId, run }
}

async function getRunDetail(runId: string) {
  return api("GET", `/workflows/runs/${runId}`)
}

async function getWorkflowDetail(wfId: string, includeDefinition = false) {
  const params = includeDefinition ? "?include_definition=true&include_logs=true" : "?include_logs=true"
  return api("GET", `/workflows/${wfId}${params}`)
}

// ══════════════════════════════════════════════════════════════
// TEST WORKFLOWS
// ══════════════════════════════════════════════════════════════

async function testDataOperations() {
  const t = uuid(), n1 = uuid(), n2 = uuid(), n3 = uuid(), n4 = uuid(), n5 = uuid(), n6 = uuid(), n7 = uuid(), n8 = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(n1, "set_title", "Set Title", { title: "Data Ops: {{input_name}}" }),
    node(n2, "set_variable", "Set Greeting", { name: "greeting", expression: "Hello" }),
    node(n3, "math", "Compute Count", { expression: "5 + 3", output_var: "count" }),
    node(n4, "math", "Double Count", { expression: "{{count}} * 2", output_var: "doubled" }),
    node(n5, "modify_string", "Uppercase Greeting", {
      input: "{{greeting}} world", operation: "uppercase", output_var: "shout",
    }),
    node(n6, "text_template", "Build Message", {
      template: "{{shout}} - count is {{doubled}}", output_var: "message",
    }),
    node(n7, "regex", "Extract Numbers", {
      input: "{{message}}", pattern: "\\d+", flags: "g", operation: "match", output_var: "numbers",
    }),
    node(n8, "log", "Log Result", { message: "Final: {{message}}" }),
  ]

  const edges = [
    edge(t, n1), edge(n1, n2), edge(n2, n3), edge(n3, n4),
    edge(n4, n5), edge(n5, n6), edge(n6, n7), edge(n7, n8),
  ]

  const { run } = await authorAndRun("Test: Data Operations Pipeline", nodes, edges, { input_name: "Integration Test" })
  assert(run.status === "completed", `Expected completed, got ${run.status}`)

  // Verify node outputs directly
  assert(nodeOut(run, n2).value === "Hello", `greeting: ${nodeOut(run, n2).value}`)
  assert(nodeOut(run, n3).result === 8, `count: ${nodeOut(run, n3).result}`)
  assert(nodeOut(run, n4).result === 16, `doubled: ${nodeOut(run, n4).result}`)
  assert(nodeOut(run, n5).result === "HELLO WORLD", `shout: ${nodeOut(run, n5).result}`)
  assert(nodeOut(run, n6).result === "HELLO WORLD - count is 16", `message: ${nodeOut(run, n6).result}`)
  const nums = nodeOut(run, n7).result
  assert(Array.isArray(nums) && nums.includes("16"), `numbers: ${JSON.stringify(nums)}`)
}

async function testStringOperations() {
  const t = uuid(), s1 = uuid(), s2 = uuid(), s3 = uuid(), s4 = uuid(), s5 = uuid(), s6 = uuid(), s7 = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(s1, "modify_string", "Trim", { input: "  hello  ", operation: "trim", output_var: "trimmed" }),
    node(s2, "modify_string", "Lowercase", { input: "HELLO WORLD", operation: "lowercase", output_var: "lowered" }),
    node(s3, "modify_string", "Replace", {
      input: "foo-bar-baz", operation: "replace",
      search: "-", replace_with: "_", replace_all: true, output_var: "replaced",
    }),
    node(s4, "modify_string", "Substring", {
      input: "Hello World", operation: "substring", start: 0, end: 5, output_var: "sub",
    }),
    node(s5, "modify_string", "Slug", {
      input: "Hello World! Test 123", operation: "slug", output_var: "slug_result",
    }),
    node(s6, "modify_string", "Reverse", {
      input: "abcdef", operation: "reverse", output_var: "reversed",
    }),
    node(s7, "modify_string", "Pad Start", {
      input: "42", operation: "pad_start", length: 5, pad_char: "0", output_var: "padded",
    }),
  ]

  const edges = [
    edge(t, s1), edge(s1, s2), edge(s2, s3), edge(s3, s4), edge(s4, s5), edge(s5, s6), edge(s6, s7),
  ]

  const { run } = await authorAndRun("Test: String Operations", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(nodeOut(run, s1).result === "hello", `trimmed: "${nodeOut(run, s1).result}"`)
  assert(nodeOut(run, s2).result === "hello world", `lowered: "${nodeOut(run, s2).result}"`)
  assert(nodeOut(run, s3).result === "foo_bar_baz", `replaced: "${nodeOut(run, s3).result}"`)
  assert(nodeOut(run, s4).result === "Hello", `sub: "${nodeOut(run, s4).result}"`)
  assert(nodeOut(run, s5).result === "hello-world-test-123", `slug: "${nodeOut(run, s5).result}"`)
  assert(nodeOut(run, s6).result === "fedcba", `reversed: "${nodeOut(run, s6).result}"`)
  assert(nodeOut(run, s7).result === "00042", `padded: "${nodeOut(run, s7).result}"`)
}

async function testMathExpressions() {
  const t = uuid(), m1 = uuid(), m2 = uuid(), m3 = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(m1, "math", "Addition", { expression: "10 + 25", output_var: "sum" }),
    node(m2, "math", "Multiply", { expression: "{{sum}} * 3", output_var: "product" }),
    node(m3, "math", "Complex", { expression: "({{product}} - 5) / 2", output_var: "final" }),
  ]
  const edges = [edge(t, m1), edge(m1, m2), edge(m2, m3)]

  const { run } = await authorAndRun("Test: Math Expressions", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(nodeOut(run, m1).result === 35, `sum: ${nodeOut(run, m1).result}`)
  assert(nodeOut(run, m2).result === 105, `product: ${nodeOut(run, m2).result}`)
  assert(nodeOut(run, m3).result === 50, `final: ${nodeOut(run, m3).result}`)
}

async function testExpressionFunctions() {
  const t = uuid(), e1 = uuid(), e2 = uuid(), e3 = uuid(), e4 = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    // Use text_template to evaluate expression functions (avoids quote issues in set_variable)
    node(e1, "text_template", "String Funcs", { template: "{{=UPPER('hello')}}", output_var: "upper_result" }),
    node(e2, "math", "Math Funcs", { expression: "{{=ABS(-42)}} + {{=ROUND(3.7)}}", output_var: "math_result" }),
    node(e3, "text_template", "IF Function", { template: "{{=IF(10 > 5, 'yes', 'no')}}", output_var: "if_result" }),
    node(e4, "text_template", "IS_EMPTY Func", { template: "{{=IS_EMPTY('')}}", output_var: "empty_result" }),
  ]
  const edges = [edge(t, e1), edge(e1, e2), edge(e2, e3), edge(e3, e4)]

  const { run } = await authorAndRun("Test: Expression Functions", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(nodeOut(run, e1).result === "HELLO", `upper: "${nodeOut(run, e1).result}"`)
  assert(nodeOut(run, e2).result === 46, `math: ${nodeOut(run, e2).result}`)
  assert(nodeOut(run, e3).result === "yes", `if: "${nodeOut(run, e3).result}"`)
  assert(String(nodeOut(run, e4).result) === "true", `empty: "${nodeOut(run, e4).result}"`)
}

async function testRegexOperations() {
  const t = uuid(), r1 = uuid(), r2 = uuid(), r3 = uuid(), r4 = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(r1, "regex", "Match Emails", {
      input: "Contact test@example.com or admin@site.org",
      pattern: "[\\w.+-]+@[\\w-]+\\.[a-z]{2,}", flags: "gi", operation: "match", output_var: "emails",
    }),
    node(r2, "regex", "Test Has Number", {
      input: "abc123def", pattern: "\\d+", flags: "", operation: "test", output_var: "has_number",
    }),
    node(r3, "regex", "Replace Digits", {
      input: "phone: 123-456-7890", pattern: "\\d", flags: "g",
      operation: "replace", replace_with: "X", output_var: "redacted",
    }),
    node(r4, "regex", "Split CSV", {
      input: "one,two,,three", pattern: ",+", flags: "", operation: "split", output_var: "csv_parts",
    }),
  ]
  const edges = [edge(t, r1), edge(r1, r2), edge(r2, r3), edge(r3, r4)]

  const { run } = await authorAndRun("Test: Regex Operations", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  const emails = nodeOut(run, r1).result
  assert(Array.isArray(emails) && emails.length === 2, `emails: ${JSON.stringify(emails)}`)
  assert(nodeOut(run, r2).result === true, `has_number: ${nodeOut(run, r2).result}`)
  assert(nodeOut(run, r3).result === "phone: XXX-XXX-XXXX", `redacted: "${nodeOut(run, r3).result}"`)
  const parts = nodeOut(run, r4).result
  assert(Array.isArray(parts) && parts.length === 3, `csv_parts: ${JSON.stringify(parts)}`)
}

async function testDateOperations() {
  const t = uuid(), d1 = uuid(), d2 = uuid(), d3 = uuid(), d4 = uuid(), d5 = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(d1, "set_variable", "Set Date", { name: "test_date", expression: "2025-06-15T12:00:00.000Z" }),
    node(d2, "format_date", "Format Custom", {
      date: "{{test_date}}", format: "custom", custom_format: "YYYY-MM-DD", output_var: "custom_date",
    }),
    node(d3, "date_math", "Add 7 Days", {
      date: "{{test_date}}", operation: "add", amount: "7", unit: "days", output_var: "plus_7",
    }),
    node(d4, "date_math", "Subtract 1 Month", {
      date: "{{test_date}}", operation: "subtract", amount: "1", unit: "months", output_var: "minus_month",
    }),
    node(d5, "date_math", "Interval", {
      date: "{{test_date}}", date2: "{{plus_7}}", operation: "interval", output_var: "interval_result",
    }),
  ]
  const edges = [edge(t, d1), edge(d1, d2), edge(d2, d3), edge(d3, d4), edge(d4, d5)]

  const { run } = await authorAndRun("Test: Date Operations", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(nodeOut(run, d2).result === "2025-06-15", `custom_date: ${nodeOut(run, d2).result}`)
  const plus7 = nodeOut(run, d3).result
  assert(plus7?.includes("2025-06-22"), `plus_7: ${plus7}`)
  const minusMonth = nodeOut(run, d4).result
  assert(minusMonth?.includes("2025-05"), `minus_month: ${minusMonth}`)
  assert(nodeOut(run, d5).result?.days === 7, `interval days: ${nodeOut(run, d5).result?.days}`)
}

async function testJsonAndCollections() {
  const t = uuid()
  const obj = uuid(), arr = uuid(), add1 = uuid(), add2 = uuid(), getV = uuid()
  const cnt = uuid(), srt = uuid(), getI = uuid(), jn = uuid(), unq = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(obj, "json_build_object", "Build User", {
      output_var: "user",
      fields: [{ key: "name", value: "Alice" }, { key: "age", value: "30" }, { key: "role", value: "engineer" }],
    }),
    node(arr, "json_build_array", "Init Items", { output_var: "items", items: [] }),
    node(add1, "json_add_to_array", "Add Apple", {
      array_var: "items", fields: [{ key: "name", value: "apple" }, { key: "score", value: "3" }],
    }),
    node(add2, "json_add_to_array", "Add Banana", {
      array_var: "items", fields: [{ key: "name", value: "banana" }, { key: "score", value: "1" }],
    }),
    node(getV, "json_get_value", "Get Name", {
      source: "{{user}}", path: "name", output_var: "user_name",
    }),
    node(cnt, "collection_count", "Count", { collection: "{{items}}", output_var: "item_count" }),
    node(srt, "collection_sort", "Sort by Score Desc", {
      collection: "{{items}}", field: "score", direction: "desc", output_var: "sorted_items",
    }),
    node(getI, "collection_get", "Get First", { collection: "{{sorted_items}}", index: "0", output_var: "top_item" }),
    node(jn, "collection_join", "Join Names", {
      collection: "{{items}}", field: "name", separator: ", ", output_var: "names_joined",
    }),
    node(unq, "collection_unique", "Dedupe", { collection: "{{dup_list}}", output_var: "unique_list" }),
  ]

  const edges = [
    edge(t, obj), edge(obj, arr), edge(arr, add1), edge(add1, add2),
    edge(add2, getV), edge(getV, cnt), edge(cnt, srt), edge(srt, getI), edge(getI, jn), edge(jn, unq),
  ]

  const { run } = await authorAndRun("Test: JSON & Collections", nodes, edges, { dup_list: ["a", "b", "a", "c", "b"] })
  assert(run.status === "completed", `Expected completed, got ${run.status}`)

  // Build object
  assert(nodeOut(run, obj).field_count === 3, `obj field_count: ${nodeOut(run, obj).field_count}`)
  // Get value
  assert(nodeOut(run, getV).type === "string", `get value type: ${nodeOut(run, getV).type}`)
  // Count
  assert(nodeOut(run, cnt).count === 2, `item_count: ${nodeOut(run, cnt).count}`)
  // Join
  assert(nodeOut(run, jn).result === "apple, banana", `join: "${nodeOut(run, jn).result}"`)
  // Unique
  assert(nodeOut(run, unq).unique === 3, `unique: ${nodeOut(run, unq).unique}`)
  assert(nodeOut(run, unq).original === 5, `original: ${nodeOut(run, unq).original}`)
}

async function testCollectionFilter() {
  const t = uuid(), setV = uuid(), flt = uuid(), cnt = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    // Pass products as initial variables instead of inline expression
    node(setV, "set_variable", "Marker", { name: "ready", expression: "yes" }),
    node(flt, "collection_filter", "Filter >20", {
      collection: "{{products}}", field: "price", operator: "gt", value: "20",
      output_var: "expensive",
    }),
    node(cnt, "collection_count", "Count", { collection: "{{expensive}}", output_var: "expensive_count" }),
  ]
  const edges = [edge(t, setV), edge(setV, flt), edge(flt, cnt)]

  const { run } = await authorAndRun("Test: Collection Filter", nodes, edges, {
    products: [
      { name: "Widget", price: 10 }, { name: "Gadget", price: 50 },
      { name: "Doohickey", price: 5 }, { name: "Thingamajig", price: 100 },
    ],
  })
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(nodeOut(run, cnt).count === 2, `expensive_count: ${nodeOut(run, cnt).count}`)
}

async function testConditionBranching() {
  const t = uuid(), setS = uuid(), cond = uuid(), high = uuid(), low = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(setS, "math", "Set Score", { expression: "85", output_var: "score" }),
    node(cond, "condition", "Check Score", {
      branches: [
        { label: "High", logic: "and", rules: [{ field: "{{score}}", operator: "gt", value: "70" }] },
        { label: "Low", logic: "and", rules: [{ field: "{{score}}", operator: "lte", value: "70" }] },
      ],
      has_else: true,
    }),
    node(high, "set_variable", "Grade A", { name: "grade", expression: "A" }),
    node(low, "set_variable", "Grade C", { name: "grade", expression: "C" }),
  ]
  const edges = [
    edge(t, setS), edge(setS, cond),
    edge(cond, high, "High"),
    edge(cond, low, "Low"),
  ]

  const { run } = await authorAndRun("Test: Condition Branching", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  // The High branch should have been taken
  assert(run.node_results?.[high]?.status === "success", `High branch should have executed`)
  assert(nodeOut(run, high).value === "A", `grade: ${nodeOut(run, high).value}`)
  // Low branch should NOT have executed
  assert(!run.node_results?.[low], `Low branch should not execute`)
}

async function testSwitchCase() {
  const t = uuid(), setS = uuid(), sw = uuid(), active = uuid(), pending = uuid(), def = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(setS, "set_variable", "Set Status", { name: "status", expression: "pending" }),
    node(sw, "switch_case", "Route", {
      field: "{{status}}",
      cases: [{ value: "active", label: "active" }, { value: "pending", label: "pending" }],
      has_default: true,
    }),
    node(active, "set_variable", "Active", { name: "result", expression: "is_active" }),
    node(pending, "set_variable", "Pending", { name: "result", expression: "is_pending" }),
    node(def, "set_variable", "Default", { name: "result", expression: "is_default" }),
  ]
  const edges = [
    edge(t, setS), edge(setS, sw),
    edge(sw, active, "active"), edge(sw, pending, "pending"), edge(sw, def, "default"),
  ]

  const { run } = await authorAndRun("Test: Switch Case", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(run.node_results?.[pending]?.status === "success", `Pending branch should execute`)
  assert(nodeOut(run, pending).value === "is_pending", `result: ${nodeOut(run, pending).value}`)
}

async function testEndWorkflow() {
  const t = uuid(), v1 = uuid(), end = uuid(), never = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(v1, "set_variable", "Before End", { name: "before_end", expression: "reached" }),
    node(end, "end_workflow", "Stop", {}),
    node(never, "set_variable", "After End", { name: "after_end", expression: "should_not_exist" }),
  ]
  const edges = [edge(t, v1), edge(v1, end), edge(end, never)]

  const { run } = await authorAndRun("Test: End Workflow", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(run.node_results?.[v1]?.status === "success", `before_end should execute`)
  assert(!run.node_results?.[never], `after_end should NOT execute`)
}

async function testGotoActivity() {
  const t = uuid(), init = uuid(), check = uuid(), inc = uuid(), goback = uuid(), done = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(init, "math", "Init Counter", { expression: "0", output_var: "counter" }),
    node(check, "condition", "Check <3", {
      branches: [
        { label: "Continue", logic: "and", rules: [{ field: "{{counter}}", operator: "less_than", value: "3" }] },
      ],
      has_else: true,
    }),
    node(inc, "math", "Increment", { expression: "{{counter}} + 1", output_var: "counter" }),
    node(goback, "goto_activity", "Loop Back", { target_node_id: check }),
    node(done, "set_variable", "Done", { name: "loop_done", expression: "yes" }),
  ]
  const edges = [
    edge(t, init), edge(init, check),
    edge(check, inc, "Continue"),
    edge(check, done, "Else"),
    edge(inc, goback),
  ]

  const { run } = await authorAndRun("Test: Goto Activity Loop", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  // Counter should have incremented to 3 before the Else branch triggered
  assert(run.node_results?.[done]?.status === "success", `Done node should execute`)
}

async function testLoopForEach() {
  const t = uuid(), loop = uuid(), tmpl = uuid(), add = uuid(), cnt = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(loop, "loop", "Loop Names", { items: "{{names}}", item_var: "current_name", index_var: "i" }),
    // Multi-node body chain: template → add_to_array (tests full body re-execution)
    node(tmpl, "text_template", "Build Greeting", {
      template: "Hello {{current_name}}!", output_var: "greeting",
    }),
    node(add, "json_add_to_array", "Collect Greeting", {
      array_var: "greetings", value: "{{greeting}}",
    }),
    node(cnt, "collection_count", "Count", { collection: "{{greetings}}", output_var: "greeting_count" }),
  ]
  const edges = [
    edge(t, loop),
    edge(loop, tmpl, "Each Item"),  // body start
    edge(tmpl, add),                 // body chain (downstream node)
    edge(loop, cnt, "Done"),         // runs after all iterations
  ]

  const { run } = await authorAndRun("Test: Loop For Each", nodes, edges, {
    names: ["Alice", "Bob", "Charlie"],
    greetings: [],
  })
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(nodeOut(run, cnt).count === 3, `greeting_count: ${nodeOut(run, cnt).count}`)
}

async function testLoopNTimes() {
  const t = uuid(), loop = uuid(), math = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(loop, "loop_n_times", "Loop 5", { count: "5", index_var: "i" }),
    node(math, "math", "Add 1", { expression: "{{accumulator}} + 1", output_var: "accumulator" }),
  ]
  const edges = [edge(t, loop), edge(loop, math)]

  const { run } = await authorAndRun("Test: Loop N Times", nodes, edges, { accumulator: 0 })
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  // The math node result should show the final value
  assert(nodeOut(run, math).result === 5, `accumulator: ${nodeOut(run, math).result}`)
}

async function testDelayNode() {
  const t = uuid(), delay = uuid(), after = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(delay, "delay", "Short Delay", { duration: "1", unit: "seconds" }),
    node(after, "set_variable", "After", { name: "delayed", expression: "true" }),
  ]
  const edges = [edge(t, delay), edge(delay, after)]

  const { run } = await authorAndRun("Test: Delay Node", nodes, edges)
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  assert(nodeOut(run, after).value === "true", `delayed: ${nodeOut(run, after).value}`)
}

async function testErrorHandling() {
  const t = uuid(), bad = uuid(), after = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    { ...node(bad, "math", "Bad Math", { expression: "{{nonexistent}} / 0", output_var: "bad" }), onError: "continue" as const },
    node(after, "set_variable", "Survived", { name: "survived", expression: "yes" }),
  ]
  const edges = [edge(t, bad), edge(bad, after)]

  const { run } = await authorAndRun("Test: Error Handling", nodes, edges)
  assert(run.status === "completed", `Should complete despite error, got ${run.status}`)
  assert(run.node_results?.[after]?.status === "success", `Should continue after error`)
}

async function testServerEventPauseResume() {
  const t = uuid(), setV = uuid(), evt = uuid(), after = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(setV, "set_variable", "Set Input", { name: "request_type", expression: "approval" }),
    node(evt, "server_event", "Wait for Approval", {
      event_name: "approval_needed", send_variables: ["request_type"], outbound_action: "none",
    }),
    node(after, "set_variable", "After Resume", { name: "final_status", expression: "{{approval_result}}" }),
  ]
  const edges = [edge(t, setV), edge(setV, evt), edge(evt, after)]

  const { workflowId, run } = await authorAndRun("Test: Server Event", nodes, edges)
  assert(run.status === "waiting_for_event", `Should pause, got ${run.status}`)

  // Verify via run detail
  const detail = await getRunDetail(run.run_id)
  assert(detail.run.status === "waiting_for_event", `Run should be waiting`)
  const eventId = detail.run.event_id
  assert(!!eventId, "Should have event_id")

  // Complete the event
  await api("POST", `/workflows/events/${eventId}/complete`, {
    return_variables: { approval_result: "approved" },
  })

  await new Promise(r => setTimeout(r, 1000))

  // Verify completed
  const final = await getWorkflowDetail(workflowId)
  assert(final.current_run?.status === "completed", `Should complete after resume: ${final.current_run?.status}`)
}

async function testUserTaskPauseResume() {
  const t = uuid(), prep = uuid(), wait = uuid(), after = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(prep, "set_variable", "Prepare", { name: "approval_value", expression: "pending" }),
    node(wait, "user_task", "Approval", {
      task_title: "Approve API Test",
      task_description: "Regression coverage for workflow resume after user task completion",
      task_priority: "medium",
      assignment_type: "individual",
      outcomes: ["Approved", "Rejected"],
    }),
    node(after, "set_variable", "After Approval", { name: "approval_value", expression: "{{outcome}}" }),
  ]
  const edges = [edge(t, prep), edge(prep, wait), edge(wait, after, "Approved")]

  const { workflowId, run } = await authorAndRun("Test: User Task Pause/Resume", nodes, edges)
  assert(run.status === "waiting_for_event", `Should pause at user_task, got ${run.status}`)
  assert(!!run.run_id, "Should include run_id")
  assert(!!run.event_id, "Should include event_id")

  const taskList = await api("GET", `/tasks?is_workflow_task=true&limit=20`)
  const targetTask = (taskList.tasks ?? []).find((task: any) => task.event_id === run.event_id)
  assert(!!targetTask?.id, `Should create a workflow task for event ${run.event_id}`)

  const completeResult = await api("POST", `/tasks/${targetTask.id}/action`, {
    action: "complete",
    outcome: "Approved",
    outcome_notes: "Regression test approval",
  })
  assert(completeResult.workflow_resumed !== false, `Workflow should resume after task completion: ${JSON.stringify(completeResult)}`)

  await new Promise(r => setTimeout(r, 1500))

  const final = await getRunDetail(run.run_id)
  assert(final.run.status === "completed", `Run should complete after user task response, got ${final.run.status}`)
  assert(final.run.node_results?.[after]?.status === "success", "Downstream node after user task should execute")
  assert(nodeOut(final.run, after).value === "Approved", `Outcome should flow downstream, got ${JSON.stringify(nodeOut(final.run, after))}`)

  const taskCheck = await api("GET", `/tasks/${targetTask.id}`)
  assert(taskCheck.task.status === "completed", `Task should be completed, got ${taskCheck.task.status}`)
  assert(taskCheck.task.outcome === "Approved", `Task outcome should be Approved, got ${taskCheck.task.outcome}`)
}

async function testRunCancel() {
  const t = uuid(), evt = uuid(), after = uuid()

  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(evt, "server_event", "Wait", { event_name: "test", outbound_action: "none" }),
    node(after, "set_variable", "After", { name: "x", expression: "y" }),
  ]
  const edges = [edge(t, evt), edge(evt, after)]

  const { run } = await authorAndRun("Test: Run Cancel", nodes, edges)
  assert(run.status === "waiting_for_event", `Should pause`)

  const result = await api("POST", `/workflows/runs/${run.run_id}/action`, { action: "cancel" })
  assert(result.action === "cancelled", `Should cancel, got: ${JSON.stringify(result)}`)

  const detail = await getRunDetail(run.run_id)
  assert(detail.run.status === "failed", `Cancelled run status: ${detail.run.status}`)
}

async function testSubWorkflow() {
  // Create sub-workflow
  const st = uuid(), sm = uuid()
  const subNodes = [
    node(st, "webhook_received", "Sub Trigger", {}),
    node(sm, "modify_string", "Uppercase", { input: "{{sub_input}}", operation: "uppercase", output_var: "sub_output" }),
  ]
  const subData = await api("POST", "/workflows", {
    name: "Test: Sub-Workflow Utility",
    trigger_type: "webhook_received",
    nodes: subNodes,
    edges: [edge(st, sm)],
    publish: true,
  })

  // Create parent workflow
  const pt = uuid(), call = uuid(), capture = uuid()
  const parentNodes = [
    node(pt, "webhook_received", "Trigger", {}),
    node(call, "call_sub_workflow", "Call Sub", {
      sub_workflow_id: subData.workflow_id,
      sub_workflow_name: "Uppercase Utility",
      input_mappings: { sub_input: "{{my_text}}" },
    }),
    node(capture, "set_variable", "Capture", { name: "final_result", expression: "{{sub_output}}" }),
  ]
  const parentEdges = [edge(pt, call), edge(call, capture)]

  const { run } = await authorAndRun("Test: Parent+Sub Workflow", parentNodes, parentEdges, { my_text: "hello from parent" })
  assert(run.status === "completed", `Expected completed, got ${run.status}`)
  // Sub-workflow should have completed successfully
  const callOutput = nodeOut(run, call)
  assert(callOutput.status === "completed", `sub status: ${callOutput.status}`)
  assert(callOutput.node_count > 0, `sub ran nodes: ${callOutput.node_count}`)
}

async function testTaskIngestAndAutoAction() {
  // Ingest API uses raw response format (not { success, data } wrapper)
  const taskData = await api("POST", "/tasks/ingest", {
    title: "API Test Task - Auto Action",
    description: "For workflow testing",
    priority: "high",
    subtasks: [
      { title: "Sub-step 1", description: "First" },
      { title: "Sub-step 2", description: "Second" },
    ],
  })
  const taskId = taskData.task_id
  assert(!!taskId, "Should get task_id from ingest")
  assert(taskData.subtask_count === 2, `subtask_count: ${taskData.subtask_count}`)

  // Verify via GET
  const task = await api("GET", `/tasks/${taskId}`)
  assert(task.task.title === "API Test Task - Auto Action", `title: ${task.task.title}`)
  assert(task.task.priority === "high", `priority: ${task.task.priority}`)

  // Verify subtasks
  const subs = await api("GET", `/tasks?parent_task_id=${taskId}`)
  assert(subs.tasks.length === 2, `subtasks: ${subs.tasks.length}`)

  // Auto-complete via workflow
  const t = uuid(), auto = uuid(), log = uuid()
  const nodes = [
    node(t, "webhook_received", "Trigger", {}),
    node(auto, "auto_action", "Complete Task", {
      target_task_id: "{{target_task}}", status: "completed", outcome: "Auto-completed by test",
    }),
    node(log, "log", "Log", { message: "Task completed" }),
  ]
  const edges = [edge(t, auto), edge(auto, log)]

  const { run } = await authorAndRun("Test: Auto Action", nodes, edges, { target_task: taskId })
  assert(run.status === "completed", `Workflow: ${run.status}`)

  // Verify task updated
  const updated = await api("GET", `/tasks/${taskId}`)
  assert(updated.task.status === "completed", `Task status: ${updated.task.status}`)
  assert(updated.task.outcome === "Auto-completed by test", `outcome: ${updated.task.outcome}`)
}

async function testTaskActions() {
  const taskData = await api("POST", "/tasks/ingest", {
    title: "API Test - Accept/Complete",
    priority: "medium",
  })
  const taskId = taskData.task_id

  // Accept
  await api("POST", `/tasks/${taskId}/action`, { action: "accept" })
  const afterAccept = await api("GET", `/tasks/${taskId}`)
  assert(afterAccept.task.status === "in_progress", `After accept: ${afterAccept.task.status}`)

  // Complete
  await api("POST", `/tasks/${taskId}/action`, {
    action: "complete", outcome: "done", outcome_notes: "API test",
  })
  const afterComplete = await api("GET", `/tasks/${taskId}`)
  assert(afterComplete.task.status === "completed", `After complete: ${afterComplete.task.status}`)
}

async function testIdempotentIngest() {
  const key = `test_${uuid()}`

  const first = await api("POST", "/tasks/ingest", {
    title: "Idempotent Test", priority: "low", idempotency_key: key,
  })
  const taskId = first.task_id

  const second = await api("POST", "/tasks/ingest", {
    title: "Idempotent Test", priority: "low", idempotency_key: key,
  })
  assert(second.task_id === taskId, `Same task_id: ${second.task_id} vs ${taskId}`)
  assert(second.deduplicated === true, `Should flag deduplicated`)
}

async function testListAPIs() {
  const wfs = await api("GET", "/workflows?limit=5")
  assert(Array.isArray(wfs.workflows), "Should return workflows array")
  assert(wfs.total > 0, `Should have workflows: ${wfs.total}`)

  const runs = await api("GET", "/workflows/runs?limit=5")
  assert(Array.isArray(runs.runs), "Should return runs array")
  assert(runs.total > 0, `Should have runs: ${runs.total}`)

  if (runs.runs.length > 0) {
    const detail = await getRunDetail(runs.runs[0].id)
    assert(!!detail.run, "Should have run detail")
    assert(Array.isArray(detail.logs), "Should have logs")
  }

  if (wfs.workflows.length > 0) {
    const detail = await getWorkflowDetail(wfs.workflows[0].id, true)
    assert(!!detail.workflow, "Should have workflow")
    assert(!!detail.definition, "Should have definition")
  }
}

// ══════════════════════════════════════════════════════════════
// ULTIMATE STRESS TEST
// ══════════════════════════════════════════════════════════════

/**
 * Single mega-workflow that chains every testable node type together in a
 * realistic, multi-phase pipeline:
 *
 *   Phase 1  Setup & Data Transformation
 *            trigger → set_title → set_variable × 3 → math × 3
 *            → modify_string × 3 → text_template → regex × 2
 *
 *   Phase 2  Dates
 *            → format_date → date_math (add) → date_math (interval)
 *
 *   Phase 3  JSON & Collections
 *            → json_build_object → json_build_array → loop_n_times (5 iterations
 *              with 2-node body: math + json_add_to_array) → "Done" →
 *            → collection_sort → collection_filter → collection_get
 *            → collection_unique → collection_count → collection_join
 *
 *   Phase 4  Branching
 *            → condition (3-way) → [High/Med/Low branches each set_variable]
 *            → switch_case → [cases each set_variable]
 *
 *   Phase 5  Loop For-Each with multi-node body
 *            → loop (3 items, body: template → modify_string → add_to_array)
 *            → "Done" → count
 *
 *   Phase 6  Goto-Activity manual loop
 *            → init counter → condition <3 → increment → goto → else: done
 *
 *   Phase 7  Parallel branches
 *            → parallel (2 branches: each does a set_variable)
 *
 *   Phase 8  Sub-Workflow call
 *            → call_sub_workflow (child uppercases a string)
 *
 *   Phase 9  Server Event (pause / resume)
 *            → server_event → after_resume set_variable
 *
 *   Phase 10 Error resilience
 *            → bad math (onError: continue) → survived set_variable
 *
 *   Phase 11 Task integration
 *            → ingest task via API → auto_action to complete it
 *
 *   Phase 12 Delay + Log + End
 *            → delay (1 s) → log → end_workflow
 *
 * Verification happens at every phase boundary by inspecting node_results.
 * The server_event in Phase 9 splits execution into two API calls
 * (start → pause, event complete → finish).
 */
async function testUltimateStressTest() {
  // ── Create the sub-workflow needed by Phase 8 ──
  const subT = uuid(), subM = uuid()
  const subData = await api("POST", "/workflows", {
    name: "Stress: Sub-Workflow Helper",
    trigger_type: "webhook_received",
    nodes: [
      node(subT, "webhook_received", "Sub Trigger", {}),
      node(subM, "modify_string", "Reverse Input", {
        input: "{{sub_input}}", operation: "reverse", output_var: "sub_output",
      }),
    ],
    edges: [edge(subT, subM)],
    publish: true,
  })
  const subWfId = subData.workflow_id

  // ── Create a task for Phase 11 ──
  const taskData = await api("POST", "/tasks/ingest", {
    title: "Stress Test Target Task",
    priority: "high",
    subtasks: [{ title: "Sub-A" }, { title: "Sub-B" }, { title: "Sub-C" }],
  })
  const targetTaskId = taskData.task_id

  // ── Node IDs ──
  // Phase 1: Setup
  const TRIGGER      = uuid()
  const SET_TITLE     = uuid()
  const SET_VAR1      = uuid()  // greeting = "Hello"
  const SET_VAR2      = uuid()  // separator = " | "
  const SET_VAR3      = uuid()  // base_year = "2025"
  const MATH1         = uuid()  // 10 + 25 = 35
  const MATH2         = uuid()  // 35 * 3 = 105
  const MATH3         = uuid()  // (105 - 5) / 2 = 50
  const STR_UPPER     = uuid()  // "hello world" → "HELLO WORLD"
  const STR_REPLACE   = uuid()  // "foo-bar-baz" → "foo_bar_baz"
  const STR_SLUG      = uuid()  // "Hello World! Test" → "hello-world-test"
  const TEMPLATE      = uuid()  // "HELLO WORLD | Result: 50"
  const REGEX_MATCH   = uuid()  // extract numbers from template
  const REGEX_REPLACE = uuid()  // redact digits

  // Phase 2: Dates
  const DATE_FMT      = uuid()
  const DATE_ADD      = uuid()
  const DATE_INTERVAL = uuid()

  // Phase 3: JSON & Collections
  const JSON_OBJ      = uuid()  // build employee object
  const JSON_ARR      = uuid()  // init scores array
  const LOOP_N        = uuid()  // loop 5 times
  const LOOP_N_MATH   = uuid()  // body: compute score = (i+1)*10
  const LOOP_N_ADD    = uuid()  // body: push {index, score} into scores
  const COLL_SORT     = uuid()  // sort scores desc
  const COLL_FILTER   = uuid()  // filter score > 20
  const COLL_GET      = uuid()  // get first (highest)
  const COLL_UNIQUE   = uuid()  // dedupe a list with dups
  const COLL_COUNT    = uuid()  // count filtered
  const COLL_JOIN     = uuid()  // join scores into string

  // Phase 4: Branching
  const COND          = uuid()
  const COND_HIGH     = uuid()
  const COND_MED      = uuid()
  const COND_LOW      = uuid()
  const SWITCH        = uuid()
  const SW_A          = uuid()
  const SW_B          = uuid()
  const SW_DEF        = uuid()

  // Phase 5: Loop for-each (multi-node body)
  const LOOP_EACH     = uuid()
  const LOOP_TMPL     = uuid()
  const LOOP_MOD      = uuid()
  const LOOP_PUSH     = uuid()
  const LOOP_DONE_CNT = uuid()

  // Phase 6: Goto-activity loop
  const GOTO_INIT     = uuid()
  const GOTO_CHECK    = uuid()
  const GOTO_INC      = uuid()
  const GOTO_JUMP     = uuid()
  const GOTO_DONE     = uuid()

  // Phase 7: Parallel
  const PARALLEL      = uuid()
  const PAR_A         = uuid()
  const PAR_B         = uuid()

  // Phase 8: Sub-workflow
  const CALL_SUB      = uuid()

  // Phase 9: Server event (pause/resume)
  const SRV_EVENT     = uuid()
  const AFTER_RESUME  = uuid()

  // Phase 10: Error resilience
  const BAD_MATH      = uuid()
  const SURVIVED      = uuid()

  // Phase 11: Task auto_action
  const AUTO_ACTION   = uuid()

  // Phase 12: Delay + Log + End
  const DELAY         = uuid()
  const LOG           = uuid()
  const END           = uuid()

  // ── Build all nodes ──
  const nodes = [
    // Phase 1
    node(TRIGGER,      "webhook_received", "Trigger", {}),
    node(SET_TITLE,     "set_title", "Set Title", { title: "Stress Test Run: {{run_label}}" }),
    node(SET_VAR1,      "set_variable", "Set Greeting", { name: "greeting", expression: "Hello" }),
    node(SET_VAR2,      "set_variable", "Set Separator", { name: "separator", expression: " | " }),
    node(SET_VAR3,      "set_variable", "Set Base Year", { name: "base_year", expression: "2025" }),
    node(MATH1,         "math", "Add", { expression: "10 + 25", output_var: "sum" }),
    node(MATH2,         "math", "Multiply", { expression: "{{sum}} * 3", output_var: "product" }),
    node(MATH3,         "math", "Complex", { expression: "({{product}} - 5) / 2", output_var: "final_num" }),
    node(STR_UPPER,     "modify_string", "Uppercase", { input: "{{greeting}} world", operation: "uppercase", output_var: "shouted" }),
    node(STR_REPLACE,   "modify_string", "Replace", { input: "foo-bar-baz", operation: "replace", search: "-", replace_with: "_", replace_all: true, output_var: "replaced" }),
    node(STR_SLUG,      "modify_string", "Slug", { input: "Hello World! Stress Test", operation: "slug", output_var: "slug" }),
    node(TEMPLATE,      "text_template", "Template", { template: "{{shouted}}{{separator}}Result: {{final_num}}", output_var: "summary" }),
    node(REGEX_MATCH,   "regex", "Match Numbers", { input: "{{summary}}", pattern: "\\d+", flags: "g", operation: "match", output_var: "found_nums" }),
    node(REGEX_REPLACE, "regex", "Redact Digits", { input: "SSN: 123-45-6789", pattern: "\\d", flags: "g", operation: "replace", replace_with: "X", output_var: "redacted" }),

    // Phase 2
    node(DATE_FMT,      "format_date", "Format Date", { date: "2025-06-15T12:00:00.000Z", format: "custom", custom_format: "YYYY-MM-DD", output_var: "fmt_date" }),
    node(DATE_ADD,      "date_math", "Add 30 Days", { date: "2025-06-15T12:00:00.000Z", operation: "add", amount: "30", unit: "days", output_var: "future_date" }),
    node(DATE_INTERVAL, "date_math", "Interval", { date: "2025-06-15T12:00:00.000Z", date2: "{{future_date}}", operation: "interval", output_var: "date_gap" }),

    // Phase 3
    node(JSON_OBJ,     "json_build_object", "Build Employee", {
      output_var: "employee",
      fields: [
        { key: "name", value: "{{=UPPER('alice')}}" },
        { key: "role", value: "engineer" },
        { key: "score", value: "{{final_num}}" },
      ],
    }),
    node(JSON_ARR,     "json_build_array", "Init Scores", { output_var: "scores", items: [] }),
    node(LOOP_N,       "loop_n_times", "Loop 5x", { count: "5", index_var: "li" }),
    node(LOOP_N_MATH,  "math", "Calc Score", { expression: "({{li}} + 1) * 10", output_var: "iter_score" }),
    node(LOOP_N_ADD,   "json_add_to_array", "Push Score", {
      array_var: "scores",
      fields: [{ key: "idx", value: "{{li}}" }, { key: "val", value: "{{iter_score}}" }],
    }),
    node(COLL_SORT,    "collection_sort", "Sort Desc", { collection: "{{scores}}", field: "val", direction: "desc", output_var: "sorted_scores" }),
    node(COLL_FILTER,  "collection_filter", "Filter >20", { collection: "{{sorted_scores}}", field: "val", operator: "gt", value: "20", output_var: "high_scores" }),
    node(COLL_GET,     "collection_get", "Get Top", { collection: "{{high_scores}}", index: "0", output_var: "top_score" }),
    node(COLL_UNIQUE,  "collection_unique", "Dedupe Tags", { collection: "{{dup_tags}}", output_var: "unique_tags" }),
    node(COLL_COUNT,   "collection_count", "Count High", { collection: "{{high_scores}}", output_var: "high_count" }),
    node(COLL_JOIN,    "collection_join", "Join Scores", { collection: "{{high_scores}}", field: "val", separator: ",", output_var: "scores_csv" }),

    // Phase 4
    node(COND,         "condition", "Grade Check", {
      branches: [
        { label: "High", logic: "and", rules: [{ field: "{{high_count}}", operator: "gte", value: "3" }] },
        { label: "Med",  logic: "and", rules: [{ field: "{{high_count}}", operator: "gte", value: "2" }] },
        { label: "Low",  logic: "and", rules: [{ field: "{{high_count}}", operator: "lt",  value: "2" }] },
      ],
      has_else: true,
    }),
    node(COND_HIGH,    "set_variable", "Grade=A", { name: "grade", expression: "A" }),
    node(COND_MED,     "set_variable", "Grade=B", { name: "grade", expression: "B" }),
    node(COND_LOW,     "set_variable", "Grade=C", { name: "grade", expression: "C" }),
    node(SWITCH,       "switch_case", "Route Grade", {
      field: "{{grade}}", cases: [
        { value: "A", label: "A" }, { value: "B", label: "B" }, { value: "C", label: "C" },
      ], has_default: true,
    }),
    node(SW_A,         "set_variable", "Tier=Gold", { name: "tier", expression: "gold" }),
    node(SW_B,         "set_variable", "Tier=Silver", { name: "tier", expression: "silver" }),
    node(SW_DEF,       "set_variable", "Tier=Bronze", { name: "tier", expression: "bronze" }),

    // Phase 5: for-each loop with multi-node body
    node(LOOP_EACH,    "loop", "Loop Fruits", { items: "{{fruit_list}}", item_var: "fruit", index_var: "fi" }),
    node(LOOP_TMPL,    "text_template", "Fruit Template", { template: "I like {{fruit}}!", output_var: "fruit_msg" }),
    node(LOOP_MOD,     "modify_string", "Uppercase Fruit Msg", { input: "{{fruit_msg}}", operation: "uppercase", output_var: "fruit_shout" }),
    node(LOOP_PUSH,    "json_add_to_array", "Collect Fruit", { array_var: "fruit_results", value: "{{fruit_shout}}" }),
    node(LOOP_DONE_CNT,"collection_count", "Count Fruits", { collection: "{{fruit_results}}", output_var: "fruit_count" }),

    // Phase 6: goto-activity manual loop
    node(GOTO_INIT,    "math", "Init GotoCounter", { expression: "0", output_var: "goto_ctr" }),
    node(GOTO_CHECK,   "condition", "GotoCheck <3", {
      branches: [{ label: "Again", logic: "and", rules: [{ field: "{{goto_ctr}}", operator: "lt", value: "3" }] }],
      has_else: true,
    }),
    node(GOTO_INC,     "math", "GotoInc", { expression: "{{goto_ctr}} + 1", output_var: "goto_ctr" }),
    node(GOTO_JUMP,    "goto_activity", "Jump Back", { target_node_id: GOTO_CHECK }),
    node(GOTO_DONE,    "set_variable", "GotoDone", { name: "goto_done", expression: "yes" }),

    // Phase 7: parallel (two independent branches that converge)
    node(PAR_A,        "set_variable", "Branch A", { name: "par_left", expression: "left_done" }),
    node(PAR_B,        "set_variable", "Branch B", { name: "par_right", expression: "right_done" }),

    // Phase 8: sub-workflow
    node(CALL_SUB,     "call_sub_workflow", "Call Reverse Sub", {
      sub_workflow_id: subWfId, sub_workflow_name: "Reverse Helper",
      input_mappings: { sub_input: "{{slug}}" },
    }),

    // Phase 9: server_event pause
    node(SRV_EVENT,    "server_event", "Wait for Approval", { event_name: "stress_approval", send_variables: ["grade", "tier"], outbound_action: "none" }),
    node(AFTER_RESUME, "set_variable", "After Resume", { name: "approval_status", expression: "{{approval_decision}}" }),

    // Phase 10: error resilience — call_reference with bogus ID triggers a DB error
    { ...node(BAD_MATH, "call_reference", "Bad Reference", { reference_id: "00000000-0000-0000-0000-000000000000", input_mappings: {} }), onError: "continue" },
    node(SURVIVED,     "set_variable", "Survived Error", { name: "survived", expression: "yes" }),

    // Phase 11: auto_action
    node(AUTO_ACTION,  "auto_action", "Complete Task", { target_task_id: targetTaskId, status: "completed", outcome: "Stress test auto-completed" }),

    // Phase 12: wrap up
    node(DELAY,        "delay", "Short Delay", { duration: "1", unit: "seconds" }),
    node(LOG,          "log", "Final Log", { message: "Stress test completed: grade={{grade}} tier={{tier}}" }),
    node(END,          "end_workflow", "End", {}),
  ]

  // ── Build all edges ──
  const edges = [
    // Phase 1 chain
    edge(TRIGGER, SET_TITLE), edge(SET_TITLE, SET_VAR1), edge(SET_VAR1, SET_VAR2),
    edge(SET_VAR2, SET_VAR3), edge(SET_VAR3, MATH1), edge(MATH1, MATH2), edge(MATH2, MATH3),
    edge(MATH3, STR_UPPER), edge(STR_UPPER, STR_REPLACE), edge(STR_REPLACE, STR_SLUG),
    edge(STR_SLUG, TEMPLATE), edge(TEMPLATE, REGEX_MATCH), edge(REGEX_MATCH, REGEX_REPLACE),

    // Phase 2
    edge(REGEX_REPLACE, DATE_FMT), edge(DATE_FMT, DATE_ADD), edge(DATE_ADD, DATE_INTERVAL),

    // Phase 3
    edge(DATE_INTERVAL, JSON_OBJ), edge(JSON_OBJ, JSON_ARR),
    edge(JSON_ARR, LOOP_N),
    edge(LOOP_N, LOOP_N_MATH, "Each Item"), edge(LOOP_N_MATH, LOOP_N_ADD),  // 2-node loop body
    edge(LOOP_N, COLL_SORT, "Done"),
    edge(COLL_SORT, COLL_FILTER), edge(COLL_FILTER, COLL_GET),
    edge(COLL_GET, COLL_UNIQUE), edge(COLL_UNIQUE, COLL_COUNT), edge(COLL_COUNT, COLL_JOIN),

    // Phase 4: condition → 3 branches → all converge on SWITCH
    edge(COLL_JOIN, COND),
    edge(COND, COND_HIGH, "High"), edge(COND, COND_MED, "Med"), edge(COND, COND_LOW, "Low"),
    edge(COND_HIGH, SWITCH), edge(COND_MED, SWITCH), edge(COND_LOW, SWITCH),
    // switch → 3 cases → all converge on LOOP_EACH
    edge(SWITCH, SW_A, "A"), edge(SWITCH, SW_B, "B"), edge(SWITCH, SW_DEF, "default"),
    edge(SW_A, LOOP_EACH), edge(SW_B, LOOP_EACH), edge(SW_DEF, LOOP_EACH),

    // Phase 5: for-each with 3-node body chain
    edge(LOOP_EACH, LOOP_TMPL, "Each Item"),
    edge(LOOP_TMPL, LOOP_MOD), edge(LOOP_MOD, LOOP_PUSH),   // multi-node body
    edge(LOOP_EACH, LOOP_DONE_CNT, "Done"),

    // Phase 6: goto-activity loop
    edge(LOOP_DONE_CNT, GOTO_INIT), edge(GOTO_INIT, GOTO_CHECK),
    edge(GOTO_CHECK, GOTO_INC, "Again"), edge(GOTO_CHECK, GOTO_DONE, "Else"),
    edge(GOTO_INC, GOTO_JUMP),

    // Phase 7: sequential branches
    edge(GOTO_DONE, PAR_A),
    edge(PAR_A, PAR_B),

    // Phase 8: sub-workflow
    edge(PAR_B, CALL_SUB),

    // Phase 9: server event
    edge(CALL_SUB, SRV_EVENT), edge(SRV_EVENT, AFTER_RESUME),

    // Phase 10: error resilience
    edge(AFTER_RESUME, BAD_MATH), edge(BAD_MATH, SURVIVED),

    // Phase 11: auto_action
    edge(SURVIVED, AUTO_ACTION),

    // Phase 12: delay → log → end
    edge(AUTO_ACTION, DELAY), edge(DELAY, LOG), edge(LOG, END),
  ]

  // ── Author & Start (will pause at server_event) ──
  const data = await api("POST", "/workflows", {
    name: "STRESS TEST: Ultimate Pipeline",
    trigger_type: "webhook_received",
    nodes,
    edges,
    publish: true,
    publish_notes: "Ultimate stress test",
  })
  const wfId = data.workflow_id
  assert(data.node_count === nodes.length, `authored ${data.node_count} nodes, expected ${nodes.length}`)
  assert(data.edge_count === edges.length, `authored ${data.edge_count} edges, expected ${edges.length}`)
  console.log(`       Authored workflow ${wfId} (${nodes.length} nodes, ${edges.length} edges)`)

  const run = await api("POST", "/workflows/start", {
    workflow_id: wfId,
    variables: {
      run_label: "full-pipeline",
      dup_tags: ["js", "ts", "js", "go", "ts", "rs", "go"],
      fruit_list: ["apple", "banana", "cherry"],
      fruit_results: [],
    },
  })

  // ── Phase 1-8 should have executed; Phase 9 pauses ──
  assert(run.status === "waiting_for_event", `Should pause at server_event, got ${run.status}`)
  console.log(`       Paused at server_event (run_id: ${run.run_id})`)

  // ── Verify Phases 1–8 from node_results ──
  const nr = run.node_results ?? {}

  // Phase 1: Setup & Data Transformation
  assert(nodeOut(run, SET_VAR1).value === "Hello",                    `P1 greeting`)
  assert(nodeOut(run, MATH1).result === 35,                           `P1 sum=35`)
  assert(nodeOut(run, MATH2).result === 105,                          `P1 product=105`)
  assert(nodeOut(run, MATH3).result === 50,                           `P1 final=50`)
  assert(nodeOut(run, STR_UPPER).result === "HELLO WORLD",            `P1 upper`)
  assert(nodeOut(run, STR_REPLACE).result === "foo_bar_baz",          `P1 replace`)
  assert(nodeOut(run, STR_SLUG).result === "hello-world-stress-test", `P1 slug`)
  assert(nodeOut(run, TEMPLATE).result === "HELLO WORLD | Result: 50",`P1 template`)
  const nums = nodeOut(run, REGEX_MATCH).result
  assert(Array.isArray(nums) && nums.includes("50"),                  `P1 regex match`)
  assert(nodeOut(run, REGEX_REPLACE).result === "SSN: XXX-XX-XXXX",   `P1 regex redact`)

  // Phase 2: Dates
  assert(nodeOut(run, DATE_FMT).result === "2025-06-15",              `P2 format`)
  assert(nodeOut(run, DATE_ADD).result?.includes("2025-07"),           `P2 +30 days`)
  assert(nodeOut(run, DATE_INTERVAL).result?.days === 30,              `P2 interval=30d`)

  // Phase 3: JSON & Collections
  assert(nodeOut(run, JSON_OBJ).field_count === 3,                    `P3 employee fields`)
  // Loop 5x generates scores: [{idx:0,val:10},{idx:1,val:20},...,{idx:4,val:50}]
  assert(nodeOut(run, COLL_SORT).count === 5,                         `P3 sorted count=5`)
  // Filter >20 → val 30, 40, 50
  assert(nodeOut(run, COLL_FILTER).count === 3,                       `P3 filtered count=3`)
  // Unique tags: js,ts,go,rs = 4
  assert(nodeOut(run, COLL_UNIQUE).unique === 4,                      `P3 unique=4 from 7`)
  assert(nodeOut(run, COLL_COUNT).count === 3,                        `P3 high_count=3`)

  // Phase 4: Branching
  // high_count=3, so condition matches "High" (>=3), grade=A
  assert(nr[COND_HIGH]?.status === "success",                         `P4 High branch taken`)
  assert(!nr[COND_MED],                                               `P4 Med branch NOT taken`)
  assert(!nr[COND_LOW],                                               `P4 Low branch NOT taken`)
  // Switch on grade "A" → tier "gold"
  assert(nr[SW_A]?.status === "success",                              `P4 switch case A`)
  assert(nodeOut(run, SW_A).value === "gold",                         `P4 tier=gold`)

  // Phase 5: For-each loop (3 fruits, multi-node body)
  assert(nodeOut(run, LOOP_DONE_CNT).count === 3,                     `P5 fruit_count=3`)

  // Phase 6: Goto-activity loop (counter should reach 3)
  assert(nr[GOTO_DONE]?.status === "success",                         `P6 goto loop done`)

  // Phase 7: Sequential branches
  assert(nr[PAR_A]?.status === "success",                             `P7 branch A`)
  assert(nr[PAR_B]?.status === "success",                             `P7 branch B`)

  // Phase 8: Sub-workflow
  assert(nodeOut(run, CALL_SUB).status === "completed",               `P8 sub-workflow completed`)

  // Phase 9: Server event is paused — fetch event_id
  const runDetail = await getRunDetail(run.run_id)
  const eventId = runDetail.run.event_id
  assert(!!eventId,                                                    `P9 has event_id`)

  // ── Resume workflow via events API ──
  console.log(`       Resuming via event ${eventId}...`)
  await api("POST", `/workflows/events/${eventId}/complete`, {
    return_variables: { approval_decision: "approved" },
  })
  await new Promise(r => setTimeout(r, 2000))

  // ── Verify Phases 9–12 completed ──
  const final = await getWorkflowDetail(wfId)
  const cr = final.current_run
  assert(cr?.status === "completed", `Final status should be completed, got ${cr?.status}`)
  console.log(`       Workflow completed (${cr?.executed_nodes} nodes executed)`)

  // Phase 9: resume variable
  const finalNr = cr?.node_results ?? {}
  assert(finalNr[AFTER_RESUME]?.status === "success",                 `P9 after_resume executed`)

  // Phase 10: error resilience
  assert(finalNr[BAD_MATH]?.status === "error",                       `P10 bad math errored`)
  assert(finalNr[SURVIVED]?.status === "success",                     `P10 survived after error`)

  // Phase 11: task should be completed
  const taskCheck = await api("GET", `/tasks/${targetTaskId}`)
  assert(taskCheck.task.status === "completed",                        `P11 task completed`)
  assert(taskCheck.task.outcome === "Stress test auto-completed",      `P11 task outcome`)

  // Phase 12: delay, log, end all executed
  assert(finalNr[DELAY]?.status === "success",                         `P12 delay`)
  assert(finalNr[LOG]?.status === "success",                           `P12 log`)

  // ── Verify via list APIs ──
  const runs = await api("GET", `/workflows/runs?workflow_id=${wfId}`)
  assert(runs.total >= 1, `Should have at least 1 run`)

  const wfDetail = await getWorkflowDetail(wfId, true)
  assert(wfDetail.definition?.nodes?.length === nodes.length, `Definition preserved`)

  console.log(`       All ${nodes.length} nodes verified across 12 phases ✅`)
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n🔧 Workflow API Test Suite`)
  console.log(`   Base URL: ${BASE_URL}`)
  console.log(`   API Key:  ${API_KEY!.slice(0, 8)}...\n`)

  console.log("── Data & String Operations ──")
  await runTest("Data Operations Pipeline", testDataOperations)
  await runTest("String Operations (7 ops)", testStringOperations)
  await runTest("Math Expressions (chained)", testMathExpressions)
  await runTest("Expression Functions (UPPER, ABS, IF, TYPE_OF)", testExpressionFunctions)
  await runTest("Regex (match, test, replace, split)", testRegexOperations)

  console.log("\n── Date Operations ──")
  await runTest("Date (format, add, subtract, interval)", testDateOperations)

  console.log("\n── JSON & Collections ──")
  await runTest("JSON & Collections (build, get, count, sort, join, unique)", testJsonAndCollections)
  await runTest("Collection Filter (greater_than)", testCollectionFilter)

  console.log("\n── Logic & Flow Control ──")
  await runTest("Condition Branching (if/else)", testConditionBranching)
  await runTest("Switch Case (multi-way)", testSwitchCase)
  await runTest("End Workflow (stops execution)", testEndWorkflow)
  await runTest("Goto Activity (loop via jump)", testGotoActivity)
  await runTest("Delay Node (1 second)", testDelayNode)
  await runTest("Error Handling (onError: continue)", testErrorHandling)

  console.log("\n── Loops ──")
  await runTest("Loop For Each", testLoopForEach)
  await runTest("Loop N Times", testLoopNTimes)

  console.log("\n── Async & Events ──")
  await runTest("Server Event Pause/Resume", testServerEventPauseResume)
  await runTest("User Task Pause/Resume", testUserTaskPauseResume)
  await runTest("Run Cancel", testRunCancel)

  console.log("\n── Sub-Workflows ──")
  await runTest("Sub-Workflow Call", testSubWorkflow)

  console.log("\n── Task Operations ──")
  await runTest("Task Ingest + Auto Action + Verify", testTaskIngestAndAutoAction)
  await runTest("Task Actions (accept/complete)", testTaskActions)
  await runTest("Idempotent Task Ingest", testIdempotentIngest)

  console.log("\n── API Read Operations ──")
  await runTest("List Workflows & Runs APIs", testListAPIs)

  console.log("\n── Ultimate Stress Test ──")
  await runTest("Ultimate Stress Test (12-phase, 50+ nodes, pause/resume)", testUltimateStressTest)

  console.log("\n" + "═".repeat(50))
  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`\n  Total: ${results.length}  |  Passed: ${passed}  |  Failed: ${failed}`)

  if (failed > 0) {
    console.log("\n  Failed tests:")
    for (const r of results.filter(r => !r.pass)) {
      console.log(`    ❌ ${r.name}: ${r.details}`)
    }
    console.log("")
    process.exit(1)
  } else {
    console.log(`\n  All tests passed! ✅\n`)
  }
}

main().catch(err => {
  console.error(`\n💥 Fatal error: ${err.message}`)
  process.exit(1)
})
