# Release notes: the form Submitted page

Forms can now end on a **Submitted page**, a confirmation that replaces the
form once it is sent. It has a success icon, a heading and subheading, an
optional summary of answers, and **Submit another response** / **Close form**
buttons. It is optional and off by default. Existing forms are unchanged and
nothing is migrated.

## What's new

- **Buttons & header → Submitted page.** Turn on **Show a submitted page**,
  then pick a success icon (check circle, party, mail sent, calendar check,
  thumbs up, clipboard check and more), upload an image, or choose none.
  Icons use the theme's success or primary colour, or a custom colour.
- **Placeholders.** The heading, subheading and note take `{{form.x}}`,
  `{{param.x}}`, `{{var.x}}`, `{{submission_id}}` and `{{run_reference}}`.
  The variable picker lists them.
- **Summary of answers.** Tick the fields to list under the subheading.
- **Submit another response** opens a fresh form and keeps the link's
  parameters. **Close form** goes back to the Home dashboard (My Tasks until
  Home is available). In the Run dialog it closes the dialog. Both buttons can
  be turned off or relabelled.
- **Accessible and responsive.** A centred card in the form theme, light or
  dark, that works on phones. The heading takes focus and the text is
  announced. The entrance animation respects reduced motion. The
  accessibility checker gains a **submitted-page** rule: a missing heading,
  or an uploaded image without alt text.

## How it fits with what exists

A button's **Redirect** wins, then an explicit **Close form**, then the
button's own **Show success screen**, then the Submitted page. Messages and
After-submit rules still run, and their messages show on the page. **Task
forms don't show it**, because completing the task already moves on. The
designer's Preview, `/f/<id>` pages and the Run dialog do.

## Portability

The page is stored on the form layout (`layout.submitted_page`), so versions,
export / import, packages, the API, MCP, the CLI and config as code carry it.
An uploaded image travels with the form as bytes, like the header image. The
submit API returns the page as `effects.success_screen` with `source: "form"`.

## Gallery

**Event registration** (1.1.0) and **Event registration with sessions**
(1.1.0) now end on a Submitted page.
