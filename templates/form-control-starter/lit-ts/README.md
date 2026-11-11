# Star rating — Lit + TypeScript starter

A custom form control for UserTasks: `<ut-star-rating>`, a 1–10 star rating
built with [Lit 3](https://lit.dev). Copy this folder, rename the control and
make it yours.

Full guide and contract reference:
[Custom form controls](https://usertasks.com/docs/tasks/custom-form-controls).

## What is in here

| Path | What it is |
|---|---|
| `manifest.json` | What UserTasks needs to know: tag, name, icon, version, value type and schema, designer props, size, capabilities, read-only display template, accessibility notes |
| `src/ut-star-rating.ts` | The control: a Lit element that implements the contract |
| `src/ut-control.ts` | Small inline helpers: host property declarations, `emit`, `request`, theme tokens, height reporting |
| `harness/` | A mock host page: sets every property, toggles states and the theme, edits props, logs every `ut-*` event and answers `ut-request` |
| `scripts/` | `build`, `dev` and `package` (esbuild, plus a tiny zip writer and the upload checks) |

## 1. Develop

```bash
npm install
npm run dev
```

Open <http://localhost:5180/harness/>. Edit `src/ut-star-rating.ts`: the
page rebuilds and reloads. (`PORT=5190 npm run dev` uses another port.)

The element must:

- accept the host **properties** `value`, `disabled`, `readonly`, `required`,
  `invalid`, `error`, `props`, `theme`, `locale`, `context`, `label`,
  `description`, plus each prop declared in `manifest.json` by name
  (`el.max = 7`);
- dispatch **bubbling, composed** `CustomEvent`s: `ut-change` `{ value }` when
  the user changes the value, `ut-blur` `{}` when focus leaves it,
  `ut-validity` `{ valid, message? }` if `validation.reports_validity` is
  true, and optionally `ut-resize` `{ height }`;
- use `label` / `description` as its accessible name and description, be
  fully keyboard operable, show a visible focus indicator in
  `--ut-focus-ring` and style itself with the `--ut-*` theme tokens.

## 2. Test with the harness

Work through the checklist in the harness before you upload:

- Tab in and out; click the field label (it calls `el.focus()`).
- Operate it with the keyboard only: arrows, Home / End, Delete (with
  `allow_clear`), Space / Enter.
- Toggle **disabled** (not focusable, no changes), **readonly** (focusable,
  no changes), **required** (a `ut-validity` with `valid: false` when empty),
  **invalid** + **error** (the error is announced through
  `aria-describedby`).
- Switch the theme to **dark** and check contrast and the focus ring.
- Apply props JSON (`{"max": 10, "size": "small"}`) and context JSON.
- Watch the event log: every `ut-change` value is checked against
  `value.type` and the schema bounds; warnings are shown in red.
- Check with a screen reader: it should announce the label, a radio group
  and the selected star ("3 stars, selected").

## 3. Build

```bash
npm run build
```

Typechecks, then bundles **one self-contained ES module** into
`dist/ut-star-rating.js` with Lit inlined and minified. The control runs in
a sandboxed frame whose Content Security Policy blocks every other request,
so the module must not import other files, use dynamic `import()`, load
assets with `import.meta.url`, or fetch web fonts. Inline images as `data:`
URIs. The build fails if any of that slips in, if the module is larger than
2 MB, or if `package.json` and `manifest.json` versions differ.

## 4. Package

```bash
npm run package
```

Writes `release/ut-star-rating-1.0.0.zip`: `manifest.json` and
`ut-star-rating.js` at the root of the zip (zip limit 3 MB).

## 5. Upload

In UserTasks: **Extensibility → Form controls → Upload**, choose the zip
(or the `.js` module plus `manifest.json`). The control appears in the form
designer's palette under **Custom** once it is enabled. Drag it onto a form,
set its properties in the right-hand panel and preview it.

## 6. Release a new version

Versions are immutable: every upload is a new version and existing forms
keep the version they were built with until a designer picks the new one in
the field's version picker.

1. Change the code.
2. Bump `version` in **both** `package.json` and `manifest.json` (semver:
   patch for fixes, minor for new props, major when the value shape changes).
3. `npm run package` and upload the new zip.

If the value's type or schema changes, existing submissions are not
migrated: keep old values readable or use a new tag.

## Renaming the control

Change `tag` (lowercase with a hyphen, unique in your workspace), `name`
and `entry` in `manifest.json`, the `TAG` constant and file names in `src/`,
`ENTRY` in `scripts/options.mjs` and the module path in
`harness/index.html`.

## Later: @user-tasks/form-control

The helpers in `src/ut-control.ts` will be available as the
`@user-tasks/form-control` package (`UserTasksControlMixin(LitElement)` and the
contract types). Until it is published, this starter keeps them inline.
