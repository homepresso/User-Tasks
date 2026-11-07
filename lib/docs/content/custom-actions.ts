import type { DocPageDef } from '../types'

/**
 * Custom workflow actions (Extensibility → Workflow actions): the framework
 * guide and the reference for the six official gallery actions. Both are
 * placed in WORKFLOW_PAGES after Error handling.
 */

export interface OfficialActionDoc {
  key: string
  slug: string
  name: string
  summary: string
  capabilities: string
  operations: Array<{ id: string; label: string; does: string; inputs: string; outputs: string }>
}

/**
 * The official gallery actions (gallery/actions/<slug>). Operation ids are
 * checked against each manifest by __tests__/custom-action-docs.test.ts.
 */
export const OFFICIAL_ACTIONS: OfficialActionDoc[] = [
  {
    key: 'ut_math',
    slug: 'math-statistics',
    name: 'Math & statistics',
    summary: 'Safe formulas with variables, decimal-exact rounding, descriptive statistics and percentiles, compound interest, loan schedules and unit conversion.',
    capabilities: 'none',
    operations: [
      { id: 'evaluate', label: 'Evaluate formula', does: 'Evaluates an arithmetic formula (+ - * / % ^, parentheses, abs, round, sqrt, min, max, pow, log, sin… and pi, e) with a real parser, never eval.', inputs: '`expression`, `variables` (object), `decimals`', outputs: '`result`' },
      { id: 'round', label: 'Round', does: 'Rounds to a number of decimals with an explicit mode (half up, half even, floor, ceiling…); 1.005 rounds to 1.01.', inputs: '`value`, `decimals`, `mode`', outputs: '`result`' },
      { id: 'stats', label: 'Statistics', does: 'Count, sum, mean, min, max, median, mode, variance, standard deviation and range of a list of numbers (or a field of a list of rows).', inputs: '`values`, `field`, `variance_type`', outputs: '`count`, `sum`, `mean`, `median`, `stddev`, …' },
      { id: 'percentile', label: 'Percentile', does: 'The p-th percentile with linear interpolation (the same as Excel PERCENTILE.INC).', inputs: '`values`, `field`, `p`', outputs: '`value`, `count`' },
      { id: 'compound_interest', label: 'Compound interest', does: 'Future value with compounding and optional regular contributions, plus a year-by-year schedule.', inputs: '`principal`, `annual_rate`, `years`, `compounds_per_year`, `contribution`', outputs: '`future_value`, `interest_earned`, `schedule`' },
      { id: 'loan_schedule', label: 'Loan schedule', does: 'Monthly amortisation of a fixed-rate loan: payment, interest and principal per period, totals and payoff date; extra payments shorten it.', inputs: '`principal`, `annual_rate`, `term_months`, `start_date`, `extra_payment`', outputs: '`payment`, `total_interest`, `payoff_date`, `schedule`' },
      { id: 'convert_units', label: 'Convert units', does: 'Converts length, mass, volume, temperature, area, speed, data size and time.', inputs: '`value`, `from`, `to`', outputs: '`result`, `category`' },
    ],
  },
  {
    key: 'ut_text',
    slug: 'text-toolkit',
    name: 'Text toolkit',
    summary: 'Slugs, case conversion, templates, truncation, extraction, fuzzy matching, word counts and masking.',
    capabilities: 'none',
    operations: [
      { id: 'slugify', label: 'Slugify', does: 'A URL- and file-name-safe slug: accents removed, & becomes "and", everything else the separator.', inputs: '`text`, `separator`, `lowercase`, `max_length`', outputs: '`slug`' },
      { id: 'change_case', label: 'Change case', does: 'camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Title Case, Sentence case, UPPER, lower.', inputs: '`text`, `case`', outputs: '`result`' },
      { id: 'template', label: 'Fill template', does: 'Replaces {{name}} placeholders (with paths and fallbacks) from an object.', inputs: '`template`, `data`, `missing`', outputs: '`result`, `missing`, `replaced`' },
      { id: 'truncate', label: 'Truncate', does: 'Shortens text to N characters or words with an ellipsis, without cutting words when it can avoid it.', inputs: '`text`, `length`, `by`, `ellipsis`', outputs: '`result`, `truncated`' },
      { id: 'extract_between', label: 'Extract between', does: 'The text between a start and an end marker: the first match or all of them.', inputs: '`text`, `start`, `end`, `all`', outputs: '`value`, `matches`, `count`, `found`' },
      { id: 'similarity', label: 'Similarity / fuzzy match', does: 'Levenshtein distance, similarity 0–1 and Jaro-Winkler, or the best fuzzy match in a list above a threshold.', inputs: '`value`, `compare_to`, `candidates`, `threshold`', outputs: '`similarity`, `best_match`, `matched`, …' },
      { id: 'word_count', label: 'Word count', does: 'Words, characters, sentences, paragraphs and reading time.', inputs: '`text`, `words_per_minute`', outputs: '`words`, `characters`, `reading_minutes`, …' },
      { id: 'mask', label: 'Mask', does: 'Hides part of a sensitive value: keep the last or first N characters, mask all, or mask an email address.', inputs: '`value`, `mode`, `keep`, `mask_char`', outputs: '`masked`' },
    ],
  },
  {
    key: 'ut_dates',
    slug: 'date-business-calendar',
    name: 'Dates & business calendar',
    summary: 'Business days with holidays, SLA due times in working hours, durations and ages, time zone conversion, recurring schedules and fiscal periods.',
    capabilities: 'none (time zones through ctx.intl)',
    operations: [
      { id: 'add_business_days', label: 'Add business days', does: 'Adds or subtracts business days, skipping weekends and holidays.', inputs: '`date`, `days`, `weekend_days`, `holidays`', outputs: '`date`, `weekday`, `calendar_days`' },
      { id: 'sla_due', label: 'SLA due time', does: 'When N working hours after a start run out, in a time zone, skipping holidays (daylight saving handled).', inputs: '`start`, `hours`, `working_hours`, `working_days`, `time_zone`, `holidays`', outputs: '`due`, `due_local`, `due_date`' },
      { id: 'duration', label: 'Duration / age', does: 'Calendar and business days, hours, a readable text and the age in years, months and days between two dates.', inputs: '`from`, `to`, `time_zone`', outputs: '`days`, `business_days`, `hours`, `human`, `age_years`, …' },
      { id: 'convert_timezone', label: 'Convert time zone', does: 'A moment in another time zone: local date-time with its offset, date, time and weekday.', inputs: '`datetime`, `from_zone`, `to_zone`', outputs: '`iso`, `local`, `offset`, …' },
      { id: 'next_occurrence', label: 'Next occurrences', does: 'The next dates of a daily, weekly, monthly (day or nth weekday) or yearly schedule at a time of day in a time zone.', inputs: '`frequency`, `interval`, `days_of_week`, `time`, `time_zone`, `count`', outputs: '`next`, `occurrences`' },
      { id: 'fiscal_period', label: 'Fiscal period', does: 'Fiscal year, quarter and period of a date for a year starting in any month, with start and end dates and a label (FY2027 Q2).', inputs: '`date`, `start_month`, `year_naming`', outputs: '`fiscal_year`, `quarter`, `period`, `label`, …' },
    ],
  },
  {
    key: 'ut_data',
    slug: 'data-transform',
    name: 'Data transform',
    summary: 'Reshape JSON and lists of records without a chain of loops: JSON paths, field mapping, filter, sort, group, pivot and unpivot, dedupe, join and CSV conversion.',
    capabilities: 'none',
    operations: [
      { id: 'select', label: 'Select (JSON path)', does: 'Reads a value by path (a.b[0].c, items[-1], items[*].name for every item).', inputs: '`data`, `path`', outputs: '`value`, `values`, `found`, `count`' },
      { id: 'map', label: 'Map fields', does: 'Picks, renames and nests fields of every item ("customer.name as customer"), with defaults.', inputs: '`items`, `fields`, `keep_other_fields`', outputs: '`items`, `count`' },
      { id: 'filter', label: 'Filter', does: 'Keeps the items that match conditions (eq, gt, contains, in, empty…; all or any), comparing numbers and dates as such.', inputs: '`items`, `conditions`, `combine`', outputs: '`items`, `count`, `removed`' },
      { id: 'sort', label: 'Sort', does: 'Stable sort by one or more keys as numbers, text or dates; empty values last.', inputs: '`items`, `keys`', outputs: '`items`, `count`' },
      { id: 'group', label: 'Group & aggregate', does: 'Groups by fields with count, count_distinct, sum, avg, min, max, first, last or list per group.', inputs: '`items`, `group_by`, `aggregates`', outputs: '`groups`, `count`' },
      { id: 'pivot', label: 'Pivot', does: 'Turns the values of one field into columns, aggregating a value field.', inputs: '`items`, `rows`, `column`, `value`, `aggregate`', outputs: '`items`, `columns`, `count`' },
      { id: 'unpivot', label: 'Unpivot', does: 'Turns columns into rows of name and value, keeping identifier fields.', inputs: '`items`, `keep_fields`, `columns`', outputs: '`items`, `count`' },
      { id: 'dedupe', label: 'Remove duplicates', does: 'Removes duplicates by chosen fields (or whole items), keeping the first or the last.', inputs: '`items`, `fields`, `keep`', outputs: '`items`, `count`, `removed`' },
      { id: 'join', label: 'Join', does: 'Combines two lists on matching keys (inner, left, right or full outer).', inputs: '`left`, `right`, `left_key`, `right_key`, `type`', outputs: '`items`, `count`, `unmatched_left`, `unmatched_right`' },
      { id: 'csv_to_json', label: 'CSV to JSON', does: 'Parses RFC 4180 CSV (quotes, line breaks in quotes) into objects, inferring numbers and booleans.', inputs: '`csv`, `delimiter`, `header`, `infer_types`', outputs: '`items`, `columns`, `count`' },
      { id: 'json_to_csv', label: 'JSON to CSV', does: 'Writes objects as CSV with chosen columns; text a spreadsheet would run as a formula is escaped.', inputs: '`items`, `columns`, `delimiter`, `escape_formulas`', outputs: '`csv`, `columns`, `count`' },
    ],
  },
  {
    key: 'ut_validate',
    slug: 'validation-formatting',
    name: 'Validation & formatting',
    summary: 'Check IBANs, BICs, card numbers, emails, phone numbers, postcodes and national IDs, and format or parse numbers, currencies and phone numbers by locale.',
    capabilities: 'none (formatting through ctx.intl)',
    operations: [
      { id: 'validate', label: 'Validate', does: 'Checks one value — IBAN, BIC, card (Luhn), email, phone, postcode or national ID — with the normalised value, the reason it fails and details (card issuer, IBAN country…).', inputs: '`type`, `value`, `country`, `id_type`', outputs: '`valid`, `normalized`, `reason`, `details`' },
      { id: 'validate_many', label: 'Validate many', does: 'Checks a list of { type, value } entries at once, one result each plus whether all are valid.', inputs: '`items`, `country`', outputs: '`results`, `all_valid`, `valid_count`, `invalid_count`' },
      { id: 'format_number', label: 'Format number', does: 'Formats a number for a locale: grouping, decimals, percent, currency or compact notation.', inputs: '`value`, `locale`, `style`, `notation`', outputs: '`formatted`' },
      { id: 'format_currency', label: 'Format currency', does: 'Formats money for a locale and currency with its usual decimals, as symbol, code or name.', inputs: '`value`, `currency`, `locale`, `display`', outputs: '`formatted`, `currency`' },
      { id: 'parse_number', label: 'Parse number', does: 'Reads a number written the way a locale writes it ("1.234,56" in de-DE), with currency, percent and brackets.', inputs: '`text`, `locale`', outputs: '`value`, `valid`, `decimal_separator`, `group_separator`' },
      { id: 'format_phone', label: 'Format phone', does: 'Normalises a phone number to E.164, or formats it in international or national style.', inputs: '`value`, `country`, `format`', outputs: '`formatted`, `e164`, `valid`, `reason`' },
    ],
  },
  {
    key: 'ut_crypto',
    slug: 'crypto-ids',
    name: 'Crypto & IDs',
    summary: 'UUIDs and ULIDs, hashes and HMACs, encodings, random codes, one-time codes and signed tokens.',
    capabilities: 'secrets `hmac_key` (for HMAC) and `token_secret` (for tokens)',
    operations: [
      { id: 'uuid', label: 'UUID', does: 'Random UUID v4 or time-ordered v7 (strictly increasing within a run).', inputs: '`version`, `count`, `uppercase`', outputs: '`uuid`, `uuids`' },
      { id: 'ulid', label: 'ULID', does: 'Sortable, time-ordered ULIDs (Crockford base32).', inputs: '`count`', outputs: '`ulid`, `ulids`' },
      { id: 'hash', label: 'Hash', does: 'SHA-256, SHA-512, SHA-384 or SHA-1 of text, in hex, base64 or base64url.', inputs: '`text`, `algorithm`, `encoding`', outputs: '`hash`, `algorithm`' },
      { id: 'hmac', label: 'HMAC signature', does: 'HMAC of a message with the `hmac_key` secret (computed on the host), optionally compared in constant time with a received signature.', inputs: '`message`, `algorithm`, `encoding`, `expected`', outputs: '`signature`, `matches`' },
      { id: 'encode', label: 'Encode', does: 'Text to base64, base64url, hex or URL percent-encoding.', inputs: '`text`, `format`', outputs: '`result`' },
      { id: 'decode', label: 'Decode', does: 'base64, base64url, hex or URL-encoded text back to text.', inputs: '`text`, `format`, `plus_as_space`', outputs: '`result`' },
      { id: 'random_code', label: 'Random code', does: 'Unbiased random codes from an alphabet (no look-alikes, digits, letters, hex or custom), optionally grouped.', inputs: '`length`, `alphabet`, `custom_alphabet`, `count`, `group_size`, `separator`', outputs: '`code`, `codes`' },
      { id: 'otp', label: 'One-time code', does: 'A numeric one-time code with its expiry time and SHA-256 hash.', inputs: '`digits`, `expires_minutes`', outputs: '`code`, `expires_at`, `code_hash`' },
      { id: 'sign_token', label: 'Sign token (JWT)', does: 'An HS256 JWT with your claims, iat, exp, optional iss / aud / sub and a jti, signed with the `token_secret` secret.', inputs: '`claims`, `expires_minutes`, `issuer`, `audience`, `subject`', outputs: '`token`, `expires_at`, `claims`' },
      { id: 'verify_token', label: 'Verify token (JWT)', does: 'Checks an HS256 JWT\'s signature (constant time), exp / nbf with leeway and optional issuer / audience; invalid tokens return a reason.', inputs: '`token`, `issuer`, `audience`, `leeway_seconds`', outputs: '`valid`, `reason`, `claims`, `expires_at`' },
    ],
  },
]

