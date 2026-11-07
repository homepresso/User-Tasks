# Release notes: form banners and questions

"Show a message" on forms can now be a banner at the top of the form with a
tone, a title and a choice of how long it stays. A new action, "Ask a
question", shows OK / Yes / No (or your own) buttons, and each answer runs
its own actions. Existing forms are unchanged: a message saved before this
release keeps its original inline look, and nothing is migrated.

## What's new

- **Banners.** **Show a message** (form rules and Button steps) has
  **Where it shows**: a **banner at the top of the form** (the default for
  new messages) or **inline**. Banners stack at the top, stick while a long
  form scrolls, and keep focused inputs clear of them. At most three show at
  once; older ones collapse.
- **Tone, title and duration.** Info, success, warning or error, with an
  icon and theme colours for light, dark and form themes. An optional title.
  The banner stays **until dismissed**, **auto-hides after 2–60 seconds**
  (paused while hovered or focused), lasts **until the next action**, or
  **stays**. Text and title take `{{form.x}}`, `{{event.*}}`, `{{user.*}}`
  and flag placeholders.
- **Ask a question.** A new action (Rules → **Messages**, and a Button's
  On click). It shows as a **banner with buttons** or a **dialog**, with
  **OK**, **OK / Cancel**, **Yes / No**, **Yes / No / Cancel** or **custom
  buttons** (label, value, style). Each answer has its own **If … →**
  actions and a **Then continue with the next steps** switch. The actions
  after the question wait for the answer. OK and Yes continue by default;
  No, Cancel and closing the question stop the rest unless you map them.
  **Escape** answers Cancel (else No), or a response you pick.
- **Before submit: "Are you sure?"** Yes lets the submission go on and No
  stops it. On a button: "Delete the selected rows?" Yes → **Apply table
  changes**.
- **"A question is answered" event.** Name a question, and rules can react
  to `{{event.response}}` (with `event.message` and `event.label`). The
  Rules tab shows each question's branches in the rule summary.
  **Test a rule** can simulate an answer and shows which branch runs.
- **Accessible.** Banners use `role="status"`, or `role="alert"` for
  warnings and errors. Questions are `alertdialog`s: focus goes to the first
  button, a dialog keeps focus inside, Escape answers, and focus returns
  afterwards. The accessibility checker warns about auto-hide under 5
  seconds and about questions with no title or text.

## Security

- Questions are browser-only. A server step after an answer (an API call, a
  workflow, table changes) is looked up in the **saved** form by rule (or
  button), the question's position, the answer and the step's position. A
  forged "yes", an unknown answer or a step that isn't a server step reaches
  nothing. Validation and Before-submit blocks are still checked on the
  server at submit.
- What an answer's actions can show, hide or flag counts toward the form
  state the server accepts, the same way a button's actions do, and no
  further.

## Compatibility

- Stored on the actions in `layout.rules` and on Buttons:
  - `message`: `style`, `tone`, `title`, `duration`, `seconds`
  - `prompt`: `{ id, display, preset, buttons [{ value, label, style, then, continue }], escape }`

  Versions, exports, packages, the REST API, MCP and the CLI carry them.
  Older readers ignore them. No migration.
- A message without `style` renders exactly as before.
- The rule-action and table-changes endpoints take an optional
  `branch: { response, index }` for a step inside an answer.
- See [Forms → Messages and questions](/docs/tasks/forms#messages-and-questions).
