# Info card

`<ut-info-card>` — an info, success, warning, error or neutral callout, or a key / value card, that
can show up to six other form values. Display only.

## Value

Value type `string`, but the control never sets it: the field stays empty and nothing is stored.
Read-only views (completed tasks, emails) show the card's title.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Variant (`variant`) | Info / Success / Warning / Error / Neutral | Info | Colour, icon and the screen-reader prefix |
| Title (`card_title`) | text | "Before you approve" | May use `{{field1}}` … `{{field6}}` |
| Text (`body`) | long text | sample sentence | Plain text, line breaks kept, `{{field1}}` … `{{field6}}` replaced |
| Layout (`layout`) | Callout / Key / value | Callout | Key / value lists the mapped fields with labels |
| Field labels (`labels`) | list | — | Labels of field 1 … 6 for the key / value layout |
| Value format (`format`) | Automatic / As stored | Automatic | Automatic formats numbers and ISO dates for the reader's locale, Yes / No for booleans |
| Show icon (`show_icon`) | yes / no | yes | |

## Context

`field1` … `field6` ("Field 1" …): another field whose value the card shows as `{{field1}}` … .
Lists are joined with commas; choice objects show their label.

## Keyboard and screen readers

Nothing to operate. The card is `role="note"` (warning and error cards are `role="status"`, a
polite live region, so a change is announced) named by its title. The variant is read first from a
visually hidden prefix ("Warning: Over budget for Marketing"); the icon is decorative. Placeholders
are filled as text: HTML in values or in the text is shown, never interpreted.

## Capabilities

None: no network, lookups or files. Bundles Lit 3.3.3 (BSD-3-Clause). The warning colour uses
`--ut-warning` when the theme provides it (the theme has no warning token yet; the fallback amber
passes contrast in light and dark mode).