function cell(text: string): string {
  return text.replace(/\|/g, '\\|')
}

function officialReference(): string {
  return OFFICIAL_ACTIONS.map((action) => `### ${action.name}

\`${action.key}\` — ${action.summary} [Gallery page](/gallery/actions/${action.slug}).

**Capabilities:** ${action.capabilities}.

| Function | What it does | Key inputs | Outputs |
|---|---|---|---|
${action.operations.map((op) => `| **${cell(op.label)}** (\`${op.id}\`) | ${cell(op.does)} | ${cell(op.inputs)} | ${cell(op.outputs)} |`).join('\n')}`).join('\n\n')
}

export const CUSTOM_ACTIONS_PAGE: DocPageDef = {
  slug: 'workflows/custom-actions',
  title: 'Custom workflow actions',
  description: 'Build your own typed workflow steps in JavaScript or TypeScript: the manifest and ctx contract, the QuickJS WebAssembly sandbox and capability model, the starter kit, testing, packaging, signing, versions, API, MCP and CLI.',
  body: `
A **custom workflow action** is your own workflow step: a JavaScript or TypeScript module with a typed \`manifest.json\`. Upload it once in **Extensibility → Workflow actions** and it appears in the workflow designer's palette under **Custom actions**, with a **function picker** (an action can offer several operations), an **input panel generated from the manifest** and **typed outputs in the data picker**. It runs in a **sandbox** — QuickJS compiled to WebAssembly, a fresh instance for every run — and can reach the network, data tables, files or secrets only through capabilities it declares and an administrator grants.

> [!TIP]
> Start from the kit: [action-starter.zip](/downloads/action-starter.zip) has a two-operation *Acme tax calculator* in TypeScript and in plain JavaScript, a local test harness that runs in the real sandbox, and build and package scripts. The [tutorial](#tutorial-from-starter-kit-to-workflow) below walks through it.

> [!TIP]
> Need maths, text, dates, data reshaping, validation or IDs? Install one of the six [official workflow actions](/docs/workflows/official-actions) from the [gallery](/gallery/actions) instead of writing it.

## How it works

1. You upload a **package**: \`manifest.json\` plus one self-contained ES module. UserTasks validates the manifest, loads the module once in the sandbox to check every declared operation has a function, and stores an **immutable version** with its SHA-256 (and signature, if any).
2. An administrator reviews the action's **capabilities** and grants what it needs: HTTP hosts, data tables, secret values.
3. A designer drops the action on the canvas, picks a function, maps inputs (values or expressions such as \`{{form.amount}}\`) and uses the outputs downstream.
4. At run time the engine reads the code **from the workspace library** (never from the workflow definition), coerces the inputs to their declared types, runs the operation in a fresh sandbox with the manifest's limits, checks the outputs against their declared types (mismatches are logged as warnings) and stores them as step variables.

Outputs are available as \`{{<prefix>_<output>}}\` (the node's output prefix, editable on the node) and as \`{{<output>}}\`; the data picker lists them with their types, including the fields of \`object\` outputs and of array items.

## The contract

The source of truth is \`lib/custom-actions/contract.ts\`, also exported by the \`@usertasks/action\` package.

### manifest.json

\`\`\`json title="manifest.json (excerpt)"
{
  "manifest_version": 1,
  "key": "acme_tax",
  "name": "Acme tax calculator",
  "version": "1.0.0",
  "icon": "calculator",
  "category": "Finance",
  "operations": [
    {
      "id": "calculate",
      "label": "Calculate tax",
      "inputs": [
        { "name": "amount", "type": "number", "required": true, "example": 100 },
        { "name": "rate_percent", "type": "number", "required": true, "example": 15 },
        { "name": "rounding", "type": "select", "default": "half_up",
          "options": [{ "value": "half_up" }, { "value": "half_even" }, { "value": "none" }] }
      ],
      "outputs": [
        { "name": "net", "type": "number" },
        { "name": "tax", "type": "number" },
        { "name": "gross", "type": "number" }
      ],
      "sample": { "amount": 100, "rate_percent": 15 }
    }
  ],
  "capabilities": {},
  "limits": { "timeout_ms": 5000, "memory_mb": 16 }
}
\`\`\`

| Field | Required | Meaning |
|---|---|---|
| \`manifest_version\` | yes | \`1\` |
| \`key\` | yes | The action's identity in a workspace: 2–63 lowercase letters, digits and underscores, starting with a letter (\`acme_tax\`). \`ut_\` is reserved for official actions. Uploading the same key again adds a version. |
| \`name\` | yes | Palette label. |
| \`version\` | yes | Semver. Every upload is a new, immutable version. |
| \`operations\` | yes | One or more functions (up to 40): \`id\` (lowercase, underscores), \`label\`, \`description\`, \`inputs\`, \`outputs\` (at least one) and \`sample\` inputs (used by Test, the gallery and the starter kit's harness). |
| \`capabilities\` | | What the code may ask the host for: \`http\`, \`data\`, \`files\`, \`credentials\` (named secrets, below). Nothing by default. |
| \`limits\` | | \`{ timeout_ms, memory_mb }\` defaults for every run (clamped to the [limits](#limits)). |
| \`description\`, \`icon\`, \`color\`, \`category\` | | Library and palette: a Lucide icon name (\`calculator\`), \`#RRGGBB\`, a palette group. |
| \`entry\` | | The module file in a zip. Default \`dist/action.js\`, else the only \`.js\` / \`.mjs\` file. |
| \`summary\`, \`purpose\`, \`recommended_for\`, \`setup_notes\` | | Guidance shown to designers and in the library. |
| \`author\`, \`license\`, \`homepage\`, \`tags\` | | Shown in the library. |

### Field types

Each input and output is \`{ name, label, type, description, required, default, example, options, items, fields, placeholder }\`:

| Type | Designer input | The code gets / returns |
|---|---|---|
| \`string\` | single-line text (with \`placeholder\`) | string |
| \`text\` | multi-line text | string |
| \`number\` / \`integer\` | number | number (integers are checked) |
| \`boolean\` | checkbox | \`true\` / \`false\` |
| \`date\` / \`datetime\` | date / date-time | ISO 8601 string |
| \`select\` | dropdown of \`options\` | the option's \`value\` |
| \`object\` | expression or JSON (with \`fields\` for the data picker) | object |
| \`array\` | expression or JSON (\`items: { type, fields }\`) | array |
| \`json\` | expression or JSON | any JSON value |
| \`file\` | a file from an earlier step or form | a file reference to read with \`ctx.files.read\` |

Inputs are coerced before the code runs (\`"42"\` becomes \`42\` for a \`number\`); a required input that is missing, or a value that can't be coerced, fails the step with code \`invalid\` without running the code. An empty input gets its \`default\`.

Input and output names may not look like credentials (\`token\`, \`password\`, \`*_secret\`, \`api_key\`, \`*_token\` …): exports, packages and config as code blank values under such keys, so a workflow's input mappings would be lost. Use names like \`jwt\` or \`signature\`, and declare real secrets under \`capabilities.credentials\`.

### The module

ONE self-contained ES module — bundle dependencies, no \`import\` statements or dynamic \`import()\` (the sandbox has no module loader). Its default export maps operation ids to functions:

\`\`\`ts title="src/action.ts"
import { defineAction } from '@usertasks/action'

export default defineAction({
  operations: {
    calculate(inputs: { amount: number; rate_percent: number }, ctx) {
      if (inputs.rate_percent < 0 || inputs.rate_percent > 100) ctx.fail('rate_percent must be between 0 and 100')
      const tax = Math.round(inputs.amount * inputs.rate_percent) / 100
      ctx.log.info('Calculated tax', { rate: inputs.rate_percent })
      return { net: inputs.amount, tax, gross: inputs.amount + tax }
    },
  },
})
\`\`\`

A plain object (\`export default { operations: { … } }\`) works the same; a default-exported function serves a single-operation action. Functions may be \`async\`. Return an object with the declared outputs; throw an \`Error\` (or call \`ctx.fail\`) to fail the step.

### ctx

| Member | Capability | What it does |
|---|---|---|
| \`ctx.operation\`, \`ctx.run\` | — | The operation id; \`{ id, workflow_id, step_id, test }\` (ids only, \`test\` is true for Save & Test and Test runs) |
| \`ctx.log.info / warn / error(message, metadata?)\` | — | Lines in the run log, prefixed with the step's name (\`console.log\` is mapped to \`info\`) |
| \`ctx.fail(message, { retryable })\` | — | Fails the step; \`retryable: true\` lets the node's retry policy try again |
| \`ctx.http.fetch(url, { method, headers, body, json, timeout_ms })\` | \`http\` | → \`{ status, ok, headers, text, json }\`. A header value can be \`secret://name\` or \`Bearer secret://name\`: the host substitutes the secret |
| \`ctx.data.query(table, { filters, search, sort, limit, offset })\`, \`ctx.data.get(table, rowId)\` | \`data.read\` | Rows of a granted data table (by id or name) → \`{ rows, total, truncated }\` / a row |
| \`ctx.data.insert(table, values)\`, \`ctx.data.update(table, rowId, values)\` | \`data.write\` | Write rows of a table granted with write access |
| \`ctx.files.read(file, { as: 'text' \\| 'base64' })\` | \`files\` | The bytes of a file passed to the action as a \`file\` input → \`{ name, mime_type, size, text \\| base64 }\` |
| \`ctx.secrets.get('secret://name')\` | \`secrets\` | A declared secret's value |
| \`ctx.crypto.randomUUID / randomBytes / randomInt / digest / hmac / timingSafeEqual / encode\` | — | Crypto primitives on the host. \`hmac\` takes a \`secret://name\` key so the key never enters the sandbox |
| \`ctx.intl.formatNumber / formatDate / zonedParts / zonedToUtc / timeZones / collate\` | — | \`Intl\` on the host (QuickJS has none): locale formatting and time zones |

## Security model

Action code is tenant-supplied code running on your servers, so the defaults assume it is untrusted.

### Isolation: QuickJS in WebAssembly

Each run gets a **fresh QuickJS interpreter compiled to WebAssembly** (\`quickjs-emscripten\`), created for the run and thrown away after it:

- **A separate JavaScript engine.** The guest shares no objects, prototypes or globals with Node: there is no \`process\`, \`require\`, \`Buffer\`, \`fetch\`, timers or file system to reach. The classic escape \`(0).constructor.constructor('return process')()\` reaches the guest's own \`Function\`, which only sees the guest's globals.
- **Bounds-checked memory.** WebAssembly linear memory can't read or write host memory, and no state survives between runs, actions or workspaces.
- **Hard limits.** The heap is capped per run, the stack is small (256 KB), CPU is bounded by an interrupt handler the interpreter polls (\`while (true) {}\` is stopped at the deadline), and a wall-clock limit covers host calls too.
- **One narrow door.** The only way out is \`ctx\`: a few host functions that take and return JSON text. Every call is checked on the host against the manifest and the administrator's grants; the guest can't forge a grant.

Why not the alternatives:

| Option | Why not |
|---|---|
| \`node:vm\` / \`new Function\` | Not a security boundary: the code shares the Node process and its prototypes; well-known escapes reach \`process\`. Node's own documentation says not to use \`vm\` for untrusted code. |
| \`isolated-vm\` | A strong V8 isolate, but a native addon: it breaks on serverless and some container builds and must match the Node ABI. |
| A container or microVM per run | Strong, but seconds of start-up and an orchestrator to run; overkill for steps that take milliseconds. |
| QuickJS in WebAssembly (chosen) | A separate engine in bounds-checked memory, a single-file build that runs wherever Node 20 runs, ~3 ms to start, deterministic limits. Slower than V8 for heavy CPU work — keep actions to data shaping and API calls. |

### Capabilities and grants

An action can do nothing outside pure computation unless its manifest **declares** a capability **and** an administrator **grants** it on the installed action:

| Capability | Manifest | Administrator grants | Enforced by |
|---|---|---|---|
| \`http\` | \`{ "hosts": ["api.example.com", "*.example.org"] }\` | **Approved hosts**: a subset of the declared hosts | Every request is checked against both lists, then goes through the **egress guard** (below). |
| \`data\` | \`{ "read": true, "write": true }\` | **Data table grants**: tables with read or write access | Queries and writes go through the data table service, limited to the granted tables. |
| \`files\` | \`true\` | — | Only files passed as \`file\` inputs of the current step, read from the run's own workspace storage. |
| \`credentials\` | \`[{ "name": "api_key", "label": "API key" }]\` | **Secret values** for the declared names | Only declared names, read on request; never logged or returned by the API. |

Uploading a new version keeps the approvals that still apply: hosts the new version no longer declares are dropped, and write grants become read grants if the new version only declares \`read\`. Package imports never carry approvals or secrets — an administrator reviews them in the target workspace.

### Secrets

Secret values are set on the action's **Access** tab (**Manage** in Extensibility → Workflow actions), with \`PUT /api/v1/workflow-activities/{id}/secrets\` (\`{ "values": { "api_key": "…" } }\`, \`null\` clears one), the MCP tool \`workflow_activities_secrets_set\` or \`usertasks activities secrets\`. They are encrypted by the app (AES-256-GCM, \`ENCRYPTION_KEY\`) into a table that only the server's service role can read — no client, API or export returns them; the API only says which are **set**. Prefer passing a secret by reference (\`Bearer secret://api_key\` in a header, \`secret://hmac_key\` to \`ctx.crypto.hmac\`) so the value never enters the sandbox.

### The egress guard

\`ctx.http.fetch\` uses the same guard as integrations: \`http\` / \`https\` only, no private, loopback, link-local or cloud metadata addresses (checked after DNS resolution), every redirect re-checked against the approved hosts, a timeout (30 s by default, never beyond the run's remaining time) and a 5 MB response limit. On self-hosted instances \`ALLOW_PRIVATE_EGRESS=true\` permits private ranges for actions that call internal services; cloud metadata addresses stay blocked.

### Limits

| Limit | Value |
|---|---|
| Run time (wall clock, host calls included) | 10 s default, 100 ms – 60 s via \`limits.timeout_ms\` or the node's **Timeout**; \`CUSTOM_ACTION_MAX_TIMEOUT_MS\` lowers the ceiling |
| Heap | 32 MB default, 8 – 128 MB via \`limits.memory_mb\` |
| Stack | 256 KB (about 1,300 frames of plain recursion) |
| Host calls (\`http\`, \`data\`, \`files\`, \`secrets\`, \`hmac\`) | 200 per run |
| Inputs, outputs | 5 MB of JSON each |
| HTTP response | 5 MB |
| File read | 10 MB |
| Data query | 500 rows |
| Logs | 200 entries per run, 2,000 characters each |
| Module | 1 MB |
| Manifest | 128 KB |
| Zip package | 5 MB |
| Operations, fields per operation | 40, 40 |

### Kill switches

- **Per action:** **Disable** on the action (or \`PATCH … { "enabled": false }\`). It disappears from the palette and every step that uses it fails fast with code \`disabled\` — in all workflows at once, because the code is always read from the library.
- **Per server:** set \`CUSTOM_ACTIONS_DISABLED=true\` and no custom action or legacy script activity runs on that server (steps fail with \`disabled\`).

### What the sandbox doesn't have

| Missing | Use instead |
|---|---|
| \`fetch\`, \`XMLHttpRequest\` | \`ctx.http.fetch\` (declare \`http\`) |
| \`setTimeout\`, \`setInterval\` | Nothing to wait for: do the work, or let the workflow wait with a **Delay** step |
| \`Intl\` (\`NumberFormat\`, \`DateTimeFormat\`, time zones), \`toLocaleString\` with locales | \`ctx.intl\` |
| \`crypto\`, \`crypto.subtle\` | \`ctx.crypto\` |
| \`process.env\` | Declared \`credentials\` (\`ctx.secrets.get('secret://name')\`) |
| \`require\`, \`import\` at run time, Node built-ins | Bundle pure-JavaScript dependencies into the module |
| \`Buffer\`, \`TextEncoder\` | \`ctx.crypto.encode\` for hex / base64 |

## Tutorial: from starter kit to workflow

You need Node.js 20 or later.

1. **Download the kit.** Get [action-starter.zip](/downloads/action-starter.zip), unzip it and open \`action-starter/typescript\` (or \`javascript\`).
2. **Install.**
   \`\`\`bash
   cd action-starter/typescript
   npm install
   \`\`\`
3. **Edit.** Change \`key\`, \`name\` and the operations in \`manifest.json\`, and the functions in \`src/action.ts\` (one per operation id).
4. **Build.** \`npm run build\` typechecks and bundles one ES module into \`dist/action.js\` with a banner naming the action and version. It fails on leftover imports, a missing default export, an operation the module never mentions, a module over 1 MB, or different versions in \`package.json\` and \`manifest.json\`.
5. **Test locally.** \`npm test\` runs \`dist/action.js\` in the **same QuickJS sandbox the app uses**, with the manifest's limits: every operation's \`sample\` inputs (each declared output must come back with its type), then the cases in \`test/cases.json\`:
   \`\`\`json title="test/cases.json (excerpt)"
   { "name": "tax-inclusive price", "operation": "calculate",
     "inputs": { "amount": 115, "rate_percent": 15, "prices_include_tax": true },
     "expect": { "net": 100, "tax": 15, "gross": 115 } }
   \`\`\`
   \`expect_error\` takes an [error code](#troubleshooting); \`mocks\` answers HTTP, data, files and secrets. \`npm test -- --verbose\` prints outputs and logs.
6. **Package.** \`npm run package\` builds, tests and writes \`release/acme_tax-1.0.0.zip\` (\`manifest.json\`, \`dist/action.js\`, \`README.md\`). Add \`-- --sign key.pem\` to include \`signature.json\` ([signing](#packaging-versions-and-signing)).
7. **Upload.** **Extensibility → Workflow actions → Upload**, choose the zip. The summary shows the key, version, operations, capabilities, SHA-256 and signature.
8. **Approve.** If the action declares capabilities, an administrator opens **Manage → Access** on the action to approve hosts, grant tables and set secret values. Until then, calls are refused with code \`capability\`.
9. **Test in the library.** **Manage → Test** runs one operation with its sample inputs (or yours) and shows the outputs, logs, duration, host calls and memory.
10. **Use it in a workflow.** In the designer, open the palette's **Custom actions** group and drop **Acme tax calculator** on the canvas. Pick the function, map the inputs (\`{{form.amount}}\`, a literal \`15\`…), and use the outputs from the data picker downstream (\`{{tax_gross}}\`). The node also has **Timeout**, **Retries** (default 2, retryable failures only, with exponential backoff), an optional pinned **version**, and **continue on error** edges like other steps.
11. **Save & Test, then read the run.** The run log has your \`ctx.log\` lines prefixed with the step name, any output type warnings, and a summary line: \`ran acme_tax@1.0.0 calculate in 3 ms (0 host calls)\` with the version's SHA-256, duration, host calls, memory and attempts as metadata. The run trace shows the step's inputs and outputs.

## Testing with runAction

\`@usertasks/action/testing\` exports \`runAction\`, the runner behind \`npm test\` — use it from any test framework:

\`\`\`ts title="action.test.ts"
import { readFileSync } from 'node:fs'
import { runAction } from '@usertasks/action/testing'

const module = readFileSync('dist/action.js', 'utf8')
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))

const result = await runAction({
  module, manifest, operation: 'lookup', inputs: { customer_id: '42' },
  mocks: {
    http: async (url, init) => ({ status: 200, json: { name: 'Ada' } }),
    secrets: { api_key: 'test-key' },
    data: { customers: [{ name: 'Ada', tier: 'gold' }] },
    files: { 'invoice.txt': 'text content' },
  },
})
// { ok, outputs, logs, error?: { code, message, retryable }, stats: { duration_ms, host_calls, memory_bytes } }
\`\`\`

Capabilities are enforced as in the app — a request to a host not in the manifest, an undeclared secret, or a write without \`data.write\` fails with \`capability\` — so the mocks only stand in for the administrator's grants and the outside world. \`runAction\` never throws; it needs the peer dependencies \`quickjs-emscripten-core\` and \`@jitl/quickjs-singlefile-cjs-release-sync\` (0.32.0). The package isn't on npm yet: the starter kit carries its sources in \`vendor/usertasks-action/\`.

## Packaging, versions and signing

Upload either a **zip** — \`manifest.json\` at the root (or in one top-level folder) and the module at \`entry\` (default \`dist/action.js\`); \`README\`, \`LICENSE\` and sources are ignored — or the **module** text with its **manifest** JSON.

\`\`\`text
acme_tax-1.0.0.zip
├── manifest.json
├── dist/action.js
├── README.md
└── signature.json   (optional)
\`\`\`

- **Immutable versions.** Each upload (listed under **Manage → Versions**) of a key is a new version with its SHA-256, size, origin and uploader. Re-uploading the same version with the same bytes is a no-op; with different bytes it is refused — bump the version. Uploading an older version adds it to the history without changing the current one.
- **Upgrades.** Workflow nodes use the current version unless they **pin** one (\`custom_activity_version\`). Bump the patch for fixes, the minor for new operations or optional inputs, the major when inputs or outputs change incompatibly.
- **Signatures.** \`signature.json\` is \`{ "alg": "ed25519", "public_key": "<base64 SPKI or PEM>", "signature": "<base64>" }\`, signing the module's SHA-256 (as hex text). The version records the key's fingerprint and **Verified** or **Unverified**; compare the fingerprint with the publisher's. Official gallery actions show **Signed package** with the gallery key.
- **Usages and deletion.** **Manage → Used by** lists the workflows (drafts and published) that use the action; **Delete** is refused while any does.

## API, MCP and CLI

| Task | REST | MCP | CLI |
|---|---|---|---|
| List actions | \`GET /api/v1/workflow-activities\` | \`workflow_activities_list\` | \`usertasks activities list\` |
| Show one (manifest, versions, grants, which secrets are set) | \`GET /api/v1/workflow-activities/{id}\` | \`workflow_activities_get\` | \`usertasks activities get <id>\` |
| Upload a packaged action or a new version | \`POST /api/v1/workflow-activities/upload\` (\`package_base64\`, or \`module\` + \`manifest\` + optional \`signature\`; multipart \`file=@action.zip\` also works) | \`workflow_activities_upload\` | \`usertasks activities upload -f body.json\` |
| Create an inline (script) activity | \`POST /api/v1/workflow-activities\` | \`workflow_activities_create\` | \`usertasks activities create\` |
| Enable / disable, approve hosts, grant tables | \`PATCH /api/v1/workflow-activities/{id}\` (\`enabled\`, \`approved_hosts\`, \`data_grants\`) | \`workflow_activities_update\` | \`usertasks activities update <id>\` |
| Set or clear secrets | \`PUT /api/v1/workflow-activities/{id}/secrets\` | \`workflow_activities_secrets_set\` | \`usertasks activities secrets <id>\` |
| Test an operation | \`POST /api/v1/workflow-activities/{id}/test\` (\`operation\`, \`inputs\`, \`version\`) | \`workflow_activities_test\` | \`usertasks activities test <id>\` |
| One version (manifest, checksum, signature) | \`GET /api/v1/workflow-activities/{id}/versions/{version}\` | \`workflow_activities_version_get\` | \`usertasks activities version <id> <version>\` |
| Where it is used | \`GET /api/v1/workflow-activities/{id}/usages\` | \`workflow_activities_usages\` | \`usertasks activities usages <id>\` |
| Delete (when unused) | \`DELETE /api/v1/workflow-activities/{id}\` | \`workflow_activities_delete\` | \`usertasks activities delete <id>\` |
| Export, import | \`GET /api/v1/workflow-activities/{id}/export\`, \`POST /api/v1/workflow-activities/import\` | \`workflow_activities_export\`, \`workflow_activities_import\` | \`usertasks activities export\`, \`import\` |

The upload responds with \`{ workflow_activity, version, outcome: "created" | "version" | "unchanged", warnings }\`. The [API reference](/docs/api/endpoints), [MCP tools](/docs/mcp) and [CLI commands](/docs/cli/commands) list the exact parameters.

Permissions: \`extensibility.view\` (library, versions, usages), \`extensibility.create\` (upload or import a new action), \`extensibility.edit\` (new versions, enable / disable, approvals, secrets, Test), \`extensibility.delete\` (delete unused actions).

## Config as code and packages

Actions are the asset type \`workflow_activity\` in exports, [packages](/docs/packages) and [config as code](/docs/config-as-code) (folder \`workflow-activities/\`). The export carries the manifest, the module and its checksum — no ids, grants or secret values. Exporting a workflow with its dependencies brings the actions it uses. On import, an action is matched by \`key\`: the same version with the same checksum is reused, a different checksum under the same version is refused. Approvals and secrets are set again by an administrator in the target workspace.

## Migrating legacy activities

Activities created before manifest v1 — a script body with \`run(inputs, context, helpers)\` — keep working, but they **now run in the same sandbox** (they used to run in the app process behind \`ENABLE_CUSTOM_ACTIVITY_CODE\`, which is now ignored). Their \`helpers\` (\`resolveExpression\`, \`getVariable\`, \`setVariable\`, \`log\`, \`uuid\`, \`now\`) still work. What changes:

- Code that used Node — \`require(...)\`, \`fetch\`, \`process.env\`, \`Buffer\`, timers — now fails. Move it to a packaged action: declare \`http\` hosts for API calls and \`credentials\` for keys, and use \`ctx.http.fetch\` and \`secret://\` references.
- To convert one: create a \`manifest.json\` whose \`key\` is the **legacy activity's key**, with one operation whose inputs and outputs match the old ones, wrap the old function body in that operation (\`inputs\` is the same; return the outputs object), and upload it with a higher \`version\`. It becomes the next version of the same activity, so workflows that use it keep their reference; open each to re-map inputs if you renamed any.

## Troubleshooting

A failed step's error ends with its code in brackets (\`Acme tax calculator: rate_percent must be between 0 and 100 [action]\`); Test and the API return it as \`error.code\`.

| Code | Meaning | What to do |
|---|---|---|
| \`timeout\` | The run passed its time limit (CPU or wall clock, host calls included). Retryable. | Look for unbounded loops; raise \`limits.timeout_ms\` or the node's **Timeout** (60 s at most); page large HTTP or data reads. |
| \`memory\` | The heap or stack limit was hit (deep recursion counts). | Process less at once, avoid building huge strings or arrays, raise \`limits.memory_mb\` (128 MB at most), make recursion iterative. |
| \`capability\` | The code asked for something not declared or not granted: an unlisted or unapproved host, an ungranted table, an undeclared secret, a file that wasn't an input, more than 200 host calls. | Declare it in the manifest (new version) and ask an administrator to approve or grant it. |
| \`action\` | The code threw or called \`ctx.fail\` (retryable only with \`{ retryable: true }\`). | Read the message and your \`ctx.log\` lines in the run log; reproduce with \`npm test\`. |
| \`invalid\` | Bad module (imports, no default export, no function for the operation), unknown operation, or inputs that are missing or can't be coerced. | Rebuild with the kit (one module, no imports); check the node's function and input mappings. |
| \`host\` | A host service failed: an HTTP network error, a row not found, an unreadable file, a secret with no value. Network failures are retryable. | Check the URL, the table and row, and that every declared secret is set. |
| \`disabled\` | The action is disabled, archived, or \`CUSTOM_ACTIONS_DISABLED=true\` on the server. | Enable it in **Extensibility → Workflow actions**, or ask your operator. |

Other symptoms:

| Symptom | Likely cause |
|---|---|
| The upload is refused | Invalid manifest (key format, non-semver version, an operation without outputs, an unknown capability), imports left in the module, an operation without a function, over 1 MB, or that version already exists with different contents. |
| The action isn't in the palette | It is disabled or archived, or you lack \`extensibility.view\`. |
| An output is missing in the data picker | It isn't declared in the operation's \`outputs\` (returned but undeclared values are still stored, but not listed). |
| Warnings such as \`output "tax" should be number but is string\` or \`returned undeclared output "total" (kept)\` | An output doesn't match its declaration; the value is kept as returned. Fix the code or the manifest. |
| \`toLocaleString\`, \`Intl\` or time zones misbehave | QuickJS has no \`Intl\`: use \`ctx.intl\`. |

## Related

- [Official workflow actions](/docs/workflows/official-actions) — six ready-made actions from the gallery
- [Error handling](/docs/workflows/error-handling) — retries and continue-on-error edges
- [Custom form controls](/docs/tasks/custom-form-controls) — the same idea for forms
- [Inline workflow steps](/docs/custom-steps) — script activities without a package
- [Packages](/docs/packages) — moving actions with workflows
`,
}

