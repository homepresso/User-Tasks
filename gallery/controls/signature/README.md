# Signature

`<ut-signature>` — a signature pad. People sign with a finger, pen or mouse (or type their name),
press **Use this signature**, and a trimmed PNG is saved with the form's attachments.

## Value

Type `files`: an array with one stored file, `[{ "id", "name", "size", "type" }]`
(`signature.png`, `image/png`), or empty (`null`) before signing. The schema allows at most one
item. Read-only views (completed tasks, emails, mobile) list the file name; the form shows the
image with a "Signed" badge.

The upload happens when the person presses **Use this signature**, presses Enter in the typed
name, or leaves the control with ink on the pad. **Sign again** clears the value and shows an
empty pad.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Ink colour (`pen_color`) | colour | dark ink on white; the theme's text colour on transparent | |
| Background (`background`) | White / Transparent | White | The saved PNG's background. Transparent images with light ink (dark mode) are hard to see on white paper |
| Pad height (`height`) | number 100–480 | 180 | px |
| Allow a typed signature (`allow_typed`) | yes / no | yes | "Type your name instead": drawn in a handwriting font |
| Prompt (`prompt`) | text | Sign above | Under the signing line |

## Keyboard and screen readers

The control is a group named by the field label. The drawing area is an image (`role="img"`)
whose name says whether ink is present. Keyboard users choose **Type your name instead**, type and
press Enter. Undo, Clear, Use this signature and Sign again are ordinary buttons; upload errors
are announced (`role="alert"`). The canvas sets `touch-action: none` so drawing never scrolls the
page, scales for the device pixel ratio and keeps the strokes when the width changes.

## Capabilities

`files`: uploads the PNG with `request('upload')` (the host's Attachments pipeline and its limits)
and reads a stored signature back with `request('file')` to show it (only the control's own value).
No network access.

Bundles Lit 3.3.3 (BSD-3-Clause) and signature_pad 5.1.4 (MIT).
