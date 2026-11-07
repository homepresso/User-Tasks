# Acme tax calculator — TypeScript action starter

A custom workflow action for UserTasks, written in TypeScript. Copy this
folder, rename the action and make it yours.

Full guide and contract reference:
[Custom workflow actions](https://usertasks.com/docs/workflows/custom-actions).

## What is in here

| Path | What it is |
|---|---|
| `manifest.json` | What UserTasks needs to know: key, name, version, operations with typed inputs and outputs and sample inputs, capabilities, limits |
| `src/action.ts` | The action: `export default defineAction({ operations: { calculate, invoice_totals } })` |
| `test/cases.json` | Test cases: inputs and the outputs (or error code) you expect |
| `harness/run.ts` | The local test harness behind `npm test` |
| `vendor/usertasks-action/` | A copy of `@usertasks/action`: contract types, `defineAction`, and `runAction` (the app's sandbox with mocks) |
| `scripts/` | `build`, `test` and `package` (esbuild, the upload checks and a tiny zip writer) |

You need Node.js 20 or later.

## 1. Install

```bash
npm install
```

## 2. Write the code

Each operation in `manifest.json` needs a function with the same id in
`src/action.ts`. It receives the step's inputs (already coerced to the
declared types) and `ctx`, and returns an object with the declared outputs:

```ts
export default defineAction({
  operations: {
    calculate(inputs: { amount: number; rate_percent: number }, ctx) {
      if (inputs.rate_percent < 0) ctx.fail('rate_percent must not be negative')
      const tax = Math.round(inputs.amount * inputs.rate_percent) / 100
      ctx.log.info('Calculated tax', { rate: inputs.rate_percent })
      return { net: inputs.amount, tax, gross: inputs.amount + tax }
    },
  },
})
```

The code runs in a QuickJS WebAssembly sandbox: modern JavaScript (ES2023)
but no Node or browser APIs. There is no `fetch`, `setTimeout`, `process`,
`require` or `Intl`. Use `ctx` instead:

- `ctx.log.info|warn|error(message, metadata?)` — shown in the run log;
- `ctx.fail(message, { retryable })` — fail the step (retryable failures are
  retried by the node's retry policy);
- `ctx.intl.formatNumber / formatDate / zonedParts / zonedToUtc` and
  `ctx.crypto.randomUUID / digest / hmac / …` — always available;
- `ctx.http.fetch`, `ctx.data.*`, `ctx.files.read`, `ctx.secrets.get` — only
  with the matching `capabilities` in the manifest **and** an
  administrator's approval in the workspace.

npm packages work if they are plain JavaScript: esbuild bundles them into the
module. Packages that need Node built-ins (`fs`, `crypto`, `buffer`) will
not run.

## 3. Test locally

```bash
npm test
npm test -- invoice       # only operations / cases whose name contains "invoice"
npm test -- --verbose     # print outputs and logs
```

Builds `dist/action.js`, then runs it in the **same sandbox UserTasks uses**,
with the manifest's limits: first every operation's `sample` inputs (they
must succeed and return every declared output with the right type), then
each case in `test/cases.json`:

```json
{ "name": "15% on 100", "operation": "calculate",
  "inputs": { "amount": 100, "rate_percent": 15 },
  "expect": { "net": 100, "tax": 15, "gross": 115 } }
```

`expect_error` takes an error code (`action`, `invalid`, `capability`,
`host`, `timeout`, `memory`). Actions with capabilities get `mocks`, the
same as `runAction` from `@usertasks/action/testing`:

```json
{ "operation": "lookup", "inputs": { "id": "42" },
  "mocks": { "http": { "status": 200, "json": { "name": "Ada" } }, "secrets": { "api_key": "test" } } }
```

(In `cases.json` an HTTP mock is a fixed response; in your own scripts
`runAction` also takes a function `(url, init) => response`.)

## 4. Build

```bash
npm run build
```

Typechecks, then bundles **one self-contained ES module** into
`dist/action.js` with a banner naming the action and version. The sandbox
has no module loader, so the build fails if anything is left as an
`import`, if there is no default export, if an operation id is missing from
the module, if the module is over 1 MB, or if `package.json` and
`manifest.json` versions differ.

## 5. Package

```bash
npm run package
npm run package -- --sign ~/keys/acme-actions.pem   # also add signature.json
```

Builds, runs the tests, then writes `release/acme_tax-1.0.0.zip` with
`manifest.json`, `dist/action.js` and this README. With `--sign` (or
`ACTION_SIGNING_KEY=path`), it adds `signature.json`: an ed25519 signature
over the module's SHA-256. Make a key once with
`openssl genpkey -algorithm ed25519 -out acme-actions.pem` and keep it out
of the repository. UserTasks shows the key fingerprint on the version.

## 6. Upload and use

1. **Extensibility → Workflow actions → Upload**: choose the zip. Check the
   summary (key, version, operations, capabilities, checksum).
   From a terminal, upload the zip with the API
   (`curl -F file=@release/acme_tax-1.0.0.zip -H "Authorization: Bearer $USERTASKS_API_KEY" "$USERTASKS_URL/api/v1/workflow-activities/upload"`)
   or the CLI (`usertasks activities upload -f body.json`, where `body.json` is
   `{ "package_base64": "<the zip, base64>" }`).
2. If the action declares capabilities, an administrator **approves** them
   on the action: HTTP hosts, data table grants (read or write) and secret
   values. Nothing is allowed until then.
3. Open a workflow: the action is in the palette under **Custom actions**.
   Drop it on the canvas, pick the function (**Calculate tax** or **Invoice
   totals**), map the inputs, and use the outputs (`{{tax_gross}}`, …) from
   the data picker.
4. **Save & Test** the workflow and read the run log: each step logs
   `ran acme_tax@1.0.0 calculate in N ms (H host calls)` plus your own
   `ctx.log` lines.

## 7. Release a new version

Versions are immutable: every upload is a new version (with its SHA-256),
and a workflow node can pin one.

1. Change the code and the tests.
2. Bump `version` in **both** `package.json` and `manifest.json` (patch for
   fixes, minor for new operations or optional inputs, major when inputs or
   outputs change incompatibly).
3. `npm run package` and upload the new zip.

## Renaming the action

Change `key` (lowercase letters, digits and underscores, unique in your
workspace; `ut_` is reserved), `name` and the operations in `manifest.json`,
the functions in `src/action.ts`, the cases in `test/cases.json` and `name`
in `package.json`.
