# UserTasks form control starter

Starter kits for **custom form controls**: web components that run inside
UserTasks forms (task forms, form pages, start forms) with the same theme,
validation and accessibility as the built-in fields.

| Folder | For |
|---|---|
| [`lit-ts/`](lit-ts/README.md) | Lit 3 + TypeScript, bundled to one ES module with esbuild (`npm install`, `npm run dev`, `npm run package`) |
| [`vanilla-js/`](vanilla-js/README.md) | A plain custom element with no dependencies and no build step |

Both build the same example: `<ut-star-rating>`, a 1–10 star rating whose
value is a number, with designer props (`max`, `allow_clear`, `size`),
keyboard support, light and dark themes, and validity reporting. Each kit has
a **harness** page: a mock host that sets the control's properties, toggles
its states and theme, logs every `ut-*` event and simulates host requests.

Read the guide: <https://usertasks.com/docs/tasks/custom-form-controls>
(also in your instance at `/docs/tasks/custom-form-controls`).

## The contract in one minute

```text
manifest.json   tag, name, icon, version, entry, value { type, schema },
                props [...], validation, size, capabilities, display, output,
                accessibility
output          what the workflow gets: { type: string | number | boolean | date
                | object | array, primary? | template?, html?, extras?, choices? }
host → element  value, disabled, readonly, required, invalid, error, props,
                theme { mode, tokens }, locale, context, label, description
                + each declared prop by name (el.max = 5)
element → host  ut-change { value }   ut-blur {}   ut-validity { valid, message? }
                ut-resize { height }  ut-request { kind, payload, resolve, reject }
theme           --ut-primary, --ut-text, --ut-focus-ring, ... on :root
```

Each control runs in a sandboxed frame with a strict Content Security Policy:
no network unless the manifest asks for it and an admin approves the hosts.
