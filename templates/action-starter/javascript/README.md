# Acme tax calculator — JavaScript action starter

A custom workflow action for UserTasks, written in plain JavaScript (an ES
module). Copy this folder, rename the action and make it yours.

Full guide and contract reference:
[Custom workflow actions](https://usertasks.com/docs/workflows/custom-actions).
The [TypeScript starter](../typescript/README.md) is the same action with
types; everything below works the same way.

## What is in here

| Path | What it is |
|---|---|
| `manifest.json` | Key, name, version, operations with typed inputs, outputs and sample inputs, capabilities, limits |
| `src/action.js` | The action: `export default { operations: { calculate, invoice_totals } }` (JSDoc types for your editor) |
| `test/cases.json` | Test cases: inputs and the outputs (or error code) you expect |
| `harness/run.ts` | The local test harness behind `npm test` |
| `vendor/usertasks-action/` | A copy of `@usertasks/action`: contract types and `runAction` (the app's sandbox with mocks) |
| `scripts/` | `build`, `test` and `package` |

You need Node.js 20 or later.

## Develop, test and package

```bash
npm install             # esbuild and the QuickJS sandbox, for npm test
npm test                # build, then run every sample and test case in the sandbox
npm run package         # build, test, write release/acme_tax-1.0.0.zip
```

`npm run build` bundles `src/action.js` (and any npm packages it imports) into
`dist/action.js`: one ES module with no imports, which is what the sandbox
needs. If your action has no dependencies you can also upload `src/action.js`
and `manifest.json` directly.

Each function receives `(inputs, ctx)` and returns its outputs as an object.
The sandbox has no Node or browser APIs (no `fetch`, timers, `process` or
`Intl`): use `ctx.log`, `ctx.fail`, `ctx.intl`, `ctx.crypto`, and, with
declared and approved capabilities, `ctx.http`, `ctx.data`, `ctx.files` and
`ctx.secrets`.

```js
export default {
  operations: {
    calculate(inputs, ctx) {
      const tax = Math.round(inputs.amount * inputs.rate_percent) / 100
      ctx.log.info('Calculated tax')
      return { net: inputs.amount, tax, gross: inputs.amount + tax }
    },
  },
}
```

`npm test -- --verbose` prints outputs and logs; `npm test -- invoice` runs
only matching operations and cases. Signing, uploading, approvals, using the
action in a workflow and releasing new versions are described in the
[TypeScript README](../typescript/README.md#5-package).
