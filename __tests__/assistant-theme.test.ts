/**
 * The Agent and look and feel: theme_reference is generated from the theme
 * schemas (every accepted key listed, examples valid), theme writes are
 * checked before the confirmation card (an invalid payload goes back to the
 * model for a correction round; the card shows before → after), the new form
 * theme settings (heading font, button shape, shadow, field style,
 * appearance) render the expected CSS variables, raw CSS never gets through,
 * dark-mode colours apply, and an Agent-created form ends on the animated
 * thank-you page shared with the wizard. The provider is a mocked fetch.
 */
import { describe, expect, it, vi } from 'vitest'
import { runAssistantTurn } from '@/lib/assistants/engine'
import { designerTools, draftOnlyArgs } from '@/lib/assistants/tools/designer'
import { THEME_CHECK_PREFIX, THEME_REFERENCE_TOOL, themeCheckError, themeReferenceTool } from '@/lib/assistants/tools/theme-reference'
import { assistantInstructions, THEME_RULE } from '@/lib/assistants/prompts'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { AssistantEvent, ChatMessage } from '@/lib/assistants/types'
import { checkThemePayload, expandKey, themeReference, themeSettingKeys, zodLeafPaths, type ThemeSetting } from '@/lib/theme/reference'
import {
  FORM_SHADOWS, FormThemeOverridesSchema, formAppearanceMode, formButtonRadius, formThemeFontHrefs, formThemeVars, type FormThemeOverrides,
} from '@/lib/forms/form-theme'
import { WorkspaceThemeSchema, isValidShadow } from '@/lib/theme/schema'
import { formSignInSettingsSchema } from '@/lib/api-schemas/form-sign-in-page'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'
import { defaultFormAnimation, defaultSubmittedPage, withDefaultSuccessPage } from '@/lib/forms/success-defaults'
import { WizardSpecSchema } from '@/lib/forms/wizard/spec'
import { assignWizardKeys, buildFormLayout } from '@/lib/forms/wizard/build'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ws = defaultWorkspaceTheme()

describe('theme_reference is generated from the schemas', () => {
  it('every key the form theme accepts is listed (and nothing else)', () => {
    const listed = themeSettingKeys('form').map((k) => k.replace(/^overrides\./, ''))
    const accepted = zodLeafPaths(FormThemeOverridesSchema)
    for (const key of accepted) expect(listed, key).toContain(key)
    for (const key of ['heading_font', 'button_shape', 'shadow', 'field_style', 'appearance', 'colors.dark.background']) expect(accepted).toContain(key)
  })

  it('every key of the workspace theme and the sign-in page is listed', () => {
    const ws = themeSettingKeys('workspace')
    for (const key of zodLeafPaths(WorkspaceThemeSchema)) expect(ws, key).toContain(key)
    const si = themeSettingKeys('sign_in')
    for (const key of zodLeafPaths(formSignInSettingsSchema)) expect(si, key).toContain(key)
  })

  it('each setting has a type, and enums list their values', () => {
    const settings = (themeReference('form') as { settings: ThemeSetting[] }).settings
    const shape = settings.find((s) => s.key === 'overrides.button_shape')!
    expect(shape).toMatchObject({ type: 'enum', values: ['square', 'rounded', 'pill'], when_unset: expect.any(String), affects: expect.any(String) })
    expect(settings.find((s) => s.key === 'overrides.radius')).toMatchObject({ type: 'integer', range: '0–24' })
    expect(settings.find((s) => s.key === 'overrides.heading_font')).toMatchObject({ type: 'font' })
    expect(settings.find((s) => s.key === 'overrides.colors.{light|dark}.accent')).toMatchObject({ type: 'colour' })
    for (const s of settings) expect(s.type, s.key).toBeTruthy()
    expect(expandKey('a.{b|c}.d')).toEqual(['a.b.d', 'a.c.d'])
  })

  it('the examples are valid payloads; fonts and presets are listed', () => {
    const form = themeReference('form') as any
    for (const example of form.examples) expect(checkThemePayload('form', example)).toEqual([])
    expect(form.fonts.google.join(' ')).toContain('Fraunces')
    expect(form.presets.list.length).toBeGreaterThan(10)
    const signIn = themeReference('sign_in') as any
    for (const example of signIn.examples) expect(checkThemePayload('sign_in', example)).toEqual([])
    expect(signIn.designs).toHaveLength(10)
    const workspace = themeReference('workspace') as any
    for (const p of workspace.shadow_presets.list) for (const v of Object.values(p.shadows)) expect(isValidShadow(v)).toBe(true)
    expect(checkThemePayload('workspace', ws)).toEqual([])
  })

  it('the tool answers per scope and refuses an unknown one', async () => {
    const tool = themeReferenceTool()
    const env = { emit: () => {}, toolCallId: 'x' } as any
    expect((await tool.run({ scope: 'form' }, env)).result).toMatchObject({ scope: 'form' })
    expect((await tool.run({ scope: 'css' }, env)).ok).toBe(false)
  })
})

