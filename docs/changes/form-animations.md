# Release notes: Form animations

Forms now move a little as people use them. The card rises in and the fields
follow. Steps slide in the direction of travel, and messages and errors ease
in. Each form chooses how much in **Buttons & header → Appearance →
Animation**. Nothing is migrated (no database change).

## What's new

- **Animation style** for each form:
  - **None**: nothing moves;
  - **Subtle** (the default): short fades and small rises, about a third of
    a second in all;
  - **Expressive**: more movement and a springier feel. You can also tick
    **Confetti on the Submitted page** for a light burst on success-coloured
    pages.
- **What animates:**
  - the form loading: the card first, then the fields row by row; a form
    with more than 20 fields comes in as one block;
  - step and tab changes, plus the progress bar filling;
  - lazy parts (When to load): the skeleton, then the controls fading in;
  - fields shown or hidden by rules, and sections opening and closing;
  - banners and questions;
  - validation errors: a gentle shake on the field and the error text
    fading in;
  - buttons: a press state and a spinner on the button that is submitting;
  - the Submitted page: the icon pops in (Expressive also draws it in), then
    the heading;
  - Data table rows on load and on a page change;
  - custom control frames fading in at the form's pace.
- **Replay animation** in the designer's Preview.

## Existing forms

Existing forms get **Subtle**, like new ones. Subtle only fades things and
moves them by a few pixels. Once the form has settled, nothing is a
different size or in a different place. Choose **None** to turn animations
off for a form.

## Accessibility and performance

- **Reduced motion is respected.** With the device's reduced-motion setting
  on, every style becomes a plain fade: nothing slides, shakes, grows or
  bursts.
- **Nothing waits for an animation.** Fields can be used from the first
  frame, and focus moves exactly as it did before.
- **No layout jank.** Only opacity and transforms animate. The one exception
  is the height of a collapsing row, which uses the CSS grid-rows technique.
  Nothing is measured in script, and no animation library was added.

## API

`layout.animation` stores the setting: `{ "style": "none" | "expressive",
"confetti": true }`. Leave it out for Subtle. It goes with versions, export,
packages, the API, MCP and the CLI.
