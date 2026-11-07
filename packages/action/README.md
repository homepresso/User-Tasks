# @usertasks/action

Build **custom workflow actions** for UserTasks: typed workflow steps written
in JavaScript or TypeScript that run in the UserTasks QuickJS WebAssembly
sandbox.

- **The contract** — manifest, field types, capabilities, limits, error codes
  and the `ctx` API, as TypeScript types and constants (the same ones the app
  uses).
- **`defineAction`** — a typed identity helper for the module's default
  export.
- **`@usertasks/action/testing`** — `runAction`: run an operation locally in
  **the same sandbox** the app uses (a verbatim copy of its `sandbox.ts`),
  with mocks for HTTP, data tables, files and secrets. Capabilities are
  enforced as in the app.

> Not published to npm yet. Until it is, the starter kit
> (`/downloads/action-starter.zip` on your instance) carries a copy of these
> sources in `vendor/usertasks-action/`.

Guide: <https://usertasks.com/docs/workflows/custom-actions>

## Write an action

```ts
import { defineAction } from '@usertasks/action'

export default defineAction({
  operations: {
    // One function per operation id in manifest.json.
    async lookup(inputs: { customer_id: string }, ctx) {
      const res = await ctx.http.fetch(`https://api.example.com/customers/${inputs.customer_id}`, {
        headers: { authorization: 'Bearer secret://api_key' }, // the host substitutes the secret
      })
      if (res.status === 404) return { found: false, name: null }
      if (!res.ok) ctx.fail(`CRM returned ${res.status}`, { retryable: res.status >= 500 })
      ctx.log.info('Customer found', { id: inputs.customer_id })
      return { found: true, name: (res.json as { name: string }).name }
    },
  },
})
```

Bundle it into **one ES module** with no imports (esbuild, Rollup) and
upload it with its `manifest.json`:

```json
{
  "manifest_version": 1,
  "key": "acme_crm",
  "name": "Acme CRM",
  "version": "1.0.0",
  "operations": [{
    "id": "lookup", "label": "Look up customer",
    "inputs": [{ "name": "customer_id", "type": "string", "required": true }],
    "outputs": [{ "name": "found", "type": "boolean" }, { "name": "name", "type": "string" }]
  }],
  "capabilities": { "http": { "hosts": ["api.example.com"] }, "credentials": [{ "name": "api_key", "label": "API key" }] }
}
```

## The sandbox

The module runs in QuickJS compiled to WebAssembly, a fresh instance per run:
modern JavaScript (ES2023) with **no** Node or browser APIs — no `fetch`,
`setTimeout`, `process`, `require`, `Buffer` or `Intl`. The only way out is
`ctx`:

| `ctx` | Needs |
|---|---|
| `operation`, `run` (`{ id, workflow_id, step_id, test }`) | — |
| `log.info / warn / error(message, metadata?)` | — |
| `fail(message, { retryable })` | — |
| `crypto.randomUUID / randomBytes / randomInt / digest / hmac / timingSafeEqual / encode` | — (`hmac` may use a `secret://` key) |
| `intl.formatNumber / formatDate / zonedParts / zonedToUtc / timeZones / collate` | — |
| `http.fetch(url, { method, headers, body, json, timeout_ms })` | `capabilities.http.hosts` + an admin's approval |
| `data.query / get` · `data.insert / update` | `capabilities.data.read` · `.write` + a table grant |
| `files.read(file, { as: 'text' \| 'base64' })` | `capabilities.files` (only files passed as `file` inputs) |
| `secrets.get('secret://name')` | `capabilities.secrets` (declared names only) |

Limits (`ACTION_LIMITS`): 10 s per run by default (60 s ceiling), 32 MB heap
by default (128 MB ceiling), 256 KB stack, 200 host calls, 5 MB of inputs and
of outputs, 1 MB module.

## Test locally

```ts
import { readFileSync } from 'node:fs'
import { runAction } from '@usertasks/action/testing'

const result = await runAction({
  module: readFileSync('dist/action.js', 'utf8'),
  manifest: JSON.parse(readFileSync('manifest.json', 'utf8')),
  operation: 'lookup',
  inputs: { customer_id: '42' },
  mocks: {
    http: async (url, init) => ({ status: 200, json: { name: 'Ada' } }),
    secrets: { api_key: 'test-key' },
    data: { orders: [{ total: 10 }] }, // tables by name; writes change these arrays
    files: { 'invoice.txt': 'text content' }, // by url or name
  },
})
// { ok, outputs, logs, error?: { code, message, retryable }, stats: { duration_ms, host_calls, memory_bytes } }
```

`runAction` never throws: a failure comes back as `ok: false` with an error
`code` — `timeout`, `memory`, `capability`, `action`, `invalid` or `host`.
It needs the peer dependencies `quickjs-emscripten-core@0.32.0` and
`@jitl/quickjs-singlefile-cjs-release-sync@0.32.0`.

## Licence

Apache-2.0