describe('raw CSS never gets through', () => {
  const bad = (overrides: unknown) => FormThemeOverridesSchema.safeParse(overrides).success
  it('shadows are named levels, fonts curated, colours closed grammar, unknown keys refused', () => {
    expect(bad({ shadow: '0 0 10px red' })).toBe(false)
    expect(bad({ shadow: 'subtle' })).toBe(true)
    expect(bad({ heading_font: { source: 'google', family: 'Inter; } body { background: url(x)' } })).toBe(false)
    expect(bad({ heading_font: { source: 'google', family: 'Comic Sans Fake' } })).toBe(false)
    expect(bad({ colors: { dark: { background: 'red;background:url(https://x)' } } })).toBe(false)
    expect(bad({ button_shape: 'blob' })).toBe(false)
    expect(bad({ css: 'body{display:none}' })).toBe(false)
    expect(bad({ header: { enabled: true, title: '</style><script>' } })).toBe(false)
    expect(isValidShadow('0 0 4px url(javascript:x)')).toBe(false)
    expect(isValidShadow('0 1px 2px red; color: red')).toBe(false)
  })

  it('the check names unknown keys and points at theme_reference', () => {
    const error = themeCheckError('forms_update', { form_id: 'f', theme: { source: 'custom', overrides: { button_radius: 'pill' } } })!
    expect(error).toContain(THEME_CHECK_PREFIX)
    expect(error).toContain('button_radius')
    expect(error).toContain(THEME_REFERENCE_TOOL)
    expect(themeCheckError('forms_update', { form_id: 'f', theme: { source: 'custom', overrides: { button_shape: 'pill' } } })).toBeNull()
    expect(themeCheckError('forms_update', { form_id: 'f', name: 'No theme' })).toBeNull()
    expect(themeCheckError('form_sign_in_page_update', { accent_color: 'teal' })).toContain('accent_color')
    expect(themeCheckError('form_sign_in_page_update', { accent_color: '#0f766e', design: 2 })).toBeNull()
    expect(themeCheckError('workspace_theme_update', { theme: { ...ws, shadows: { ...ws.shadows, card: 'url(x)' } } })).toContain('shadows.card')
    expect(themeCheckError('forms_update', { form_id: 'f', theme: { source: 'custom', overrides: { pill: true } } }, 2)).toContain('Still not valid')
  })
})

