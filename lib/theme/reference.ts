/**
 * Theme reference: every setting a form theme, the workspace theme or the
 * form sign-in page accepts, generated from the zod schemas that validate
 * them (FormThemeOverridesSchema, WorkspaceThemeSchema,
 * formSignInSettingsSchema) — key, type, allowed values / range, what an
 * unset key means and what it affects. The Agent's theme_reference tool
 * (lib/assistants/tools/theme-reference.ts) returns it, and its write tools
 * check payloads with checkThemePayload before showing a confirmation card.
 *
 * Help texts live on the schemas (`.meta({ description, when_unset })`), so
 * a new key shows up here as soon as it is accepted.
 */
import { z } from 'zod'
import { FormThemeOverridesSchema, FormThemeRefSchema, overridesFromPreset, blockingFormThemeIssues } from '@/lib/forms/form-theme'
import { formSignInSettingsSchema } from '@/lib/api-schemas/form-sign-in-page'
import { SIGN_IN_DESIGNS, DEFAULT_SIGN_IN_SETTINGS, isSupportLinkUrl } from '@/lib/forms/sign-in-page'
import { CURATED_FONTS, SYSTEM_FONT_STACKS } from './fonts'
import { THEME_TEMPLATES, WORKSPACE_SHADOW_PRESETS } from './presets'
import { WorkspaceThemeSchema } from './schema'
import { defaultFormAnimation, defaultSubmittedPage } from '@/lib/forms/success-defaults'
import { SUBMITTED_PAGE_ICONS } from '@/lib/forms/submitted-page'

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON Schema walking */

export type ThemeScope = 'form' | 'workspace' | 'sign_in'
export const THEME_SCOPES: readonly ThemeScope[] = ['form', 'workspace', 'sign_in']

export interface ThemeSetting {
  /** Dotted path; `{light|dark}` stands for sibling keys with the same settings. */
  key: string
  type: string
  values?: Array<string | number | boolean>
  range?: string
  /** What an unset key means (optional keys). */
  when_unset?: string
  required?: boolean
  affects?: string
}

const META_KEYS = new Set(['description', 'when_unset', 'format', 'unit', 'note'])
function shapeKey(node: any): string {
  return JSON.stringify(node, (k, v) => (META_KEYS.has(k) ? undefined : v))
}

function isFontUnion(options: any[]): boolean {
  return options.length > 0 && options.every((o) => o?.type === 'object' && o.properties?.source)
}

function typeOf(node: any): Omit<ThemeSetting, 'key'> {
  if (Array.isArray(node.enum)) return { type: 'enum', values: node.enum }
  if (node.const !== undefined) return { type: 'const', values: [node.const] }
  if (node.format === 'color') return { type: 'colour', range: '#rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla()' }
  if (node.format === 'box-shadow') return { type: 'box-shadow', range: '`none` or comma-separated layers of 2–4 lengths (px/rem/em), optional `inset` and one colour; no url(), var(), quotes or semicolons' }
  if (node.type === 'integer' || node.type === 'number') {
    const min = node.minimum ?? node.exclusiveMinimum
    const max = node.maximum ?? node.exclusiveMaximum
    const unit = node.unit ? ` ${node.unit}` : ''
    return { type: node.type, ...(min !== undefined || max !== undefined ? { range: `${min ?? '…'}–${max ?? '…'}${unit}${node.note ? ` (${node.note})` : ''}` } : {}) }
  }
  if (node.type === 'string') return { type: 'text', ...(node.maxLength ? { range: `up to ${node.maxLength} characters${node.pattern === '^[^<>{}]*$' ? ', no < > { }' : ''}` } : {}) }
  if (node.type === 'boolean') return { type: 'boolean' }
  if (node.type === 'array') {
    const inner = typeOf(node.items ?? {})
    return { type: `array of ${inner.type}`, range: [node.minItems !== undefined ? `${node.minItems}` : '', node.maxItems !== undefined ? `${node.maxItems}` : ''].filter(Boolean).join('–') + ' items' }
  }
  return { type: String(node.type ?? 'value') }
}

