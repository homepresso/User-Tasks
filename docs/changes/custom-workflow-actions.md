# Release notes: custom workflow actions

Custom workflow activities become **custom workflow actions**: your own typed
workflow steps in JavaScript or TypeScript, run in a WebAssembly sandbox,
with capabilities an administrator grants, immutable signed versions, a
starter kit and six official actions in the gallery. Existing activities keep
working and now run sandboxed too.

## What's new

- **A real contract.** A `manifest.json` (version 1) declares the action's
  key, name, version and one or more **operations** — each with typed inputs
  and outputs (`string`, `text`, `number`, `integer`, `boolean`, `date`,
  `datetime`, `select`, `object`, `array`, `json`, `file`) and sample inputs
  — plus the **capabilities** it needs and its limits. The module is one ES
  module: `export default defineAction({ operations: { … } })`, each function
  getting `(inputs, ctx)`. See
  [Custom workflow actions](/docs/workflows/custom-actions).
- **In the designer.** Enabled actions appear in the palette under **Custom
  actions**, with a function picker, an input panel generated from the
  manifest and typed outputs in the data picker. Nodes have a timeout,
  retries for retryable failures (default 2, exponential backoff) and an
  optional pinned version. The run log records
  `ran key@version operation in N ms (H host calls)` with the version's
  SHA-256, and the action's own `ctx.log` lines.
- **Extensibility → Workflow actions** (rows and the API still say *workflow
  activities*): upload a zip or a module and manifest, see each version's
  SHA-256 and signature, enable or disable, approve HTTP hosts, grant data
  tables, set secrets, **Test** an operation (outputs, logs, duration, host
  calls, memory), see **Usages**, export and import.
- **Starter kit.** [action-starter.zip](/downloads/action-starter.zip): an
  *Acme tax calculator* in TypeScript and in plain JavaScript, with
  `npm test` running every sample and test case in the same sandbox the app
  uses, and `npm run package` (optionally signed).
- **`@user-tasks/action`** (in the repository, not yet on npm): the contract
  types, `defineAction`, and `runAction` from `@user-tasks/action/testing` —
  the app's sandbox with mocks for HTTP, data tables, files and secrets.
- **Six official actions** in the gallery (`/gallery/actions`, and **Packages
  → Browse gallery → Workflow actions**): Math & statistics, Text toolkit,
  Dates & business calendar, Data transform, Validation & formatting, and
  Crypto & IDs. See [Official workflow actions](/docs/workflows/official-actions).
- **API, MCP and CLI parity.** `POST /api/v1/workflow-activities/upload`
  (zip as `package_base64` or multipart `file`, or `module` + `manifest`),
  `GET …/{id}/usages`, `GET …/{id}/versions/{version}`,
  `PUT …/{id}/secrets`, `POST …/{id}/test`, and `PATCH` gains `enabled`,
  `approved_hosts` and `data_grants`. MCP: `workflow_activities_upload`,
  `_usages`, `_version_get`, `_secrets_set`, `_test`. CLI:
  `usertasks activities upload | usages | version | secrets | test`.
- **Packages and config as code** carry actions (asset type
  `workflow_activity`, folder `workflow-activities/`) with their manifest,
  module and checksum; grants and secrets stay behind.

## Security

- **Sandboxed by default.** Action code runs in QuickJS compiled to
  WebAssembly — a separate JavaScript engine in bounds-checked memory, a fresh
  instance per run — never in the app's own process context (`node:vm` and
  `new Function` are not a security boundary). Per-run heap, stack, CPU and
  wall-clock limits; 200 host calls per run; JSON-only boundary.
- **Capabilities.** Nothing outside pure computation unless the manifest
  declares it **and** an administrator grants it: HTTP only to approved
  hosts and through the egress guard (no private or metadata addresses,
  redirects re-checked), data tables only those granted (read or write),
  files only those passed as inputs, secrets only by declared name.
- **Secrets** are encrypted by the app into a table only the service role can
  read; the API only says which are set. Header and HMAC references
  (`secret://name`) keep values out of the sandbox.
- **The code is read from the library, never from the workflow definition**,
  so only people with Extensibility rights decide what runs, and disabling an
  action stops it everywhere at once.
- **Immutable versions** with SHA-256; optional ed25519 `signature.json`;
  official gallery actions show **Signed package**.
- **Client writes revoked.** Members could write `custom_workflow_activities`
  directly through the old `tenant_isolation` policy; they now only read
  their workspace's rows, and the server writes after its permission checks.
- **Legacy script activities run in the sandbox too.** Their `helpers` still
  work; code that used `require`, `fetch`, `process.env` or timers fails and
  should become a packaged action (see
  [Migrating legacy activities](/docs/workflows/custom-actions#migrating-legacy-activities)).

## Upgrade

1. Apply `supabase/migrations/20261203000000_custom_actions.sql` before
   deploying the code (new columns on `custom_workflow_activities`, the
   versions and secrets tables, read-only client access). Additive and
   idempotent.
2. **`ENABLE_CUSTOM_ACTIVITY_CODE` is no longer needed** and is ignored:
   actions always run, sandboxed. Remove it from your environment (the Helm
   value `security.enableCustomActivityCode` is accepted but does nothing).
3. Optional operator switches: `CUSTOM_ACTIONS_DISABLED=true` stops every
   custom action and script activity on the server (steps fail with
   `disabled`; Helm `security.customActionsDisabled`), and
   `CUSTOM_ACTION_MAX_TIMEOUT_MS` lowers the per-run time ceiling (60 s at
   most).
4. Check activities that called APIs or read environment variables: they
   need converting to packaged actions with declared hosts and secrets.