describe('new form theme settings render', () => {
  it('heading font, button shape and shadow become variables', () => {
    const o: FormThemeOverrides = { heading_font: { source: 'google', family: 'Fraunces' }, button_shape: 'pill', shadow: 'medium' }
    const vars = formThemeVars(o, ws.colors.light, 'light')
    expect(vars['--form-heading-font']).toContain('var(--font-display)')
    expect(vars['--form-button-radius']).toBe('9999px')
    expect(vars['--form-card-shadow']).toBe(FORM_SHADOWS.light.medium)
    expect(formButtonRadius({ button_shape: 'square' })).toBe('0px')
    expect(formButtonRadius({ button_shape: 'rounded', radius: 14 })).toBe('14px')
    // Absent keys: nothing new (back-compat).
    const plain = formThemeVars({ radius: 4 }, ws.colors.light, 'light')
    for (const k of ['--form-heading-font', '--form-button-radius', '--form-card-shadow']) expect(plain[k]).toBeUndefined()
  })

  it('a non-bundled heading font is loaded with the body font, from this origin', () => {
    const hrefs = formThemeFontHrefs({ font: { source: 'google', family: 'DM Sans' }, heading_font: { source: 'google', family: 'Playfair Display' } })
    expect(hrefs).toEqual(['/fonts/g/dm-sans/w1ff-i1ff.css', '/fonts/g/playfair-display/w1f8-i1f8.css'])
    expect(formThemeFontHrefs({ heading_font: { source: 'google', family: 'Fraunces' } })).toEqual([])
  })

  it('dark overrides apply in dark mode, with dark-tuned shadows', () => {
    const o: FormThemeOverrides = { colors: { light: { background: '#ffffff', text: '#1f1b2e' }, dark: { background: '#1c1830', text: '#ece9f7', accent: '#c4b5fd' } }, shadow: 'strong' }
    const dark = formThemeVars(o, ws.colors.dark, 'dark')
    expect(dark['--theme-card-bg']).toBe('#1c1830')
    expect(dark['--form-card-shadow']).toBe(FORM_SHADOWS.dark.strong)
    expect(formThemeVars(o, ws.colors.light, 'light')['--theme-card-bg']).toBe('#ffffff')
  })

  it('appearance picks the palette: forced, the OS, or the workspace', () => {
    expect(formAppearanceMode({ appearance: 'dark' }, 'light', false)).toBe('dark')
    expect(formAppearanceMode({ appearance: 'light' }, 'dark', true)).toBe('light')
    expect(formAppearanceMode({ appearance: 'system' }, 'light', true)).toBe('dark')
    expect(formAppearanceMode({}, 'light', true)).toBe('light')
    expect(formAppearanceMode(null, 'dark', false)).toBe('dark')
  })
})

/* ── The correction round, with a mocked model ── */

const conn: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, baseUrl: 'https://llm.test' }
function provider(...replies: Array<{ content?: string | null; tool_calls?: any[] }>) {
  const bodies: any[] = []
  const fetchImpl = vi.fn(async (_url: any, init: any) => {
    bodies.push(JSON.parse(init.body))
    const msg = replies[Math.min(bodies.length - 1, replies.length - 1)]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies }
}
const toolCall = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const FORM_ID = '6f1d2c3b-1a2b-4c3d-8e9f-0a1b2c3d4e5f'

function formServer() {
  const handlers = new Map<string, ReturnType<typeof vi.fn>>()
  const form = { id: FORM_ID, name: 'Expense claim', fields: [{ key: 'amount', label: 'Amount', type: 'number' }], theme: { source: 'custom', overrides: { colors: { light: { accent: '#2563eb' } }, radius: 8 } } }
  return {
    handlers,
    getHandler: (name: string) => {
      if (!handlers.has(name)) handlers.set(name, vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(name === 'forms_get' ? { form } : { updated: true, form }) }] })))
      return handlers.get(name)
    },
  }
}

