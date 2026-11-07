# Release notes: form controls feel native, and give workflows plain values

Two pieces of user-testing feedback on custom form controls (the official
gallery controls and your own):

1. *"The custom form plugins load when on the form, which makes them look not
   native."*
2. *"Rich text is coming back as an object in the workflow."*

## Controls appear with the form

What people saw before: each control's area showed a spinner and "Loading
Rich text…", then collapsed to its minimum height, then grew to its real
height (CLS ≈ 0.05–0.09 on a six-control form), and in a dark form the
toolbars and table headers of controls were painted in the workspace's light
surface colour. Causes and fixes:

| Cause | Fix |
|---|---|
| A spinner and label until the control was ready | Gone. The part of the form holding controls appears once every visible control has painted — at most **1.5 s**; a control still loading after that shows the outline of an input (softly pulsing), never a spinner. |
| The frame runtime reported a height of 0 before the control existed, and the element rendered before its state arrived, then grew | The runtime now asks for its state first (`hello`), creates the element only once the module is defined **and** the value / theme / props are in, and reports its height and `ready` after the element's first update. |
| Heights reserved from the manifest only | The last measured height per control version, field and width is remembered (local storage) and reserved before the frame loads; the official controls' `size.default_height` now match their real height. |
| Theme sent after the handshake; mode mismatch between page and frame | The mode rides in the frame URL hash and the frame document declares `color-scheme: light dark`, so the frame canvas is transparent in both modes from the first paint (no white flash); the frame is created only once the field knows its theme. |
| Workspace colours that contradict a dark form card | Background tokens that are light in a dark form (and text tokens that are dark) are dropped, so the control's own dark colours apply. Input colours, border and radius now come from the same variables native inputs use. |
| The frame's 4 px inner padding made controls sit 4 px inside native inputs | The padding sits outside the field box: borders line up with the inputs above and below. |
| Controls on later steps / tabs loaded only when reached | Their frame documents are warmed in the background (hidden, equally sandboxed frames without a bridge channel, dropped once loaded). |
| Every frame request rebuilt and re-hashed the module (up to 2 MB) | The built document and its CSP hashes are cached per immutable version; responses carry a strong ETag and answer `304` to revalidation (after the same access checks). |

Measured on local Northwind, a form with rich text, rating, slider, Likert,
map and signature (Chrome, warm server): before — six "Loading…" spinners
visible for 75–260 ms, every control resizing once or twice, CLS 0.05–0.09;
after — no spinner, no resize visible, CLS 0.0005 (the remaining shift is not
from the controls), the fields area appearing once, complete, 80–110 ms
after the form card (≈ 220 ms with a cold browser cache).

**Unchanged on purpose:** the frame's CSP and sandbox are exactly as strict
as before (`script-src` hashes only, `connect-src 'none'` unless approved,
`sandbox allow-scripts`, `frame-ancestors 'self'`). The frame document keeps
`Cache-Control: private, max-age=300` — a long or immutable cache would let a
disabled control keep loading. Frames are never pooled or shared between
controls or forms: each instance has its own opaque-origin frame and channel,
so one control can never see another's value or context.

## Workflow outputs

Controls now declare what the workflow receives (`output` in the manifest):
a primitive main output, extras beside it, and the whole value under
`<key>_raw`. The server computes them from the validated value on every save
(HTML sanitised, text bounded to 200,000 characters, types coerced) — never
from what the frame claims. See
[Custom form controls → Outputs](/docs/tasks/custom-form-controls#outputs-what-the-workflow-receives).

| Control (1.1.0) | `{{form.<key>}}` | Also |
|---|---|---|
| Rich text | sanitised HTML (or plain text — **Workflow output** in the field's properties) | `<key>_text`, `<key>_raw` (`{ html, text }`) |
| Address search | the formatted address | `<key>_parts` (street, city, …), `<key>_raw` |
| Map | `"lat,lng"` | `<key>_lat`, `<key>_lng` (numbers), `<key>_raw` |
| Chart (selectable points) | the picked point's label | `<key>_value`, `<key>_series`, `<key>_raw` |
| Rating, Slider, Progress | a number | — |
| Info card | text (display only) | — |
| Likert | an object: one number per statement | — |
| Editable table | the list of rows | — |
| Saved report (selectable rows) | the picked row (object) | — |
| Signature, PDF viewer | the file list (like Attachments) | — |

## Upgrade and compatibility

- **Nothing changes for existing forms** until they are upgraded: a field
  keeps the control version it was placed with, and versions without
  `output` behave exactly as before.
- After upgrading a field (properties → Version → Upgrade to 1.1.0), paths
  written for the old object keep working: `{{form.desc.text}}` /
  `{{form.desc.html}}` continue in `desc_raw` when `desc` is now text. Prefer
  `{{form.desc_text}}` / `{{form.desc}}` in new work.
- The six "No integrations needed" packages (CSAT / NPS, Employee pulse,
  Training quiz, Site inspection, Event registration, Contract and policy
  review) are 1.1.0 (Event registration 1.2.0): their forms use the 1.1.0 controls and their workflows
  and emails read `<key>_text` instead of `<key>.text`.
- Custom controls you build: add `output` to the manifest (the upload checks
  it against the value type; the starter kit's checks do too) and upload a
  new version.
- No database migration. Deploy, then re-sign and publish the gallery build
  (the official controls and packages changed).