export const OFFICIAL_ACTIONS_PAGE: DocPageDef = {
  slug: 'workflows/official-actions',
  title: 'Official workflow actions',
  description: 'The six official custom workflow actions in the gallery — Math & statistics, Text toolkit, Dates & business calendar, Data transform, Validation & formatting, Crypto & IDs: every function with its inputs and outputs.',
  get body() {
    return `
The [gallery](/gallery/actions) has six **official workflow actions**: [custom workflow actions](/docs/workflows/custom-actions) built, tested and signed by the UserTasks team. Each offers several functions; pick one on the node and the input panel and outputs follow it.

They run in the same QuickJS WebAssembly sandbox as your own actions. Five need **no capabilities at all** — no network, data, files or secrets — so they are safe to enable everywhere; *Crypto & IDs* declares two secrets, used only by its HMAC and token functions and never visible to the code.

## Install

- **In the app:** **Extensibility → Workflow actions → Browse gallery**, or **Packages → Browse gallery** on the **Workflow actions** tab. **Install** verifies the package (checksum, file hashes, signature) and adds the action enabled; its versions show **Signed package** with the gallery key's fingerprint.
- **From the website:** open the action's page under [/gallery/actions](/gallery/actions) and download the package, then drag it onto **Govern › Packages** or run \`usertasks packages install <file>.utpkg\`.

Then find it in the workflow designer's palette under **Custom actions**. For *Crypto & IDs*, set the \`hmac_key\` and \`token_secret\` secrets on the action before using **HMAC**, **Sign token** or **Verify token**.

## Reference

${officialReference()}

## Sources

The sources are in the repository's \`gallery/actions\` folder — one folder per action with \`manifest.json\`, \`src/\`, tests and the built \`dist/action.js\`. They follow the same contract as the [starter kit](/docs/workflows/custom-actions#tutorial-from-starter-kit-to-workflow), so they are also worked examples.
`
  },
}
