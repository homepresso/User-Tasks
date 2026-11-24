import { z } from 'zod'

/**
 * The app spec as a tool / endpoint INPUT (pure, light: no service imports).
 *
 * Deliberately loose: the strict check is lib/apps/spec.ts compileAppSpec,
 * which answers with plain-language errors ("widget 2 (chart) › group_by:
 * use one of …") instead of a raw schema rejection — so a model can fix its
 * spec in one round. The descriptions carry the format.
 */

export const BUILDER_SEARCH_KINDS = ['workflow', 'form', 'table', 'report', 'team', 'user', 'role', 'agent', 'reference', 'page', 'column', 'view'] as const

const json = z.record(z.string(), z.unknown())

export const APP_SPEC_SHAPE = {
  app_id: z.string().max(80).optional().describe('An existing app (id or slug) to change. Omit to create a new app (then app.name is required).'),
  app: json.optional().describe('App settings: { name, slug?, subtitle?, description?, icon? (lucide name), color? (#rrggbb, only when asked), nav? { style: tabs | top | sidebar | drawer | bottom | mega | none, header_style?, density? }, menu? [entries], params?, variables?, rules?, style? }. For an existing app: only what changes.'),
  pages: z.array(json).max(30).optional().describe('Pages in menu order. New page: { title, icon?, slug?, hidden?, min_role? viewer | contributor | editor, template? (starter template id), filters? [{ id, kind: user | team | form | workflow | table | date_range | status | text, label, default? }], widgets: [{ type, title?, w? 1–12, h?, config?, style?, id? }], params?, variables?, rules? }. Existing page: { page: "<slug or id>", title?, filters?, widgets? (replaces all) OR add_widgets [{ …widget, after? | before? | at? start | end }], update_widgets [{ id, config? (merged; null removes a key), replace_config?, w?, h?, title?, style?, move? { after | before | at } }], remove_widgets ["<id>"] } (applied in that order: remove, then update / move, then add). The first page of a new app is its home page. Widget config schemas: apps_spec_reference { widget_types } or apps_widget_types.'),
  delete_pages: z.array(z.string().max(80)).max(30).optional().describe('Existing pages (slugs or ids) to delete'),
  page_order: z.array(z.string().max(80)).max(30).optional().describe('Page slugs in menu order, first to last'),
  audience: z.array(json).max(500).optional().describe('Who may open the app (replaced): [{ type: user | team | role, id, role: viewer (read-only) | contributor (may use submit / start / claim buttons) }]'),
  editors: z.array(z.string().max(64)).max(50).optional().describe('User ids who may edit the app (replaced)'),
  publish: z.boolean().optional().describe('Changes are saved to the app\'s DRAFT (its audience keeps seeing the published version until someone publishes). true: publish straight after applying — only when the person explicitly asked to make it live now.'),
  publish_note: z.string().max(1000).optional().describe('With publish: the version note (what changed)'),
}

export const appSpecInputSchema = z.object(APP_SPEC_SHAPE)
