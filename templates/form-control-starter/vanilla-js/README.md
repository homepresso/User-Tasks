# Star rating — vanilla JavaScript starter

The same `<ut-star-rating>` control as the Lit starter, written as a plain
custom element with **no dependencies and no build step**:
`ut-star-rating.js` is the ES module you upload, next to `manifest.json`.

Full guide and contract reference:
[Custom form controls](https://usertasks.com/docs/tasks/custom-form-controls).

## What is in here

| Path | What it is |
|---|---|
| `manifest.json` | Tag, name, icon, version, value type and schema, designer props, size, display template, accessibility notes |
| `ut-star-rating.js` | The control (the deliverable) |
| `harness/` | A mock host page: sets every property, toggles states and the theme, edits props, logs every `ut-*` event, answers `ut-request` |
| `scripts/` | `serve` (static server for the harness), `build` (checks + copy to `dist/`), `package` (zip) — Node 20+, nothing to install |

## 1. Develop and test

```bash
npm run dev        # or: node scripts/serve.mjs
```

Open <http://localhost:5180/harness/> (module scripts do not load from
`file://`). Edit `ut-star-rating.js` and reload the page. The harness sets
the host properties, toggles disabled / readonly / required / invalid /
error, switches the theme between light and dark, applies props and
context JSON, logs every event (with warnings when a value does not match
the manifest) and simulates `lookup` / `upload` responses for controls that
declare those capabilities.

## 2. Build and package

```bash
npm run build      # checks manifest.json and the module, copies it to dist/
npm run package    # release/ut-star-rating-1.0.0.zip (manifest.json + module)
```

No npm install is needed: the scripts use only Node's standard library. You
can also skip them and upload `ut-star-rating.js` with `manifest.json`
directly.

The module must be **one self-contained ES module**: the frame it runs in
blocks every other request (no `import` of other files, no dynamic
`import()`, no `import.meta.url` assets, no web fonts; inline images as
`data:` URIs). Limit: 2 MB for the module, 3 MB for a zip.

## 3. Upload and release

Upload the zip in **Extensibility → Form controls**, enable the control and
add it to a form from the **Custom** palette group. For a new release, bump
`version` in `manifest.json` (and `package.json`), package and upload again:
every version is immutable and each form field picks the version it uses.

## How the element works

- Host properties are accessors that store the value and queue one render
  per microtask; declared props (`max`, `allow_clear`, `size`) are accessors
  too, and a prop set by name wins over the same key in `props`.
- Properties set before the element is defined are re-applied in
  `connectedCallback` (the usual "upgrade" pattern).
- The stars are a `radiogroup` of `radio`s with a roving `tabindex`; the
  group's `aria-label` is the host's `label`, and `description` / `error`
  are linked with `aria-describedby`.
- Colours come from `--ut-*` custom properties (set on `:root` by the
  runtime and copied from `theme.tokens`), with fallbacks for light and dark.
- Events are `CustomEvent`s with `bubbles: true, composed: true`.
