# Rich text

`<ut-rich-text>` — a compact rich-text editor: bold, italic, underline, two heading levels,
bulleted and numbered lists, quotes, links, clear formatting and undo / redo, with a character
counter. Everything typed, pasted, dropped or loaded is sanitised against a strict allowlist.

## Value

JSON `{ "html": string, "text": string }`, or empty (`null`) when the editor holds no text.

- `html` — sanitised HTML using only `p`, `br`, `strong`, `em`, `u`, `h2`, `h3`, `ul`, `ol`, `li`,
  `blockquote` and `a`. No attributes except on links: `href` (https, http or mailto only),
  `rel="noopener noreferrer"` and `target="_blank"`.
- `text` — the plain text with line breaks (list items start with `• ` or `1. `).

The server checks the shape (an object with the two strings, each at most 100,000 characters).
The control reports itself invalid when the text is longer than the maximum length ("Shorten the
text to 5000 characters") or the HTML exceeds 100,000 characters.
Read-only views (completed tasks, mobile, emails) show the plain text (`{{value.text}}`); the
control itself, when read-only, renders the sanitised HTML without an editor.

## Workflow output (1.1.0)

Workflows get text, not the object: `{{form.<key>}}` is the sanitised HTML (sanitised again by
the server) — or the plain text, when the form author sets **Workflow output: Plain text** in the
field's properties. `{{form.<key>_text}}` is always the plain text and `{{form.<key>_raw}}` the
whole `{ html, text }` value. Paths written for 1.0 (`{{form.<key>.text}}`) keep working.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Placeholder (`placeholder`) | text | — | Shown in the empty editor |
| Maximum characters (`max_length`) | number 1–100,000 | 5000 | Counted on the plain text; a counter shows "123 / 5000" |
| Toolbar (`toolbar`) | Full / Basic | Full | Basic: bold, italic, underline, lists, link, undo, redo |
| Minimum height (`min_height`) | number 60–1200 | 160 | Editor height in px before it grows |

## Keyboard and screen readers

The editor is a multi-line textbox (`role="textbox"`, `aria-multiline`) named by the field label
and described by its help text. The formatting toolbar (`role="toolbar"`) is one Tab stop:
Left / Right move between buttons, Home / End jump to the ends, Enter or Space applies. Toggle
buttons (bold, headings, lists, quote, link) expose `aria-pressed` for the formatting at the caret.

Shortcuts in the text: Ctrl/Cmd+B, I, U (bold, italic, underline), Ctrl/Cmd+K (link: an inline
box opens; Enter applies, Escape cancels; addresses without a scheme get https://, email addresses
get mailto:), Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y (redo).
Near the limit the remaining characters are announced politely (`aria-live`).

Formatting uses the browser's editing commands (`document.execCommand`), feature-detected: where
they are unavailable the toolbar is hidden and the text still edits.

## Security

The sanitiser rebuilds content from scratch (DOMParser into an inert document, then new elements
via `createElement`); it never assigns untrusted HTML with `innerHTML`. Dropped elements keep their
text, except script, style, SVG, frames and similar, which are removed entirely. Pastes and drops
are intercepted and sanitised before insertion; the stored value is sanitised again on every change.

**Consumers must still sanitise `html` before rendering it anywhere else** (an email template,
another application): the UserTasks server validates only the value's shape and size, so a value
written through the API may contain anything. Where formatting isn't needed, use `text`.

## Capabilities

None: no network, lookups or files. Bundles Lit 3.3.3 (BSD-3-Clause).