/** Flatten a JSON Schema into settings (leaves), merging sibling objects with the same shape. */
function walk(node: any, path: string, out: ThemeSetting[], ctx: { required: boolean; inherited?: string }) {
  if (!node || typeof node !== 'object') return
  const desc: string | undefined = node.description ?? undefined
  // Nullable (anyOf [x, null]).
  const options: any[] | undefined = node.oneOf ?? node.anyOf
  if (options) {
    if (isFontUnion(options)) {
      out.push({ key: path, type: 'font', range: '{ source: "google", family } (a curated family: see fonts) or { source: "system", family: ' + Object.keys(SYSTEM_FONT_STACKS).map((f) => `"${f}"`).join(' | ') + ' }', ...(ctx.required ? { required: true } : {}), ...(node.when_unset ? { when_unset: node.when_unset } : {}), ...(desc ?? ctx.inherited ? { affects: desc ?? ctx.inherited } : {}) })
      return
    }
    const nonNull = options.filter((o) => o?.type !== 'null')
    if (nonNull.length === 1) {
      walk({ ...nonNull[0], description: desc ?? nonNull[0].description, when_unset: node.when_unset ?? nonNull[0].when_unset, nullable: true }, path, out, ctx)
      return
    }
  }
  if (node.type === 'object' && node.properties) {
    const required = new Set<string>(node.required ?? [])
    const entries = Object.entries<any>(node.properties)
    const groups = new Map<string, string[]>()
    for (const [k, v] of entries) {
      if (v?.type === 'object' && v.properties) {
        const sk = shapeKey(v)
        groups.set(sk, [...(groups.get(sk) ?? []), k])
      }
    }
    const done = new Set<string>()
    for (const [k, v] of entries) {
      if (done.has(k)) continue
      const same = v?.type === 'object' && v.properties ? groups.get(shapeKey(v)) ?? [k] : [k]
      same.forEach((x) => done.add(x))
      const seg = same.length > 1 ? `{${same.join('|')}}` : k
      const childPath = path ? `${path}.${seg}` : seg
      // Merged siblings: each one's own text ("light: …; dark: …").
      const joined = (field: 'description' | 'when_unset'): string | undefined => {
        const texts = same.map((x) => node.properties[x]?.[field]).filter(Boolean)
        if (!texts.length) return undefined
        return new Set(texts).size === 1 ? texts[0] : same.map((x) => `${x}: ${node.properties[x]?.[field] ?? '—'}`).join(' ')
      }
      const vDesc = joined('description')
      const vUnset = joined('when_unset')
      if (v?.type === 'object' && v.properties && vDesc) {
        out.push({ key: childPath, type: 'object', ...(required.has(k) ? { required: true } : {}), ...(vUnset ? { when_unset: vUnset } : {}), affects: vDesc })
      }
      walk(v, childPath, out, { required: required.has(k), inherited: vDesc ?? desc ?? ctx.inherited })
    }
    return
  }
  const t = typeOf(node)
  out.push({
    key: path,
    ...t,
    ...(node.nullable ? { type: `${t.type} or null` } : {}),
    ...(ctx.required ? { required: true } : {}),
    ...(node.when_unset ? { when_unset: node.when_unset } : {}),
    ...(desc ?? ctx.inherited ? { affects: desc ?? ctx.inherited } : {}),
  })
}

/** Every setting a zod object schema accepts. */
export function settingsFromSchema(schema: z.ZodType): ThemeSetting[] {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  const out: ThemeSetting[] = []
  walk(json, '', out, { required: false })
  return out
}

/** `a.{b|c}.d` → [`a.b.d`, `a.c.d`]. */
export function expandKey(key: string): string[] {
  const m = key.match(/\{([^}]+)\}/)
  if (!m) return [key]
  return m[1].split('|').flatMap((alt) => expandKey(key.replace(m[0], alt)))
}

