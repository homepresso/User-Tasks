# Form controls starter pack

Every official UserTasks form control in one package. After installing, each control is in
**Extensibility → Form controls** and in the form designer's **Custom** palette.

| Control | Element | Notes |
|---|---|---|
| Chart | `<ut-chart>` | Static data, another field, a lookup or a saved report |
| Saved report | `<ut-saved-report>` | Choose the report in the designer; people see only what they may see |
| Address search | `<ut-address>` | Needs a lookup source on the field (e.g. the Google Places reference from the Address search package) |
| Map | `<ut-map>` | An administrator approves the tile hosts in Extensibility → Form controls |
| Signature | `<ut-signature>` | Saved as a PNG in Attachments |
| Rating | `<ut-rating>` | |
| Slider | `<ut-slider>` | |
| Rich text | `<ut-rich-text>` | Sanitised HTML + plain text |
| Editable table | `<ut-table>` | Rows with typed, validated columns |
| Likert matrix | `<ut-likert>` | |
| Progress | `<ut-progress>` | Display only |
| Info card | `<ut-info-card>` | Display only |
| PDF viewer | `<ut-pdf-viewer>` | Shows a PDF from an Attachments field |

All controls are Apache-2.0 and run sandboxed. Details: https://usertasks.com/gallery/controls
