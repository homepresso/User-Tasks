# @usertasks/form-control

Build **custom form controls** for UserTasks: web components that run in
UserTasks forms with the form's theme, validation and accessibility.

- **The contract** — manifest, element properties, events, theme tokens,
  bridge messages and limits, as TypeScript types and constants (the same
  ones the app uses).
- **`UserTasksControlElement`** — a plain `HTMLElement` base class with the
  host properties, change callbacks and helpers.
- **`UserTasksControlMixin(Base)`** — the same helpers for Lit, without
  importing Lit (zero runtime dependencies).

> Not published to npm yet. Until it is, the starter kit
> (`/downloads/form-control-starter.zip` on your instance) keeps the few
> helpers it needs inline.

Guide: <https://usertasks.com/docs/tasks/custom-form-controls>

## With Lit

```ts
import { LitElement, html } from 'lit'
import { UserTasksControlMixin } from '@usertasks/form-control'

class AcmeCounter extends UserTasksControlMixin(LitElement) {
  static properties = { step: { type: Number } } // declared props (manifest "props")
  declare step: number | undefined

  render() {
    return html`<button
      aria-label=${this.utLabel}
      aria-description=${this.utDescription ?? ''}
      ?disabled=${this.disabled || this.readonly}
      @click=${() => this.emitChange(Number(this.value ?? 0) + this.prop('step', 1))}
      @blur=${() => this.emitBlur()}
    >${this.value ?? 0}</button>`
  }

  updated() {
    this.setValidity(!(this.required && this.value == null), 'Press the button at least once.')
  }
}
customElements.define('acme-counter', AcmeCounter)
```

The mixin merges the host properties (`value`, `disabled`, `readonly`,
`required`, `invalid`, `error`, `props`, `theme`, `locale`, `context`,
`label`, `description`) into `static properties`; `disabled`, `readonly` and
`invalid` reflect to attributes for `:host([disabled])` styles.

## Without a framework

```ts
import { UserTasksControlElement } from '@usertasks/form-control'

class AcmeToggle extends UserTasksControlElement {
  static controlProps = ['on_label'] // declared props become element properties

  protected stateChanged(changed: ReadonlySet<string>) {
    // Called once per microtask with the names of what changed: render here.
  }
}
customElements.define('acme-toggle', AcmeToggle)
```

## Helpers

| Helper | Does |
|---|---|
| `emitChange(value)` | `ut-change` `{ value }` (bubbling, composed) |
| `emitBlur()` | `ut-blur` `{}` |
| `setValidity(valid, message?)` | `ut-validity`, only when it changes |
| `emitResize(height)` | `ut-resize` `{ height }` (optional; the runtime measures too) |
| `request('lookup', { query })` | host lookup → `{ items }`; needs capability `lookup` |
| `request('upload', { name, type, bytes })` | host upload → `{ id, name, size, type }`; needs capability `files` |
| `prop(name, fallback?)` | a declared prop: set by name wins over `props[name]` |
| `themeToken('ut-primary')` | `theme.tokens`, else the `--ut-primary` custom property |
| `utLabel`, `utDescription` | accessible name; help text plus the error while invalid |

## Licence

Apache-2.0