/** Every leaf path a zod object schema accepts, walked from the zod shapes (for tests and checks). */
export function zodLeafPaths(schema: any, prefix = ''): string[] {
  let s = schema
  while (s?._zod?.def && ['optional', 'nullable', 'default', 'pipe'].includes(s._zod.def.type)) s = s._zod.def.type === 'pipe' ? s._zod.def.in : s._zod.def.innerType
  if (s?._zod?.def?.type === 'object') {
    return Object.entries<any>(s._zod.def.shape).flatMap(([k, v]) => zodLeafPaths(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

const fontList = (includeMono: boolean) => ({
  google: CURATED_FONTS.filter((f) => includeMono || f.category !== 'mono').map((f) => `${f.family} (${f.category}${f.bundledVar ? ', bundled' : ''})`),
  system: Object.keys(SYSTEM_FONT_STACKS),
})

const presetList = () => THEME_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category }))

/** Settings no scope supports — so the Agent can say so plainly. */
const NOT_SUPPORTED = 'Custom CSS, raw box-shadow strings (forms), arbitrary web fonts or font URLs, animations beyond the form animation setting, per-field colours.'

export function themeReference(scope: ThemeScope): Record<string, unknown> {
  if (scope === 'form') {
    const example1 = { source: 'custom', overrides: { colors: { light: { accent: '#7c3aed', background: '#ffffff', text: '#1f1b2e', page: '#f4f1fb' }, dark: { accent: '#c4b5fd', background: '#1c1830', text: '#ece9f7', page: '#110e1f' } }, heading_font: { source: 'google', family: 'Fraunces' }, button_shape: 'pill', shadow: 'subtle', radius: 12 } }
    const example2 = { source: 'custom', overrides: { appearance: 'dark', field_style: 'filled', font: { source: 'google', family: 'Inter' }, shadow: 'medium', header: { enabled: true, title: 'Expense claim', banner_color: '#0f766e' } } }
    return {
      scope,
      how_to_apply: 'forms_update { form_id, theme } (or forms_create { …, theme }). theme is { source: "workspace" } (inherit), { source: "custom", overrides } (the settings below; send the WHOLE overrides object — it replaces the old one, so start from the form\'s current theme.overrides, read with forms_get detail: true) or { source: "saved", theme_id } (form_themes_list). Unknown keys are refused.',
      settings: settingsFromSchema(FormThemeOverridesSchema).map((s) => ({ ...s, key: `overrides.${s.key}` })),
      fonts: fontList(false),
      presets: { note: 'Built-in palettes. To start from one, copy its colours into overrides.colors and set base_preset to its id.', list: presetList().slice(0, 60), example: overridesFromPreset('lagoon') ?? undefined },
      dark_mode: 'colors.dark is the dark palette: shown when the viewer is in dark mode (appearance workspace / system) or always (appearance dark). Without it, dark mode keeps the workspace dark palette with the light accent.',
      success_page: {
        note: 'Not part of the theme (forms_create / forms_update layout). Forms you create get the animated thank-you page below by default; keep it unless the person asks otherwise. To turn it off: layout.submitted_page { enabled: false }; calmer motion: layout.animation { style: "none" } or omit animation (subtle); change the wording with heading / subheading.',
        default: { submitted_page: defaultSubmittedPage(), animation: defaultFormAnimation() },
        values: { 'animation.style': ['none', 'subtle (omit the key)', 'expressive'], 'animation.confetti': 'true (expressive only, success page)', 'submitted_page.icon': [...SUBMITTED_PAGE_ICONS, 'none'] },
      },
      workspace_level: 'Settings only the workspace theme has (every screen, every member): sidebar / top bar style and gradients, density of tables and navigation, mono font, status and chart colours, base font size, logos — theme_reference { scope: "workspace" }.',
      not_supported: NOT_SUPPORTED,
      examples: [example1, example2],
    }
  }
  if (scope === 'workspace') {
    return {
      scope,
      how_to_apply: 'workspace_theme_update { theme } with the WHOLE theme (edit the workspace_theme_get result: change only what was asked, keep everything else), or workspace_theme_apply_preset { preset_id }. Applies to every member immediately. Unknown keys are refused.',
      settings: settingsFromSchema(WorkspaceThemeSchema),
      fonts: fontList(true),
      presets: presetList(),
      shadow_presets: { note: 'The theme designer\'s elevation presets (Shape & elevation): copy one\'s value into shadows. Dark canvases use the platform elevation.', list: WORKSPACE_SHADOW_PRESETS.map((p) => ({ id: p.id, label: p.label, shadows: p.value })) },
      button_shapes: { square: 'shape.buttonRadius 0', rounded: 'shape.buttonRadius 6–10', pill: 'shape.buttonRadius 9999' },
      dark_mode: 'colors.dark is the dark palette; meta.mode auto shows it to members whose OS is dark, dark forces it for everyone.',
      not_supported: NOT_SUPPORTED,
      examples: [
        { change: 'Display headings in Fraunces, pill buttons, soft shadows', edit: { 'typography.display': { source: 'google', family: 'Fraunces' }, 'typography.headingFont': 'display', 'shape.buttonRadius': 9999, shadows: '(the Soft preset: shadow_presets)' } },
        { change: 'Follow each member\'s light / dark setting', edit: { 'meta.mode': 'auto' } },
      ],
    }
  }
  return {
    scope,
    how_to_apply: 'form_sign_in_page_update with only the keys that change ("" clears logo_url, support_link_url and accent_color). The page is the same for every form link in the workspace.',
    // Updates send only what changes: nothing is required.
    settings: settingsFromSchema(formSignInSettingsSchema).map(({ required: _r, ...s }) => s),
    designs: SIGN_IN_DESIGNS.map((d) => ({ id: d.id, name: d.name, description: d.description })),
    defaults: DEFAULT_SIGN_IN_SETTINGS,
    theming: 'The sign-in page has two looks: the UserTasks look with accent_color, or use_workspace_theme: true — the workspace theme\'s colours, fonts (incl. its display font), radius and light / dark mode. For heading fonts, button shape, shadows or a dark palette on the sign-in page, change the workspace theme and turn use_workspace_theme on.',
    not_supported: `${NOT_SUPPORTED} Per-page fonts, colours other than the accent, or a dark mode of its own (use design 8 "Dark elegant" or the workspace theme).`,
    examples: [{ design: 2, accent_color: '#0f766e', heading: 'Sign in to Acme forms' }, { design: 8, use_workspace_theme: true }],
  }
}

/** The settings keys of one scope, expanded (for tests and messages). */
export function themeSettingKeys(scope: ThemeScope): string[] {
  const ref = themeReference(scope) as { settings: ThemeSetting[] }
  return ref.settings.flatMap((s) => expandKey(s.key))
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.slice(0, 8).map((i) => {
    const at = i.path.join('.') || 'theme'
    if (i.code === 'unrecognized_keys') return `${at}: not a setting — ${(i as any).keys.map((k: string) => `“${k}”`).join(', ')} (unknown key)`
    return `${at}: ${i.message}`
  })
}

/**
 * Check a theme payload before the confirmation card. Returns the problems
 * (empty: valid). `form`: a theme reference ({ source, overrides? });
 * `workspace`: a whole WorkspaceTheme; `sign_in`: the update arguments.
 */
export function checkThemePayload(scope: ThemeScope, payload: unknown): string[] {
  if (scope === 'form') {
    const parsed = FormThemeRefSchema.safeParse(payload)
    if (!parsed.success) return issuesOf(parsed.error)
    return parsed.data.source === 'custom' ? blockingFormThemeIssues(parsed.data.overrides) : []
  }
  if (scope === 'workspace') {
    const parsed = WorkspaceThemeSchema.safeParse(payload)
    return parsed.success ? [] : issuesOf(parsed.error)
  }
  const p = (payload ?? {}) as Record<string, unknown>
  const update = formSignInSettingsSchema.partial().extend({
    logo_url: z.string().max(500).optional(),
    support_link_url: z.string().optional(),
    accent_color: z.string().optional(),
  }).strict()
  const parsed = update.safeParse(p)
  const out = parsed.success ? [] : issuesOf(parsed.error)
  if (typeof p.accent_color === 'string' && p.accent_color !== '' && !/^#[0-9a-f]{6}$/i.test(p.accent_color)) out.push('accent_color: must be #rrggbb (or "" for the default)')
  if (typeof p.support_link_url === 'string' && p.support_link_url !== '' && !isSupportLinkUrl(p.support_link_url)) out.push('support_link_url: must be https:// or mailto:')
  return out
}
