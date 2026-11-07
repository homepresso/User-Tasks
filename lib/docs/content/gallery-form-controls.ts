import type { DocPageDef } from '../types'
import { GALLERY_CONTROLS } from '@/lib/gallery/site'
import type { ControlCatalogItem } from '@/lib/gallery/catalog'

const CAPABILITY: Record<string, string> = {
  lookup: 'lookups (the field\'s lookup source, called by the server)',
  reports: 'saved reports (the report the designer picks, run as the viewer)',
  files: 'files (uploads to Attachments; reads files the form already has)',
  network: 'network (declared hosts, after an admin approves them)',
}

function cell(text: unknown): string {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

function propDefault(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.length > 3 ? `${value.slice(0, 3).join(', ')}, …` : value.join(', ')
  if (typeof value === 'object') return 'JSON'
  return String(value)
}

/** What \`{{form.<key>}}\` holds, and the sibling outputs. */
function outputLine(item: ControlCatalogItem): string {
  const o = item.output
  if (!o) return ''
  const main = o.html ? 'sanitised HTML' : o.template ? `text \`${o.template}\`` : o.primary ? `\`${o.type}\` (\`value.${o.primary}\`)` : `\`${o.type}\``
  const choices = o.choices && o.choices.length > 1 ? ` — or, as the form chooses, ${o.choices.slice(1).map((c) => c.label.toLowerCase()).join(', ')}` : ''
  const extras = Object.keys(o.extras ?? {}).map((s) => `\`<key>_${s}\``)
  const raw = (o.primary || o.template) && (item.value.type === 'json' || item.value.type === 'array') ? ['\`<key>_raw\` (the whole value)'] : []
  const also = [...extras, ...raw]
  return `\n\n**Workflow output:** \`{{form.<key>}}\` is ${main}${choices}.${also.length ? ` Also ${also.join(', ')}.` : ''}`
}

function valueShape(item: ControlCatalogItem): string {
  const schema = item.value.schema
  if (item.value.type === 'json' && schema?.properties) return `\`{ ${Object.keys(schema.properties).join(', ')} }\``
  if (item.value.type === 'array' && schema?.items?.properties) return `\`[{ ${Object.keys(schema.items.properties).join(', ')} }]\``
  if (item.value.type === 'files') return '`[{ id, name, size, type }]` (Attachments)'
  return `\`${item.value.type}\``
}

/** One section per official control, from the gallery catalog (built from gallery/controls). */
function reference(): string {
  const singles = GALLERY_CONTROLS.filter((c) => c.kind === 'form_control')
  if (!singles.length) return '\nThe list appears here once the gallery is built (`npm run gallery:build`).\n'
  const summary = [
    '| Control | Element | Value | Uses | Bundled libraries |',
    '|---|---|---|---|---|',
    ...singles.map((c) => {
      const item = c.controls[0]
      const libs = item.libraries.filter((l) => !l.name.startsWith('@lit/') && !l.name.startsWith('lit-')).map((l) => `${l.name} ${l.version} (${l.licence})`).join(', ')
      return `| [${cell(c.title)}](/gallery/controls/${c.slug}) | \`<${item.tag}>\` | ${valueShape(item)} | ${item.capabilities.length ? item.capabilities.join(', ') : '—'} | ${cell(libs || '—')} |`
    }),
  ].join('\n')
  const sections = singles.map((c) => {
    const item = c.controls[0]
    const props = item.props.length
      ? ['| Property | Type | Default | |', '|---|---|---|---|', ...item.props.map((p) => `| ${cell(p.label ?? p.name)} (\`${p.name}\`) | ${p.type === 'select' ? cell((p.options ?? []).map((o) => (typeof o === 'string' ? o : o.value)).join(' / ')) : p.type} | ${cell(propDefault(p.default))} | ${cell(p.description ?? '')} |`)].join('\n')
      : 'No properties.'
    const context = item.context.length ? `\n\n**Context** (other fields it reads, mapped in the designer): ${item.context.map((x) => `\`${x.name}\`${x.label ? ` (${x.label})` : ''}`).join(', ')}.` : ''
    const caps = item.capabilities.length ? item.capabilities.map((x) => CAPABILITY[x] ?? x).join('; ') : 'none — fully sandboxed'
    const hosts = item.hosts.length ? ` Hosts: ${item.hosts.map((h) => `\`${h}\``).join(', ')}.` : ''
    const display = item.display?.template ? `\`${item.display.template}\`` : item.display?.format ? `the value as ${item.display.format}` : 'the value'
    return `### ${c.title}

\`<${item.tag}>\` ${item.version} — ${cell(c.summary)}

**Value:** ${valueShape(item)} (type \`${item.value.type}\`). Read-only views show ${display}.${outputLine(item)}

**Capabilities:** ${caps}.${hosts}

**Keyboard:** ${cell(item.accessibility?.keyboard ?? '')}${context}

${props}

Setup after installing: ${c.setup.map((s, i) => `(${i + 1}) ${s}`).join(' ')}`
  }).join('\n\n')
  return `${summary}\n\n${sections}\n`
}

