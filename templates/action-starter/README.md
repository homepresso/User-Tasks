# UserTasks action starter

Starter kits for **custom workflow actions**: your own typed workflow steps
that run in the UserTasks QuickJS WebAssembly sandbox. One upload gives you a
node in the workflow designer's palette (under **Custom actions**) with a
function picker, a generated input panel and typed outputs in the data
picker.

| Folder | For |
|---|---|
| [`typescript/`](typescript/README.md) | TypeScript with `defineAction` types, bundled to one ES module with esbuild |
| [`javascript/`](javascript/README.md) | Plain JavaScript (an ES module), the same scripts, JSDoc types for your editor |

Both build the same example, an **Acme tax calculator** (`acme_tax`) with two
operations: `calculate` (tax on one amount, tax-inclusive or not, with a
choice of rounding) and `invoice_totals` (line and invoice totals plus the
total formatted in a currency). Each kit has:

- `npm test`: runs every operation's `sample` inputs from `manifest.json`
  and the cases in `test/cases.json` in **the same sandbox the app uses**
  (QuickJS compiled to WebAssembly, the same limits, capabilities enforced
  with mocks);
- `npm run package`: builds, tests and writes `release/<key>-<version>.zip`
  (manifest, `dist/action.js`, README, and `signature.json` when you sign).

Read the guide: <https://usertasks.com/docs/workflows/custom-actions>
(also in your instance at `/docs/workflows/custom-actions`).

## The contract in one minute

```text
manifest.json   manifest_version 1, key (acme_tax), name, version (semver),
                operations [{ id, label, description, inputs [...], outputs [...], sample }],
                capabilities { http: { hosts }, data: { read, write }, files, secrets [...] },
                limits { timeout_ms, memory_mb }
field types     string text number integer boolean date datetime select object array json file
module          ONE ES module: export default defineAction({ operations: { <id>: (inputs, ctx) => outputs } })
ctx             log.info|warn|error, fail(message, { retryable }),
                http.fetch [http], data.query|get|insert|update [data], files.read [files],
                secrets.get('secret://name') [secrets], crypto.*, intl.* (always)
```

The sandbox has no Node or browser APIs, no `fetch`, timers or `Intl`:
everything outside pure JavaScript goes through `ctx`, and only for the
capabilities the manifest declares and an administrator grants.

`vendor/usertasks-action/` is a copy of the `@user-tasks/action` package
sources (the types, `defineAction` and the `runAction` test runner). When the
package is published you can `npm install -D @user-tasks/action` and import
from it instead.
