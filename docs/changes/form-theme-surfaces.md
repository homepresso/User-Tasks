# Release notes: form themes cover the whole form

A form's theme (the workspace theme or its mini theme) now styles the whole
form and what is around it, in light and dark mode.

- **Page background.** Standalone form pages, the frame of a task form and
  the designer preview draw the theme's page colour — or a gradient to a
  second colour — behind the form card.
- **More colours in the mini theme.** Page, input background, borders and
  primary buttons (from the accent unless set), plus button placement
  (right, left, full width).
- **Everything follows.** Header banner, inputs, focus rings and
  placeholders, help and error text, primary / secondary / danger buttons,
  the autocomplete list and chips, checkboxes, radios, native date pickers
  (light / dark), messages, the success screen and the Cancel
  confirmation.
- **Always legible.** Every text / background pair is raised to AA
  (4.5:1; 3:1 for borders and focus rings); a mid-tone background where
  neither white nor dark text passes is nudged. An audit test covers every
  built-in preset in both modes and random palettes and mini themes.

No migration; existing themes look as before.