/** Official gallery form controls: placed after Custom form controls in TASK_PAGES. */
export const GALLERY_FORM_CONTROLS_PAGE: DocPageDef = {
  slug: 'tasks/gallery-form-controls',
  title: 'Gallery form controls',
  description: 'The official form controls in the gallery — chart, saved report, address search (Google Places), map, signature, rating, slider, rich text, editable table, Likert matrix, progress, info card and PDF viewer: install, properties, values, capabilities and security.',
  get body() {
    return `
The [gallery](/gallery/controls) has **official form controls**: ready-made [custom form controls](/docs/tasks/custom-form-controls) built and signed by the UserTasks team. Each is a web component (Lit, bundled into one ES module with every library it uses) that installs into **Extensibility → Form controls** and appears in the form designer's palette under **Custom**.

They follow the same contract and sandbox as your own controls: a frame with an opaque origin and a strict Content-Security-Policy, the field's label as the accessible name, the form theme as \`--ut-*\` tokens in light and dark, full keyboard operation, a text formatter for read-only views (completed tasks, mobile, emails) and a value the server validates against the control's schema.

## Install

- **In the app:** **Extensibility → Form controls → Browse gallery** opens **Packages → Browse gallery** on the **Form controls** tab. Choose **Install**: the wizard verifies the package (checksum, file hashes, signature) and shows what it adds. The control lands enabled; versions installed from the signed gallery show **Signed package** with the signer's fingerprint.
- **Starter pack:** *Form controls starter pack* installs every control in one go.
- **By file or CLI:** download the \`.utpkg\` from the control's page, drag it onto **Govern › Packages**, or \`usertasks packages install form-control-<name>-<version>.utpkg\`.

**Ready-made processes:** workflow packages in the gallery that use these controls ship them too — the [Surveys & Assessments](/gallery?category=surveys-assessments) packages (customer satisfaction and NPS, employee pulse, training quiz with certificate, site inspection), event registration with session choices and contract and policy review with internal e-sign. Installing one adds the controls with the forms, workflows, data tables and saved reports that use them; each control's page lists them under **Used in**.

Then drag the control onto a form, set its properties in the properties panel and map its **context** fields (other fields of the same form it reads, such as the address a map shows). Its value flows downstream like any field: \`{{task_data.<key>}}\` on task forms, \`{{form.<key>}}\` on form pages and the **Form submitted** trigger.

## Capabilities and security

A control can only use the host services its manifest declares **and** the host grants:

| Capability | What the control can do | Granted when |
|---|---|---|
| \`lookup\` | Ask for suggestions (\`lookup\` request). The server runs the field's lookup source — a data table, or an API reference with credentials stored on the server. | The field has a lookup source configured. |
| \`reports\` | Ask for the rows of a saved report (\`report\` request). The report is the field's \`report_id\`, **read by the server from the stored form** — a control cannot choose another one. It runs as the person filling in the form: only their own or shared reports, with their permissions and row-level security. | The field has a report chosen. |
| \`files\` | Upload files to Attachments (\`upload\`), and read the bytes of files the form already gives it (\`file\`): its own value, or an Attachments field mapped as context. Reads go through the user's own session. | The form can store files (not in the designer preview). |
| \`network\` | Fetch from the hosts listed in its manifest; with \`tile.openstreetmap.org\` approved, also ask for map tiles (\`tile\`), fetched and cached by the server. | An administrator approves the hosts in **Extensibility → Form controls**; until then the frame's CSP blocks every request and the server refuses tiles. |

### Address search and Google Places

The address control **never holds an API key**. It sends what the person types to the UserTasks server as a lookup; the server calls **Places API (New) Text Search** through an API reference whose key is stored encrypted in an integration, and returns only the configured fields (formatted address, address components, location). A browser key would be exposed to anyone using the form — and a sandboxed control frame has an opaque origin and sends no referrer, so an HTTP-referrer-restricted key could not work there anyway.

The package ships the integration (*Google Places API (New)*, API key header \`X-Goog-Api-Key\`), the API reference (\`POST /v1/places:searchText\` with a field mask) and a sample form (*Address and location (sample)*) with the address control wired to the reference and a map showing the result. The install asks for the API key. Restrict the key to the Places API (New) in the Google Cloud console; set a quota. Any other address source works too: point the field's lookup at your own API reference or a data table of sites — the control understands Google's new and legacy shapes and plain \`street\` / \`city\` / \`postcode\` / \`lat\` / \`lng\` fields.

### Map tiles

The map control shows OpenStreetMap tiles once an administrator approves \`tile.openstreetmap.org\` for it (dimmed to match dark mode), and always shows the attribution. Public tile servers refuse requests without a referrer — which a sandboxed frame never sends — so the control asks the host for each tile (a \`tile\` request): the UserTasks server fetches it with an identifying User-Agent and Referer, caches it (7 days), rate-limits per user, and serves it only for controls with the host approved. The OpenStreetMap Foundation's tile servers are for light use under their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/); for heavy use, fork the control for a commercial or self-hosted tile server.

### Licences

Every control is Apache-2.0. Bundled libraries are permissive only and pinned to exact versions: Lit (BSD-3-Clause), Chart.js (MIT), Leaflet (BSD-2-Clause), pdf.js (Apache-2.0), signature_pad (MIT); their licence notices stay in the module. The build refuses any other licence.

## Reference
${reference()}

## Sources and contributing

The sources are in the repository's \`gallery/controls\` folder — one folder per control (\`manifest.json\`, \`src/\`, \`gallery.json\`, \`README.md\`, the built module in \`dist/\`). \`npm run build\` there bundles them, \`npm test\` runs the contract tests in headless Chrome (render, light and dark, read-only, axe-core WCAG 2.1 AA, 360 px mobile, keyboard and values), and \`npm run gallery:build\` packages and signs them with the rest of the gallery.
`
  },
}