describe('theme writes are checked before the card', () => {
  it('an invalid theme goes back to the model once; the person sees one card with before → after', async () => {
    const server = formServer()
    const tools = designerTools({ server: server as any, permissions: new Set(['forms.view', 'forms.edit']) })
    expect(tools.map((t) => t.name)).toContain(THEME_REFERENCE_TOOL)
    const invalid = { form_id: FORM_ID, theme: { source: 'custom', overrides: { button_radius: 'pill', shadow: '0 0 12px rgba(0,0,0,.3)', heading_font: 'Fraunces' } } }
    const valid = { form_id: FORM_ID, theme: { source: 'custom', overrides: { colors: { light: { accent: '#2563eb' }, dark: { background: '#1c1830', text: '#ece9f7', accent: '#c4b5fd' } }, radius: 8, button_shape: 'pill', shadow: 'subtle', heading_font: { source: 'google', family: 'Fraunces' } } } }
    const p = provider(
      { content: null, tool_calls: [toolCall('a', 'forms_update', invalid)] },
      { content: null, tool_calls: [toolCall('r', THEME_REFERENCE_TOOL, { scope: 'form' })] },
      { content: null, tool_calls: [toolCall('b', 'forms_update', valid)] },
    )
    const events: AssistantEvent[] = []
    const history: ChatMessage[] = [{ role: 'user', content: 'pill buttons, Fraunces headings, soft shadows and a dark palette' }]
    const r = await runAssistantTurn({ connection: conn, instructions: 'D', context: null, history, tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).toBe('awaiting_confirmation')
    const cards = events.filter((e) => e.type === 'confirm') as Array<Extract<AssistantEvent, { type: 'confirm' }>>
    expect(cards).toHaveLength(1)
    expect(cards[0].card.tool_call_id).toBe('b')
    // The model saw the check (unknown keys named), never the person.
    const firstError = p.bodies[1].messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'a')
    expect(firstError.content).toContain(THEME_CHECK_PREFIX)
    expect(firstError.content).toContain('button_radius')
    // Before → after per setting, colours as hex (the panel draws swatches).
    const rows = cards[0].card.preview!.rows
    expect(rows).toContainEqual(['button_shape', '—', 'pill'])
    expect(rows).toContainEqual(['heading_font', '—', 'Fraunces'])
    expect(rows).toContainEqual(['dark · background', '—', '#1c1830'])
    expect(rows.find((row) => row[0] === 'light · accent')).toBeUndefined()
    expect(server.handlers.get('forms_update')).toBeUndefined()
  })
})

describe('the prompt rule', () => {
  it('building or admin changes get the theme rule; read-only help does not', () => {
    expect(assistantInstructions({ groups: ['designer'], canBuild: true })).toContain(THEME_RULE)
    expect(assistantInstructions({ groups: [], admin: { canChange: true } })).toContain(THEME_RULE)
    expect(assistantInstructions({ groups: ['designer'], canBuild: false })).not.toContain(THEME_RULE)
    expect(THEME_RULE).toContain('theme_reference')
  })
})

describe('Agent-created forms end on the animated thank-you page', () => {
  it('forms_create gets the wizard\'s default success page and animation', () => {
    const out = draftOnlyArgs('forms_create', { name: 'Onboarding', fields: [{ key: 'a', label: 'A', type: 'text' }], layout: { rows: [] } })
    expect(out.layout).toEqual({ rows: [], submitted_page: defaultSubmittedPage(), animation: defaultFormAnimation() })
    expect(draftOnlyArgs('forms_create', { name: 'X', fields: [] }).layout).toEqual({ submitted_page: defaultSubmittedPage(), animation: defaultFormAnimation() })
    expect(draftOnlyArgs('forms_update', { form_id: 'f', name: 'Y' }).layout).toBeUndefined()
  })

  it('an explicit choice is kept', () => {
    expect(withDefaultSuccessPage({ submitted_page: { enabled: false } })).toEqual({ submitted_page: { enabled: false } })
    expect(withDefaultSuccessPage({ animation: { style: 'none' } })).toEqual({ animation: { style: 'none' }, submitted_page: defaultSubmittedPage() })
    const own = { enabled: true, icon: 'party', heading: 'Woo' }
    expect(withDefaultSuccessPage({ submitted_page: own }).submitted_page).toBe(own)
  })

  it('the wizard uses the same helper', () => {
    const spec = assignWizardKeys(WizardSpecSchema.parse({ name: 'Purchase request', questions: [{ id: 'q1', kind: 'short_text', label: 'What do you need?' }] }))
    const layout = buildFormLayout(spec) as any
    expect(layout.submitted_page).toEqual(defaultSubmittedPage({ submitAnother: spec.audience.multiple_responses }))
    expect(layout.animation).toEqual(defaultFormAnimation())
  })

  it('the card says so', async () => {
    const server = formServer()
    const tools = designerTools({ server: server as any, permissions: new Set(['forms.view', 'forms.edit']) })
    const create = tools.find((t) => t.name === 'forms_create')!
    const card = await create.confirm!({ name: 'Onboarding', fields: [{ key: 'a', label: 'A', type: 'text' }] })
    expect(card.lines).toContain('Success page: animated thank-you (with the reference number)')
  })
})
