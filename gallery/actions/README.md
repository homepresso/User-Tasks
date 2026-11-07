# Official workflow actions

Each folder here is one official UserTasks custom workflow action: a single
self-contained ES module that runs in the QuickJS WebAssembly sandbox
(`lib/custom-actions/sandbox.ts`) with a typed manifest
(`lib/custom-actions/contract.ts`). The gallery build packages each folder as
an installable package with its sample workflow.

| Folder | Key | What it does | Capabilities |
| --- | --- | --- | --- |
| `math-statistics` | `ut_math` | Formulas, rounding, statistics, percentiles, compound interest, loan schedules, unit conversion | none |
| `text-toolkit` | `ut_text` | Slugs, case conversion, templates, truncation, extraction, fuzzy matching, word counts, masking | none |
| `date-business-calendar` | `ut_dates` | Business days, SLA due times in working hours, durations, time zones, schedules, fiscal periods | none |
| `data-transform` | `ut_data` | JSON path, map, filter, sort, group, pivot / unpivot, dedupe, join, CSV ↔ JSON | none |
| `validation-formatting` | `ut_validate` | IBAN, BIC, cards, email, phone, postcodes, national IDs; number, currency and phone formatting | none |
| `crypto-ids` | `ut_crypto` | UUID v4 / v7, ULID, hashes, HMAC, encoding, random and one-time codes, HS256 JWTs | secrets `hmac_key`, `token_secret` |

## Folder layout

```
<slug>/
  manifest.json          v1 action manifest (must pass parseActionManifest, strict)
  src/action.ts          TypeScript source: export default defineAction({ operations: { … } })
  src/*.ts               helpers (bundled)
  dist/action.js         built module, committed (banner: /*! UserTasks action <key> <version> */)
  gallery.json           ActionGalleryMeta (lib/gallery/types.ts): ids, listing text, setup steps, examples
  README.md              operations, inputs / outputs, capabilities, examples, limits
  assets/workflows/      one sample workflow (config-as-code envelope, format_version 3)
shared/inputs.ts         input helpers bundled into every action
scripts/build.mjs        the bundler
scripts/test-kit.ts      shared vitest helpers (run like the engine; contract checks)
```

`ut_` keys are reserved for official actions. `gallery.json` ids (`id`,
`asset_id`) and the sample workflow id never change once published; the sample
workflow's `custom_activity` nodes reference the action by `asset_id` and key.

## Rules for action code

- No imports at run time: relative files, `@usertasks/action` and `@/…`
  repository files are bundled; npm packages are not allowed (the build fails).
- The sandbox has no Node or browser APIs, no timers and no `Intl`; its local
  time zone is not UTC, so use `Date.UTC` / `getUTC*` only. Use `ctx.intl.*`
  for locale formatting and time zones and `ctx.crypto.*` for hashing, HMAC and
  randomness. `node:crypto` imports (e.g. from `lib/documents/pii/validators.ts`)
  are replaced by a stub that throws.
- Every operation returns exactly its declared outputs with the declared types
  (`checkActionOutputs` reports no warnings), validates its inputs and throws
  `Error`s with messages that name the input.
- Gallery examples must be deterministic (explicit dates, no random operations):
  the gallery build runs them and publishes their outputs. Examples that need a
  secret run with the mock value `example-secret`.

## Build

```sh
node gallery/actions/scripts/build.mjs              # every action
node gallery/actions/scripts/build.mjs text-toolkit # one
node gallery/actions/scripts/build.mjs --check      # CI: fail if dist/ is stale
```

The build uses the repository's esbuild (ESM, platform neutral, ES2022, not
minified) and fails when an output still contains an `import` or is over 200 KB.

## Test

```sh
npx tsc --noEmit -p gallery/actions
env -u ENCRYPTION_KEY npx vitest run __tests__/gallery-action-
npx tsx scripts/gallery-build.ts --validate <slug>
```

The tests load `manifest.json` and `dist/action.js`, run every operation in the
same QuickJS sandbox the app uses (`packages/action/src/testing.ts`) after the
engine's input preparation (defaults and type coercion), and check the
manifest, the module, `gallery.json`, the README and the sample workflow.
