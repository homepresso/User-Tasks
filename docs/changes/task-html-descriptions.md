# Release notes: HTML task descriptions

Task descriptions can now be HTML. The app renders the formatting, API
clients can ask for plain text, and the CLI shows plain text unless you ask
for the HTML. Plain-text descriptions work exactly as before.

## New

- **Rich descriptions.** A description may use `p`, `br`, `div`, `span`,
  `hr`, `strong`/`b`, `em`/`i`, `u`, `s`, `sub`, `sup`, `a`, `ul`, `ol`,
  `li`, `h1`–`h4`, `blockquote`, `code`, `pre`, `table`, `thead`, `tbody`,
  `tr`, `th`, `td` and `img`. Links may be `http(s)`, `mailto` or relative and
  always open in a new tab with `rel="noopener noreferrer"`. Images must use
  an absolute `https` URL. Everything else is removed on save: scripts,
  styles, `style`/`class`/`id` and `on*` attributes, iframes, forms, SVG and
  MathML, and `javascript:` or `data:` URLs. Text that only looks like a tag,
  such as `<customer name>`, is kept as text.
- **In the app**, task detail, the assigned-task details panel and the
  workflow test runner render the formatted description. Task cards, the
  queue and the timesheet notes column show a plain-text excerpt. The
  **New task** form has an "HTML supported" hint and a **Preview** toggle.
- **REST:** task responses (`GET /tasks`, `/tasks/assigned`, `/tasks/{id}`
  and `PATCH /tasks/{id}`) keep `description` as stored and add
  `description_text`, a plain-text version. Add `?strip_html=true` to the
  three `GET` endpoints to get plain text in `description` itself.
- **MCP:** `tasks_get` returns `description_text` and takes
  `strip_html: true`. `tasks_create` and `tasks_update` accept HTML.
- **CLI:** `usertasks tasks list | assigned | get` send `strip_html=true`,
  and every `tasks` command converts any HTML description in its output to
  plain text. Pass `--html` to see the stored HTML.
- **Workflows:** a User Task `task_description` may be an HTML template.
  Values interpolated into it are HTML-escaped, so a variable cannot add
  markup. In a plain-text template, values are inserted unchanged unless they
  contain `<`. `user_task_description` is now the plain-text version (for
  notification text bodies). The new `user_task_description_html` holds the
  HTML for HTML email bodies.

## Behaviour changes

- Every description write is sanitised: the task form, inline edits,
  `PATCH /tasks/{id}`, `POST /tasks/ingest` (including subtasks),
  `tasks_create`, `tasks_update`, User Task nodes and `update_task` nodes.
  If an existing integration sends HTML that uses non-allowlisted markup,
  that markup is removed.
- In a plain-text User Task template, a value containing `<` is now stored
  escaped (`&lt;`). `description_text` and the app show the original text.
- The default assignment notification body, and `{{user_task_description}}`
  in notification templates, are plain text even when the description is
  HTML.

No migration is needed.
