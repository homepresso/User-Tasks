/**
 * theme_reference: every setting a form theme, the workspace theme or the
 * form sign-in page accepts — key, type, allowed values or range, what an
 * unset key means, what it affects, the presets and fonts, and valid example
 * payloads. Generated from the schemas that validate the writes
 * (lib/theme/reference.ts), like workflow_node_reference is from the node
 * catalog, so the Agent never guesses a key that the save then refuses.
 *
 * The theme write tools check their payload with themeCheckError before the
 * confirmation card (designer.ts forms_*, admin.ts workspace_theme_update /
 * form_sign_in_page_update): an invalid payload goes back to the model to
 * correct, so the person never sees a card that would fail.
 */
import { checkThemePayload, themeReference, THEME_SCOPES, type ThemeScope } from '@/lib/theme/reference'
import type { AssistantToolDef } from '../engine'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

export const THEME_REFERENCE_TOOL = 'theme_reference'

/** Prefix of the error a theme write returns when its payload doesn't validate (the model corrects it). */
export const THEME_CHECK_PREFIX = 'Theme check before showing this to the person'

/** Tools that write a theme, and the scope their payload is checked against. */
export const THEME_WRITE_SCOPES: Record<string, ThemeScope> = {
  forms_create: 'form',
  forms_update: 'form',
  form_themes_create: 'form',
  form_themes_update: 'form',
  workspace_theme_update: 'workspace',
  form_sign_in_page_update: 'sign_in',
}

/** The theme payload in a write's arguments (null: the write doesn't touch the theme). */
export function themePayloadOf(tool: string, args: Record<string, any>): { scope: ThemeScope; payload: unknown } | null {
  const scope = THEME_WRITE_SCOPES[tool]
  if (!scope) return null
  const parse = (v: unknown) => { if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return v } }
  if (tool === 'form_themes_create' || tool === 'form_themes_update') return args.overrides === undefined ? null : { scope, payload: { source: 'custom', overrides: parse(args.overrides) } }
  if (scope === 'form') return args.theme === undefined ? null : { scope, payload: parse(args.theme) }
  if (scope === 'workspace') return { scope, payload: parse(args.theme) }
  return { scope, payload: args }
}

/**
 * The error to send back for an invalid theme write, or null when it is
 * valid. `attempt` counts the failed checks of this tool in the request: from
 * the second on, the model is told to drop what isn't supported and say so.
 */
export function themeCheckError(tool: string, args: Record<string, any>, attempt = 1): string | null {
  const found = themePayloadOf(tool, args)
  if (!found) return null
  const issues = checkThemePayload(found.scope, found.payload)
  if (!issues.length) return null
  const next = attempt > 1
    ? `Still not valid. Call ${tool} again with ONLY settings listed by ${THEME_REFERENCE_TOOL} { scope: "${found.scope}" } — drop anything unsupported — and tell the person plainly which part they asked for isn't available and the closest supported option.`
    : `Call ${THEME_REFERENCE_TOOL} { scope: "${found.scope}" } if you haven't, fix these and call ${tool} again. If the person asked for something that isn't a listed setting, leave it out and tell them plainly (offer the closest supported option or the workspace-level one).`
  return `${THEME_CHECK_PREFIX}: the ${found.scope === 'sign_in' ? 'sign-in page settings are' : `${found.scope} theme is`} not valid, so nothing was shown to the person.\n- ${issues.join('\n- ')}\n${next}`
}

export function themeReferenceTool(): AssistantToolDef {
  return {
    name: THEME_REFERENCE_TOOL,
    description: 'Every accepted look-and-feel setting for a scope — form (a form\'s theme: colours for light and dark, body and heading fonts, button shape, shadow, field style, appearance, radius, header…), workspace (the workspace theme) or sign_in (the form sign-in page): key, type, allowed values or range, default, what it affects, presets, fonts and valid examples. Call it before changing a theme; use only the listed settings.',
    parameters: {
      type: 'object',
      properties: { scope: { type: 'string', enum: [...THEME_SCOPES], description: 'form, workspace or sign_in' } },
      required: ['scope'],
    },
    mode: 'read',
    label: (args) => `Reading the ${args.scope === 'workspace' ? 'workspace theme' : args.scope === 'sign_in' ? 'sign-in page' : 'form theme'} settings`,
    maxResultChars: 40_000,
    run: async (args) => {
      const scope = String(args.scope ?? '') as ThemeScope
      if (!THEME_SCOPES.includes(scope)) return { result: { error: `scope must be one of ${THEME_SCOPES.join(', ')}` }, ok: false }
      return { result: themeReference(scope) }
    },
  }
}

/* ── The confirmation card: before → after per setting ── */

/** A theme as dotted settings (fonts shown as their family). */
function flatSettings(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) return out
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>
    if (typeof v.source === 'string' && typeof v.family === 'string') { out[prefix] = `${v.family}${v.source === 'system' ? ' (system)' : ''}`; return out }
    for (const [k, x] of Object.entries(v)) flatSettings(x, prefix ? `${prefix}.${k}` : k, out)
    return out
  }
  out[prefix] = Array.isArray(value) ? value.map(String).join(', ') : String(value)
  return out
}

/** The overrides of a form theme reference (a saved / workspace reference has none). */
function overridesOf(ref: any): Record<string, unknown> | null {
  return ref && typeof ref === 'object' && ref.source === 'custom' && ref.overrides && typeof ref.overrides === 'object' ? ref.overrides : null
}

/** Changed settings between two form theme references (or two whole themes), "—" for unset. */
export function themeChanges(before: unknown, after: unknown, opts: { form?: boolean } = {}): Array<{ path: string; before: string; after: string }> {
  const label = (ref: any) => (ref?.source === 'saved' ? `saved theme ${String(ref.theme_id).slice(0, 8)}…` : ref?.source === 'custom' ? 'custom' : 'workspace theme')
  const b = opts.form ? overridesOf(before) : (before as Record<string, unknown> | null)
  const a = opts.form ? overridesOf(after) : (after as Record<string, unknown> | null)
  const rows: Array<{ path: string; before: string; after: string }> = []
  if (opts.form && label(before) !== label(after)) rows.push({ path: 'theme', before: label(before), after: label(after) })
  const fb = flatSettings(b ?? {})
  const fa = flatSettings(a ?? {})
  for (const path of [...new Set([...Object.keys(fb), ...Object.keys(fa)])]) {
    if (fb[path] !== fa[path]) rows.push({ path, before: fb[path] ?? '—', after: fa[path] ?? '—' })
  }
  return rows
}

/** The card's table for theme changes (colour cells get a swatch in the panel). */
export function themeChangesPreview(rows: Array<{ path: string; before: string; after: string }>, max = 40) {
  return {
    columns: ['Setting', 'Before', 'After'],
    rows: rows.slice(0, max).map((r) => [r.path.replace(/^colors\.(light|dark)\./, '$1 · '), r.before.slice(0, 80), r.after.slice(0, 80)]),
    total: rows.length,
    caption: 'Theme: before → after',
  }
}
