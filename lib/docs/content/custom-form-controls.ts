import type { DocPageDef } from '../types'

/** Custom form controls (web components): placed after the Forms page in TASK_PAGES. */
export const CUSTOM_FORM_CONTROLS_PAGE: DocPageDef = {
  slug: 'tasks/custom-form-controls',
  title: 'Custom form controls',
  description: 'Add your own web components (Lit or plain JavaScript) to forms: the starter kit, the sandbox and security model, the manifest and element contract, packaging, versions and accessibility.',
  body: `
## Why build a control

Built-in fields cover text, numbers, dates, choices, people, lookups and files. Real processes ask for more: a seat or floor map, a body diagram for an injury report, a product configurator, a barcode scanner, a pricing grid. With the custom control framework you build exactly that field once, as a web component, and it then behaves like any built-in one — in the designer, on every kind of form, in validation and in the workflow's variables — without forking the app or giving the component access to anything it does not declare. The [official gallery controls](/docs/tasks/gallery-form-controls) are built the same way.

A **custom form control** is a web component your workspace adds to the form designer: a star rating, a signature pad, a colour picker, a seat map — anything a built-in field type doesn't cover. Upload it once in **Extensibility → Form controls**, and it appears in the designer's palette under **Custom**, with a properties panel generated from its manifest. It then works wherever forms render: the designer preview, task forms, form pages (\`/f/<id>\`), start forms, **Save & Test** and **Run**, with grids, **Visible when**, required, themes and steps.

Each control is a standard custom element (built with [Lit](https://lit.dev), plain JavaScript or any framework that compiles to one) plus a \`manifest.json\`. It runs **sandboxed**: in its own frame, with no access to the page, the user's session or the network unless an admin allows it, and every value it produces is checked on the server.

> [!TIP]
> Looking for a chart, address search, map or signature pad? Install a ready-made one from the [gallery](/docs/tasks/gallery-form-controls).

> [!TIP]
> Looking for custom workflow steps? See [Custom workflow actions](/docs/workflows/custom-actions): typed steps in JavaScript or TypeScript, run in a WebAssembly sandbox, with their own [starter kit](/downloads/action-starter.zip).

> [!TIP]
> Start from the kit: [form-control-starter.zip](/downloads/form-control-starter.zip) has a star rating in Lit + TypeScript and in plain JavaScript, a dev harness, build and package scripts. The [tutorial](#tutorial-a-star-rating-with-lit) below walks through it.

## How it works

1. The designer stores a field that points at the control and a **version**, plus its property values and context mapping.
2. When the form renders, each control instance gets its own sandboxed \`<iframe>\` served from \`/form-controls/frame/<tag>/<version>\`. The frame loads the control's module (snapshotted in UserTasks, never fetched from its source), creates **one** element and sets its properties.
3. The control talks to the form through a typed \`postMessage\` bridge: the host sends the field's state (value, disabled, theme…), the control sends changes, blur, validity, height and requests for host services. Messages carry a per-frame channel nonce and are checked for source, origin and shape.
4. The form treats the value like any other field: it is saved with the task or submission, validated on the server and available downstream as \`{{task_data.<key>}}\` (task forms) or \`{{form.<key>}}\` (form pages and the **Form submitted** trigger) — as the control's declared **output** (see [Outputs](#outputs-what-the-workflow-receives)).

**No visible loading.** The form starts each frame as soon as the field renders, reserves the height the control had last time (or \`size.default_height\`), and sends the value, theme and props in the very first message — the element is only created once they have arrived, so its first paint is already styled. The part of the form that holds controls appears once they have all painted (at most 1.5 s; a control still loading after that shows the outline of an input, never a spinner). Controls on later steps or tabs warm up in the background. Make \`size.default_height\` your control's real height with default props, and render synchronously from your properties (Lit's first update is enough): the host waits for \`updateComplete\`.

Keyboard focus moves into and out of the frame with Tab like any field, clicking the field's label focuses the control, and the frame grows and shrinks with the control's height (within the manifest's \`size.min_height\` / \`size.max_height\`). Read-only views (completed tasks, the mobile app) don't run the control: they show its \`display.template\` (for example "4 of 5 stars") or the value as formatted text.

## Security model

Controls are third-party code, so the defaults assume they are untrusted.

| Layer | What it does |
|---|---|
| **Sandboxed frame** | \`sandbox="allow-scripts"\` without \`allow-same-origin\`: the frame has an opaque origin, so it can't read the app's cookies, storage or DOM, navigate the page, open pop-ups or submit forms. |
| **Content Security Policy** | \`default-src 'none'\`; the module runs only through a per-response \`script-src\` nonce; \`style-src 'unsafe-inline'\` (for component styles); images, fonts and media only from \`data:\` / \`blob:\`; \`connect-src 'none'\`; \`frame-ancestors 'self'\`. |
| **No network by default** | A control that needs to call an API declares \`capabilities: ["network"]\` and \`network.allowed_hosts\`. Nothing is allowed until a workspace admin **approves** those hosts on the control in the library; only approved hosts are added to \`connect-src\`. |
| **Host services, not credentials** | Lookups and file uploads go through \`ut-request\` to the form, which runs them with the user's own permissions. A control never sees tokens, keys or other fields' values beyond the \`context\` it declared and the designer mapped. |
| **Snapshots, not hot-loading** | The module and manifest are stored in UserTasks when uploaded or imported from a URL. Nothing is loaded from the internet at runtime, so a compromised CDN can't change a control under you. |
| **Immutable, checksummed versions** | Every upload is a new version with its SHA-256 checksum (and an optional signature) recorded. A form keeps the version it was built with until a designer changes it. |
| **Signatures** | A package may include \`signature.json\` — \`{ "alg": "ed25519", "public_key": "<base64 SPKI or PEM>", "signature": "<base64>" }\`, signing the module's SHA-256 (hex text). UserTasks verifies it and shows *Verified* with the key's fingerprint (compare it with the publisher's), or *Unverified*. |
| **Kill switch** | Disabling a control stops its frames loading everywhere within minutes. |
| **What a control can still do** | A control sees only what the form gives it — its own value, the fields you connect to its declared context, the theme. It can't reach the network, but it could leak that data by navigating its own frame; the form treats a navigation as an attack, tears the frame down and shows an error. Review third-party code before uploading it. |
| **Server validation** | Every submitted value is checked against the manifest's \`value.type\` and \`value.schema\` and the field's **Required**, whatever the control reported. |

> [!WARNING]
> **Trusted controls.** An instance admin can mark a control *trusted* so it renders inline in the page (in a Shadow DOM, with the same contract) instead of in a frame — slightly faster, and it shares the page's fonts. A trusted control runs with the **full privileges of the signed-in user**: it can read the page and call the API as them. It is off by default; only trust code your organisation wrote and reviewed.

## Tutorial: a star rating with Lit

You need Node.js 20 or later.

1. **Download the kit.** Get [form-control-starter.zip](/downloads/form-control-starter.zip), unzip it and open \`form-control-starter/lit-ts\`.
2. **Install and start the harness.**
   \`\`\`bash
   cd form-control-starter/lit-ts
   npm install
   npm run dev
   \`\`\`
   Open \`http://localhost:5180/harness/\`. The harness is a mock host: it sets the control's properties, toggles disabled / readonly / required / invalid, switches light and dark themes, edits props and context as JSON, logs every \`ut-*\` event and answers host requests.
3. **Edit.** Change \`src/ut-star-rating.ts\` (the page reloads on save). Rename the control by changing \`tag\` (lowercase with a hyphen, unique in your workspace), \`name\` and \`entry\` in \`manifest.json\` and the tag in the source.
4. **Declare what designers can set.** Each entry in \`props\` becomes a field in the designer's properties panel and an element property:
   \`\`\`json title="manifest.json (excerpt)"
   {
     "tag": "ut-star-rating",
     "name": "Star rating",
     "icon": "star",
     "version": "1.0.0",
     "entry": "ut-star-rating.js",
     "value": { "type": "number", "schema": { "type": "number", "minimum": 0, "maximum": 10 } },
     "props": [
       { "name": "max", "label": "Number of stars", "type": "number", "default": 5, "min": 1, "max": 10 },
       { "name": "allow_clear", "label": "Allow clearing the rating", "type": "boolean", "default": false },
       { "name": "size", "label": "Star size", "type": "select", "default": "medium", "options": ["small", "medium", "large"] }
     ],
     "validation": { "reports_validity": true },
     "display": { "template": "{{value}} of {{props.max}} stars" },
     "accessibility": { "role": "radiogroup", "keyboard": "Arrow keys change the rating; Home/End jump; Delete clears" }
   }
   \`\`\`
5. **Build.** \`npm run build\` typechecks and bundles **one self-contained ES module** (Lit included, minified) into \`dist/ut-star-rating.js\`.
6. **Package.** \`npm run package\` writes \`release/ut-star-rating-1.0.0.zip\` with \`manifest.json\` and the module.
7. **Upload.** In UserTasks, open **Extensibility → Form controls → Upload** and choose the zip. Check the summary (tag, version, value type, capabilities, checksum) and **Enable** the control.
8. **Add it to a form.** Open a form in the designer: the control is in the palette under **Custom** with its icon. Drag it onto the grid, give the field a label and key, then set **Number of stars**, **Allow clearing** and **Star size** in the properties panel. The panel also has the **version** picker and, for controls that declare \`context\`, a mapping from each context name to another field.
9. **Preview and publish.** **Preview** runs the real control in light and dark mode and at phone width; **Check validation** tries required. Save the form (or the workflow) and publish as usual. After a submission, \`{{form.rating}}\` or \`{{task_data.rating}}\` holds the number.

The control's code is short. The element receives properties and dispatches events:

\`\`\`ts title="src/ut-star-rating.ts (excerpt)"
export class UtStarRating extends LitElement {
  static override properties = {
    value: { attribute: false }, disabled: { type: Boolean, reflect: true },
    readonly: { type: Boolean, reflect: true }, required: { type: Boolean },
    invalid: { type: Boolean, reflect: true }, error: { attribute: false },
    props: { attribute: false }, theme: { attribute: false }, label: { attribute: false },
    description: { attribute: false }, max: { type: Number }, // a declared prop
  }

  #select(n: number) {
    if (this.disabled || this.readonly) return
    this.value = n
    this.dispatchEvent(new CustomEvent('ut-change', { detail: { value: n }, bubbles: true, composed: true }))
  }

  override updated() {
    const valid = !(this.required && !this.value)
    this.dispatchEvent(new CustomEvent('ut-validity', {
      detail: valid ? { valid } : { valid, message: 'Choose a rating.' }, bubbles: true, composed: true,
    }))
  }
}
customElements.define('ut-star-rating', UtStarRating)
\`\`\`

## The vanilla JavaScript version

\`form-control-starter/vanilla-js\` is the same control as a plain custom element with **no dependencies and no build step**: \`ut-star-rating.js\` is the module you upload. Run \`npm run dev\` (a static server for the harness, nothing to install), then \`npm run package\` for the zip — or upload \`ut-star-rating.js\` with \`manifest.json\` directly.

\`\`\`js title="The shape of a vanilla control"
class AcmeToggle extends HTMLElement {
  #value = false
  constructor() {
    super()
    this.attachShadow({ mode: 'open', delegatesFocus: true }).innerHTML =
      '<button role="switch" aria-checked="false"></button>'
    this.shadowRoot.querySelector('button').addEventListener('click', () => {
      if (this.disabled || this.readonly) return
      this.value = !this.#value
      this.dispatchEvent(new CustomEvent('ut-change', { detail: { value: this.#value }, bubbles: true, composed: true }))
    })
  }
  set value(v) { this.#value = v === true; this.#render() }
  get value() { return this.#value }
  set label(v) { this.shadowRoot.querySelector('button').setAttribute('aria-label', v ?? '') }
  // …disabled, readonly, required, invalid, error, props, theme, description
  #render() { this.shadowRoot.querySelector('button').setAttribute('aria-checked', String(this.#value)) }
}
customElements.define('acme-toggle', AcmeToggle)
\`\`\`

## Test with the harness

The harness (\`harness/index.html\` in each kit) behaves like the runtime inside the frame. Before you upload:

- **Keyboard only:** Tab in and out, operate every part, check the focus ring is visible. Click the field label: focus should move into the control.
- **States:** toggle disabled (not focusable, no changes), readonly (focusable, no changes), required (a \`ut-validity\` with \`valid: false\` while empty), invalid with an error message (announced through the control's description).
- **Theme:** switch to dark; check text and non-text contrast with the tokens.
- **Props and context:** apply props JSON (for example \`{"max": 10, "size": "small"}\`) and context JSON.
- **Events:** the log shows every \`ut-*\` event; values that don't match \`value.type\` or the schema bounds are flagged in red, and so are events that aren't \`composed\`.
- **Requests:** grant \`lookup\` / \`files\` (only those the manifest declares can be granted), edit the lookup items, add a delay or make requests fail.
- **Screen reader:** the control should announce the field's label, its role and state.

The harness isn't the sandbox: it doesn't apply the frame's CSP. A build that passes the kit's checks (one module, no imports, no \`import.meta.url\`) runs under it.

## Contract reference

The source of truth is \`lib/forms/custom-controls/contract.ts\` (also exported by the \`@usertasks/form-control\` package once it is published).

### manifest.json

| Field | Required | Meaning |
|---|---|---|
| \`manifest_version\` | yes | \`1\` |
| \`tag\` | yes | Custom element name: lowercase, contains a hyphen (\`acme-star-rating\`). The control's identity in the workspace. |
| \`name\` | yes | Palette label. |
| \`description\` | | Shown in the library and the palette tooltip. |
| \`icon\` | | A Lucide icon name in kebab case (\`star\`, \`pen-line\`) or a \`data:image/svg+xml\` URI. |
| \`version\` | yes | Semver (\`1.2.0\`). Each upload is a new, immutable version. |
| \`entry\` | | The module file in a zip. Default: the only \`.js\` / \`.mjs\` file, or \`index.js\`. |
| \`value\` | yes | \`{ type, schema?, default? }\` — what the field stores (see [value types](#value-types-and-downstream-data)). |
| \`props\` | | Designer-editable properties: the properties panel (see below). Up to 50. |
| \`events\` | | \`[{ name, description }]\` — extra events the control emits, for documentation only. |
| \`validation\` | | \`{ reports_validity: true }\` if the control dispatches \`ut-validity\`. |
| \`size\` | | \`{ default_height, min_height, max_height, full_width }\` in px. The host keeps the frame between 24 and 2000 px whatever the manifest says. |
| \`capabilities\` | | Host services it may request: \`lookup\`, \`files\`, \`network\`. |
| \`network\` | | \`{ allowed_hosts: ["api.example.com"] }\` — only effective once an admin approves them. |
| \`context\` | | \`[{ name, label, description }]\` — other form values the control reads; the designer maps each to a field. Up to 20. |
| \`output\` | | What the workflow receives — see [Outputs](#outputs-what-the-workflow-receives). Without it the value itself is the output. |
| \`display\` | | \`{ template, format }\` — the read-only rendering. \`template\` uses \`{{value}}\`, \`{{value.path}}\` and \`{{props.name}}\` (plain text, never HTML); \`format\` is \`text\`, \`json\`, \`number\`, \`date\` or \`list\`. |
| \`accessibility\` | | \`{ role, keyboard, labelled_by_host }\` — the ARIA role of the interactive part, how a keyboard user operates it, and whether it uses the host's label (default true). Shown by the accessibility checker. |
| \`dependencies\` | | \`{ "lit": "^3.3.1" }\` — what is bundled into the module (informational). |
| \`author\`, \`license\`, \`homepage\` | | Shown in the library. |

Each entry in \`props\` is \`{ name, label, type, description, default, options, min, max, required }\`. \`type\` is one of:

| Prop type | Panel input | Element gets |
|---|---|---|
| \`string\` | single-line text | string |
| \`text\` | multi-line text | string |
| \`number\` | number (with \`min\` / \`max\`) | number |
| \`boolean\` | checkbox | boolean |
| \`select\` | dropdown of \`options\` (\`"small"\` or \`{ "value": "small", "label": "Small" }\`) | string |
| \`color\` | colour picker | CSS colour string |
| \`string[]\` | list of strings | array of strings |
| \`json\` | JSON editor | any JSON value |

A prop's \`name\` can't be one of the host's property names (\`value\`, \`disabled\`, \`props\`, \`label\`…) or a built-in element property (\`id\`, \`style\`, \`hidden\`, \`title\`, \`innerHTML\`…).

### Element properties (host → control)

The runtime creates exactly one \`<tag>\` element and sets these **properties** (not attributes), first all at once and then whenever they change:

| Property | Type | Meaning |
|---|---|---|
| \`value\` | per \`value.type\`, or \`null\` | The field's current value. |
| \`disabled\` | boolean | Not editable and not focusable (a disabled form, a step not reached). |
| \`readonly\` | boolean | Focusable and readable but not editable (the field's **Read-only**). |
| \`required\` | boolean | The field's **Required**. |
| \`invalid\` | boolean | The form has marked the field invalid (after a submit attempt or server validation). |
| \`error\` | string or \`null\` | The message to announce while invalid. |
| \`props\` | object | All designer property values, keyed by prop name. |
| \`theme\` | \`{ mode: 'light' \\| 'dark', tokens }\` | The form's theme in the current mode (see [theme tokens](#theme-tokens)). |
| \`locale\` | string | The viewer's locale (\`en-NZ\`). |
| \`context\` | \`{ fields, form_id, task_id, workflow_id, field_key }\` | Values of the mapped context fields (by context name) and ids. Never secrets or tokens. |
| \`label\` | string | The field's label: use it as the accessible name. |
| \`description\` | string or \`null\` | The field's help text: use it as the accessible description. |

Each declared prop is also set **by its own name** (\`el.max = 5\`), so Lit's reactive properties and plain setters both work. The host draws the visible label, help text and error message around the frame; the control uses \`label\`, \`description\` and \`error\` for its accessible name and description.

### Events (control → host)

Dispatch them on the element as \`CustomEvent\`s with \`bubbles: true, composed: true\`:

| Event | \`detail\` | When |
|---|---|---|
| \`ut-change\` | \`{ value }\` | The user changed the value. Values over 256 KB of JSON are refused. |
| \`ut-blur\` | \`{}\` | Focus left the control (marks the field as touched). |
| \`ut-validity\` | \`{ valid, message? }\` | The control's own validity changed (with \`validation.reports_validity\`). The message (up to 500 characters) is shown when the form validates. |
| \`ut-resize\` | \`{ height }\` | Optional: the content height changed. The runtime also measures the element. |
| \`ut-request\` | \`{ kind, payload, resolve, reject }\` | Ask the host for a service (below). Up to 8 in flight per control. |

### Theme tokens

The runtime sets these CSS custom properties on the frame's \`:root\` (so they inherit into shadow roots) and passes them in \`theme.tokens\` (without the leading \`--\`). They come from the form's theme or mini theme in the current mode, so style with them rather than fixed colours:

| Token | Use for |
|---|---|
| \`--ut-primary\` | Accent: selected state, primary buttons, filled marks |
| \`--ut-on-primary\` | Text and icons on \`--ut-primary\` |
| \`--ut-primary-text\` | Accent-coloured text (links) on the surface |
| \`--ut-primary-light\` | Tinted backgrounds: hover, selection |
| \`--ut-text\` | Body text |
| \`--ut-muted-text\` | Secondary text; also a safe colour for unselected outlines (3:1) |
| \`--ut-surface\` | Page background |
| \`--ut-card\` | Card / panel background |
| \`--ut-border\` | Decorative borders and dividers |
| \`--ut-input-bg\` | Input background |
| \`--ut-input-text\` | Input text |
| \`--ut-focus-ring\` | Focus indicator |
| \`--ut-error\` | Errors and invalid outlines |
| \`--ut-success\` | Success states |
| \`--ut-radius\` | Corner radius |
| \`--ut-font-family\` | Font stack (the frame has no web fonts; inline any you need as \`data:\` URIs) |
| \`--ut-font-size\` | Base font size |

\`theme.mode\` is \`light\` or \`dark\`; switch any colours you can't express with tokens on it.

### Capabilities and host requests

A control asks the form for a service by dispatching \`ut-request\` with a \`kind\`, a \`payload\` and the \`resolve\` / \`reject\` functions of a promise. The request only works if the manifest declares the matching capability (and the field allows it); otherwise it is rejected.

| \`kind\` | Capability | \`payload\` | Resolves with |
|---|---|---|---|
| \`lookup\` | \`lookup\` | \`{ query }\` | \`{ items: [{ value, label, description?, data? }], truncated? }\` — from the lookup source the designer configured on the field |
| \`upload\` | \`files\` | \`{ name, type, bytes }\` (\`bytes\` is an \`ArrayBuffer\`, up to 25 MB) | \`{ id, name, size, type }\` — a stored file reference to put in the value |
| \`file\` | \`files\` | \`{ id }\` | \`{ id, name, type, size, bytes }\` — the bytes of a file the form already gave the control: an entry of its own value or of a context field's value (an Attachments field). Any other id is refused; the host downloads it with the user's own session |
| \`report\` | \`reports\` | \`{ limit? }\` (default 200, at most 1000 rows) | \`{ report: { id, name, description, visualization }, columns: [{ key, label, type }], rows, total, truncated }\` — the saved report in the field's \`report_id\` prop, **read by the server from the stored form** (never from the control), run as the person filling in the form: their own or shared reports only, their permissions and row-level security |
| \`tile\` | \`network\` (with \`tile.openstreetmap.org\` approved) | \`{ z, x, y }\` | \`{ type, bytes }\` — one OpenStreetMap raster tile fetched and cached by the server (public tile servers refuse the frame's referrer-less requests); refused unless an admin approved the host for this control |

\`\`\`js
const result = await new Promise((resolve, reject) =>
  this.dispatchEvent(new CustomEvent('ut-request', {
    detail: { kind: 'lookup', payload: { query: 'acme' }, resolve, reject },
    bubbles: true, composed: true,
  })))
\`\`\`

\`network\` is different: it doesn't add a request kind, it lets the control's own \`fetch\` reach the hosts in \`network.allowed_hosts\` that an admin approved (HTTPS only). Prefer \`lookup\` (it uses the workspace's integrations and keeps credentials on the server).

### Value types and downstream data

| \`value.type\` | The value | Downstream |
|---|---|---|
| \`string\` | a string | \`{{task_data.<key>}}\` / \`{{form.<key>}}\` as text |
| \`number\` | a finite number | a number |
| \`boolean\` | \`true\` / \`false\` | a boolean |
| \`date\` | ISO 8601 date (\`2026-10-30\`) or date-time string | a string |
| \`json\` | any JSON value (usually an object) | the object: \`{{task_data.<key>.city}}\` |
| \`array\` | a JSON array | the array, loopable |
| \`files\` | an array of file references from \`upload\` requests | file objects, like an Attachments field |

\`null\` means "no value": the form's **Required** fails on \`null\` (and on an empty string or array). The data picker lists a custom field with its output type (its value type when it declares no output).

### Outputs: what the workflow receives

A control's **value** is what it stores for itself and is handed back when the form opens again (rich text keeps \`{ html, text }\`). Its **output** is what workflows, emails, rules and the data picker get — ideally a primitive. Declare it in the manifest:

\`\`\`json
"output": {
  "type": "string",
  "primary": "html",
  "html": true,
  "choices": [
    { "value": "html", "label": "HTML (formatted, sanitised)", "primary": "html", "html": true },
    { "value": "text", "label": "Plain text", "primary": "text" }
  ],
  "extras": { "text": "text" }
}
\`\`\`

| Key | Meaning |
|---|---|
| \`type\` | \`string\`, \`number\`, \`boolean\`, \`date\`, \`object\` or \`array\` — the type of \`{{form.<key>}}\`. A \`files\` control outputs its file list (\`array\`). |
| \`primary\` | A dot path into the value for the main output (\`html\`, \`address.city\`). Absent: the value itself. |
| \`template\` | Instead of \`primary\`: text built from the value, e.g. \`"{{value.lat}},{{value.lng}}"\` (\`type\` must be \`string\`). |
| \`html\` | The main output is HTML: the server sanitises it with the allowlist used for task descriptions. |
| \`extras\` | Sibling outputs: \`<key>_<suffix>\` ← a dot path (\`""\` = the whole value). \`raw\`, \`item\`, \`label\`, \`count\` and \`included\` are reserved. |
| \`choices\` | Main outputs the form author can pick in the field's properties (**Workflow output**). The first is the default. |

So a rich-text field \`desc\` gives \`{{form.desc}}\` (sanitised HTML), \`{{form.desc_text}}\` (plain text) and \`{{form.desc_raw}}\` (the whole \`{ html, text }\` value, kept whenever the main output is a projection of a structured value). A structured value with a primitive output must say how to get it (\`primary\`, \`template\`, or a \`primary\` / \`template\` on every choice) — the upload refuses it otherwise.

The server computes every output itself, from the validated value, on every save — it never takes the control's word for a type: text is coerced and bounded (200,000 characters), numbers must be finite, dates ISO, HTML sanitised (in \`_raw\` too), and extras sent by a client are ignored. A form opened again holds the output under \`<key>\`; the host gives the control its value back from \`<key>_raw\`.

**Existing workflows.** Fields keep the version they were placed with, so nothing changes until a form is upgraded. After an upgrade, paths written for the old object (\`{{form.desc.text}}\`) still resolve: when a path runs into a control's text output, it continues in \`<key>_raw\`. Prefer the new names (\`{{form.desc_text}}\`) in new work.

### Server validation

Every way of saving or completing a task and every form submission (the app, \`/api/v1\`, MCP, the CLI, Save & Test) checks a custom field's value on the server, never trusting the control:

- the value matches \`value.type\`, and **Required** and **Visible when** apply as for any field;
- \`value.schema\` holds, using this JSON Schema subset: \`type\`, \`enum\`, \`const\`, \`minimum\` / \`maximum\` / \`exclusiveMinimum\` / \`exclusiveMaximum\`, \`multipleOf\`, \`minLength\` / \`maxLength\`, \`pattern\`, \`format\` (\`date\`, \`date-time\`, \`email\`, \`uri\`), \`items\`, \`minItems\` / \`maxItems\`, \`uniqueItems\`, \`properties\`, \`required\` and \`additionalProperties\`;
- the value is at most 256 KB of JSON, and \`files\` values only reference files uploaded for that form or task.

Invalid values are refused with a message for the field and nothing is recorded.

## Packaging

Upload either:

- a **zip** with \`manifest.json\` and the module at its root (plus an optional \`README.md\` and \`LICENSE\`), or
- the **module** (\`.js\` or \`.mjs\`) and its **manifest** JSON as two files.

\`\`\`text
ut-star-rating-1.0.0.zip
├── manifest.json
└── ut-star-rating.js
\`\`\`

The module must be **one self-contained ES module**: the frame's CSP blocks every other request, so bundle every dependency (esbuild, Rollup or Vite in library mode with a single output), and don't use dynamic \`import()\` of other files, \`import.meta.url\` to load assets, external stylesheets or web fonts. Inline images and fonts as \`data:\` URIs.

| Limit | Value |
|---|---|
| Module | 2 MB |
| Zip | 3 MB |
| \`manifest.json\` | 64 KB |
| \`props\` | 50 |
| \`context\` | 20 |
| \`value.schema\` | 16 KB |

## Versions and upgrades

- \`version\` is semver, and each upload is a new **immutable** version: the same tag and version can't be uploaded twice with different contents. The library shows each version's checksum, size, uploader and date.
- A field stores the version it uses. New fields get the latest enabled version; existing fields keep theirs until a designer picks another in the field's **version** picker, so uploading 1.1.0 never changes a published form by itself.
- Bump the **patch** for fixes, the **minor** for new optional props, and the **major** when the value's shape changes. Values already saved aren't migrated: if the type or schema changes incompatibly, keep reading the old shape or publish under a new tag.
- **Disable** a control to hide it from the palette **and stop it loading** — a kill switch for a control you no longer trust: forms that use it show "disabled in this workspace" in its place until you enable it again (or move them to another control). Check **Usage** first. **Delete** is blocked while any form, workflow (draft or published) or open task uses it; the error and **Usage** list them.

## Import from a URL

**Import from URL** (Extensibility → Form controls) takes an \`https://\` link to a zip, or to the module with its manifest beside it. UserTasks fetches it **once** through the same egress guard as integrations (no private or internal addresses, size and time limits), records the checksum and stores the snapshot. Later changes at the URL have no effect until someone imports again, which creates a new version.

## Export, import and packages

Controls are the asset type \`form_control\` in exports, [packages](/docs/packages) and [config as code](/docs/config-as-code). Exporting a form or workflow with its dependencies brings the control versions its fields use (module, manifest and checksum). On import, a control whose tag and version already exist with the same checksum is reused; a different checksum under the same version is refused. Approved network hosts and the trusted flag are not imported: an admin reviews them in the target workspace.

## API, MCP and CLI

| Task | REST | MCP | CLI |
|---|---|---|---|
| List controls | \`GET /api/v1/form-controls\` | \`form_controls_list\` | \`usertasks form-controls list\` |
| Show one | \`GET /api/v1/form-controls/{id}\` | \`form_controls_get\` | \`usertasks form-controls get <id>\` |
| Upload a control or a new version | \`POST /api/v1/form-controls\` (JSON \`package_base64\` for a zip, \`module\` + \`manifest\`, or \`url\`; multipart \`file=@pkg.zip\` also works) | \`form_controls_create\` | \`usertasks form-controls create --url <https-url>\` or \`-f body.json\` |
| One version (manifest, checksum; module with \`include_module=true\`) | \`GET /api/v1/form-controls/{id}/versions/{version}\` | \`form_controls_version_get\` | \`usertasks form-controls version <id> <version>\` |
| Enable, disable, approve hosts | \`PATCH /api/v1/form-controls/{id}\` | \`form_controls_update\` | \`usertasks form-controls update <id>\` |
| Where it is used | \`GET /api/v1/form-controls/{id}/usages\` | \`form_controls_usages\` | \`usertasks form-controls usages <id>\` |
| Delete (when unused; one version with \`?only_version=\`) | \`DELETE /api/v1/form-controls/{id}\` | \`form_controls_delete\` | \`usertasks form-controls delete <id>\` |
| Export, import | \`/api/v1/form-controls/{id}/export\`, \`/api/v1/form-controls/import\` | \`form_controls_export\`, \`form_controls_import\` | \`usertasks form-controls export\`, \`import\` |

The [API reference](/docs/api/endpoints), [MCP tools](/docs/mcp) and [CLI commands](/docs/cli/commands) pages list the exact parameters.

## Permissions

| Permission | Allows |
|---|---|
| \`extensibility.view\` | See the Form controls library, versions and usages |
| \`extensibility.create\` | Upload controls and new versions, import from a URL |
| \`extensibility.edit\` | Enable / disable, approve network hosts |
| \`extensibility.delete\` | Delete unused controls |
| \`forms.view\` | See enabled controls in the form designer's palette (placing them needs the form editing rights the designer already asks for) |

Marking a control **trusted** is an instance-admin setting.

## Accessibility for control authors

The form is only as accessible as its least accessible field. The [accessibility checker](/docs/tasks/forms#accessibility-checker) checks a control's manifest and scans it in the preview; to pass WCAG 2.2 AA:

- **Name and description.** Use \`label\` as the accessible name (\`aria-label\` on the interactive element, or on its group) and link \`description\` and, while \`invalid\`, \`error\` with \`aria-describedby\` — both inside the shadow root. Keep \`accessibility.labelled_by_host\` true.
- **Role and state.** Use native elements where you can (\`<button>\`, \`<input>\`); otherwise give the right ARIA role (\`radiogroup\` / \`radio\`, \`slider\`, \`combobox\`, \`switch\`) with its states (\`aria-checked\`, \`aria-valuenow\`, \`aria-expanded\`), plus \`aria-required\`, \`aria-invalid\`, \`aria-readonly\`, \`aria-disabled\`.
- **Keyboard.** Everything works without a mouse, following the ARIA Authoring Practices pattern for the role (a radio group moves with the arrow keys and has one Tab stop). Document it in \`accessibility.keyboard\`. Use \`delegatesFocus: true\` or implement \`focus()\` so the label and Tab land on the right element.
- **Focus visible.** A 2 px outline in \`--ut-focus-ring\` with an offset, never \`outline: none\` without a replacement.
- **Contrast.** Text 4.5:1 against its background; borders, icons and the state of controls 3:1 (WCAG 1.4.11). Check both themes; \`--ut-muted-text\` is a safe outline colour, \`--ut-border\` is for decoration only.
- **Target size.** Pointer targets at least 24 × 24 px (2.5.8).
- **Don't rely on colour alone**, respect \`prefers-reduced-motion\`, and support \`forced-colors\` (Windows High Contrast) with system colours.
- **States.** \`disabled\` removes the control from the tab order; \`readonly\` keeps it focusable but unchangeable.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| The frame is blank | The module threw or didn't define the tag. Check \`tag\` in the manifest matches \`customElements.define(...)\`, and the browser console of the frame (DevTools → the frame's context). |
| Console: "Refused to load the script" / "Refused to connect" (CSP) | The module imports another file, uses dynamic \`import()\` or \`import.meta.url\`, loads a font or stylesheet, or calls a host that isn't approved. Bundle into one module, inline assets as \`data:\` URIs, or declare \`network\` and ask an admin to approve the host. |
| The value never saves | \`ut-change\` isn't reaching the form: dispatch on the element (not inside the shadow root only) with \`bubbles: true, composed: true\` and \`detail: { value }\`. The harness flags events that aren't composed. |
| The workflow gets an object | The control declares no \`output\` (or the form uses a version without one): add \`output\`, upload a new version and upgrade the field, or read a path (\`{{form.<key>.text}}\`). |
| "Value does not match" on submit | The value's type or schema doesn't match the manifest (a string \`"4"\` for a \`number\`, a number over \`maximum\`). |
| The frame is cut off or too tall | Set \`size.min_height\` / \`size.max_height\`; make the host element \`display: block\` so it can be measured, or dispatch \`ut-resize\`. |
| A request is rejected | The manifest doesn't declare the capability (\`lookup\` → \`lookup\`, \`upload\` → \`files\`), or the field has no lookup source configured. |
| Properties are \`undefined\` | They are set as properties, not attributes: read \`this.value\`, not \`getAttribute('value')\`. In Lit, declare them in \`static properties\` with \`attribute: false\` and don't initialise them in class fields that shadow Lit's accessors. |
| The upload is refused | The manifest is invalid (tag without a hyphen, a non-semver version, a reserved prop name), the module is over 2 MB or the zip over 3 MB, or that version already exists. |

## Related

- [Forms](/docs/tasks/forms) — the designer, field types and the [accessibility checker](/docs/tasks/forms#accessibility-checker)
- [Custom workflow actions](/docs/workflows/custom-actions) — the other kind of extension: your own sandboxed workflow steps
- [Workspace theme](/docs/governance/workspace-theme) — where the theme tokens come from
- [Packages](/docs/packages) — moving controls with forms and workflows
- [Gallery form controls](/docs/tasks/gallery-form-controls) — official ready-made controls (chart, saved report, address search, map, signature, …)
`,
}
