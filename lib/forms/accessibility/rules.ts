/**
 * Structural rules of the form checker: labels, instructions, errors,
 * order, headings, language, input purpose, pages, timing, images, buttons,
 * custom controls, target size. Each rule reads the definition only (the
 * colour rules are in ./contrast.ts) and returns its findings.
 */

import { layoutFormRules, rulesHidingRequiredFields } from '../form-rules'
import { allActions, type FieldButtonAction } from '../field-buttons'
import { MIN_READABLE_SECONDS, accessibleName } from '../form-messages'
import type { FormDefinition } from '@/lib/forms/definition'
import type { FormButton } from '@/lib/forms/buttons'
import { isDisplayField, type TaskFieldDef } from '@/lib/task-field-schema'
import type { ControlAccessibilitySpec } from '@/lib/forms/custom-controls/contract'
import type { AccessibilityFinding, AccessibilityRuleInfo, CheckOptions, FormPageInfo } from './types'
import { suggestAutocomplete } from './input-purpose'
import { levelOf } from './wcag'
import { submitPathProblem } from '@/lib/forms/form-state'
import { layoutSections, sectionFieldKeys } from '@/lib/forms/sections'
import { normalizeSubmittedPage } from '@/lib/forms/submitted-page'
import { isDynamicLabel } from '@/lib/forms/label-field'
import { withThemeHeaderText } from '@/lib/forms/header'

export interface RuleContext {
  def: FormDefinition
  opts: CheckOptions
  /** Value-holding fields, in reading order. */
  values: TaskFieldDef[]
  /** Every field, in reading order (what keyboard users tab through). */
  ordered: TaskFieldDef[]
  byKey: Map<string, TaskFieldDef>
}

export interface Rule {
  info: AccessibilityRuleInfo
  run(c: RuleContext): AccessibilityFinding[]
}

// ── helpers ────────────────────────────────────────────────────────────────

const blank = (s: string | null | undefined) => !s || !s.trim()

/** Placeholder names the designer / an import gives a field ("field_3", "Text 2", "Untitled"). */
const GENERIC_LABEL = /^(field|untitled|text|input|long text|new field)([ _-]?\d+)?$/i

/** What to suggest as a label: the key in words, or the type when the key says nothing (field_3). */
export function suggestedLabel(field: Pick<TaskFieldDef, 'key' | 'type'>): string {
  if (/^(field|untitled|input|new_field)(_\d+)?$/.test(field.key)) {
    const byType: Record<string, string> = { email: 'Email', phone: 'Phone', url: 'Website', date: 'Date', datetime: 'Date and time', number: 'Number', currency: 'Amount', boolean: 'Confirm', attachments: 'Files', lookup: 'Search', user: 'Person' }
    return byType[field.type] ?? ''
  }
  return humanizeKey(field.key)
}

/** A label that is empty or just the machine key ("field_3", "first_name"). */
export function isMachineLabel(field: Pick<TaskFieldDef, 'key' | 'label'>): boolean {
  const label = (field.label ?? '').trim()
  if (!label) return true
  if (GENERIC_LABEL.test(label)) return true
  return label === field.key && /[_\d]/.test(field.key)
}

/** "first_name" → "First name". */
export function humanizeKey(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Field'
}

interface CustomSpec {
  tag?: string
  name?: string
  accessibility?: ControlAccessibilitySpec
}

/** The custom control manifest of a `custom` field (that type lands with the custom controls feature). */
export function customOf(field: TaskFieldDef): CustomSpec | null {
  if ((field.type as string) !== 'custom') return null
  const custom = (field as { custom?: unknown }).custom
  return custom && typeof custom === 'object' ? custom as CustomSpec : {}
}

const finding = (f: Omit<AccessibilityFinding, 'level' | 'source'>): AccessibilityFinding => ({ ...f, level: levelOf(f.wcag), source: 'checker' })

const nameOf = (field: TaskFieldDef) => (blank(field.label) || isMachineLabel(field) ? `"${field.key}"` : `"${field.label.trim()}"`)

// ── rules ──────────────────────────────────────────────────────────────────

const labelMissing: Rule = {
  info: { rule: 'label-missing', title: 'Every field has a label', wcag: ['1.3.1', '2.4.6', '4.1.2'], level: 'A' },
  run: ({ values }) => values.filter((f) => isMachineLabel(f) && blank(f.placeholder)).map((f) => {
    const empty = blank(f.label)
    const suggestion = suggestedLabel(f)
    return finding({
      id: `label-missing:${f.key}`, rule: 'label-missing', field_key: f.key,
      severity: empty ? 'critical' : 'serious', wcag: ['1.3.1', '2.4.6', '4.1.2'],
      message: empty ? `Field "${f.key}" has no label.` : `Field "${f.key}" is labelled with its key ("${f.label}"), which is not a meaningful name.`,
      help: f.type === 'lookup' ? 'The lookup box is announced by its label; give it a label that says what to search for.'
        : f.type === 'attachments' ? 'The upload area is a group named by its label; say what files to attach.'
          : 'Screen readers announce the label as the field’s name, and voice users say it to move to the field.',
      fix: { kind: 'field', label: 'Add label', field_key: f.key, patch: { label: suggestion || humanizeKey(f.key) }, prompt: { property: 'label', question: `Label for "${f.key}"`, suggestion } },
    })
  }),
}

const placeholderOnly: Rule = {
  info: { rule: 'label-placeholder-only', title: 'Labels are not only placeholders', wcag: ['3.3.2', '1.3.1'], level: 'A' },
  run: ({ values }) => values.filter((f) => isMachineLabel(f) && !blank(f.placeholder)).map((f) => finding({
    id: `label-placeholder-only:${f.key}`, rule: 'label-placeholder-only', field_key: f.key, severity: 'serious', wcag: ['3.3.2', '1.3.1'],
    message: `Field "${f.key}" is only described by its placeholder ("${f.placeholder!.trim()}").`,
    help: 'A placeholder disappears as soon as someone types and is not a reliable accessible name. Use it as the label instead.',
    fix: { kind: 'field', label: 'Use placeholder as label', field_key: f.key, patch: { label: f.placeholder!.trim().slice(0, 200), placeholder: undefined } },
  })),
}

const placeholderInstructions: Rule = {
  info: { rule: 'placeholder-instructions', title: 'Instructions are not hidden in placeholders', wcag: ['3.3.2'], level: 'A' },
  run: ({ values }) => values
    .filter((f) => !isMachineLabel(f) && !blank(f.placeholder) && blank(f.help_text) && (f.placeholder!.trim().length > 40 || /\b(e\.g\.|format|must|example|dd\/|mm\/|yyyy)\b/i.test(f.placeholder!)))
    .map((f) => finding({
      id: `placeholder-instructions:${f.key}`, rule: 'placeholder-instructions', field_key: f.key, severity: 'minor', wcag: ['3.3.2'],
      message: `${nameOf(f)} keeps its instructions in the placeholder ("${f.placeholder!.trim()}").`,
      help: 'The placeholder vanishes while typing and is often low contrast. Help text stays visible and is announced with the field.',
      fix: { kind: 'field', label: 'Move to help text', field_key: f.key, patch: { help_text: f.placeholder!.trim(), placeholder: undefined } },
    })),
}

const duplicateLabels: Rule = {
  info: { rule: 'label-duplicate', title: 'Labels are unique', wcag: ['2.4.6', '1.3.1'], level: 'A' },
  run: ({ values }) => {
    const seen = new Map<string, TaskFieldDef>()
    const out: AccessibilityFinding[] = []
    for (const f of values) {
      if (isMachineLabel(f)) continue
      const norm = f.label.trim().toLowerCase().replace(/\s+/g, ' ')
      const first = seen.get(norm)
      if (!first) { seen.set(norm, f); continue }
      const suggestion = `${f.label.trim()} (2)`
      out.push(finding({
        id: `label-duplicate:${f.key}`, rule: 'label-duplicate', field_key: f.key, severity: 'moderate', wcag: ['2.4.6', '1.3.1'],
        message: `"${f.label.trim()}" labels both "${first.key}" and "${f.key}".`,
        help: 'Two fields with the same name are indistinguishable in a screen reader’s list of form controls. Make each label say what is different.',
        fix: { kind: 'field', label: 'Rename', field_key: f.key, patch: { label: suggestion }, prompt: { property: 'label', question: `New label for "${f.key}"`, suggestion } },
      }))
    }
    return out
  },
}

const helpAssociation: Rule = {
  info: { rule: 'help-association', title: 'Help text and section descriptions are connected', wcag: ['1.3.1'], level: 'A' },
  run: ({ ordered }) => {
    const out: AccessibilityFinding[] = []
    for (const f of ordered) {
      if (f.type === 'heading' && !blank(f.help_text) && isMachineLabel(f)) {
        out.push(finding({
          id: `help-association:${f.key}`, rule: 'help-association', field_key: f.key, severity: 'moderate', wcag: ['1.3.1'],
          message: `Section "${f.key}" has a description but no heading text, so the description is not tied to a section.`,
          help: 'Give the section a heading; its description is read after it.',
          fix: { kind: 'field', label: 'Add heading text', field_key: f.key, patch: { label: humanizeKey(f.key) }, prompt: { property: 'label', question: 'Section heading', suggestion: humanizeKey(f.key) } },
        }))
      }
      const custom = customOf(f)
      if (custom && !blank(f.help_text) && custom.accessibility?.labelled_by_host === false) {
        out.push(finding({
          id: `help-association:${f.key}`, rule: 'help-association', field_key: f.key, severity: 'review', wcag: ['1.3.1'],
          message: `Custom control ${nameOf(f)} names itself, so the form's help text may not be announced with it.`,
          help: 'Check with a screen reader that the help text is read when the control gets focus (the control should use the host `description`).',
        }))
      }
    }
    return out
  },
}

/** Control types whose "required" is not exposed to assistive technology (only the visual asterisk). */
const REQUIRED_NOT_EXPOSED = (f: TaskFieldDef) => f.type === 'boolean' || f.type === 'multi_choice' || f.type === 'attachments'
  || (f.type === 'choice' && f.display === 'radio') || customOf(f) !== null

const mentionsRequired = (s: string | undefined) => Boolean(s && /\brequired\b|\bmandatory\b|\*/i.test(s))

const requiredIndicator: Rule = {
  info: { rule: 'required-indicator', title: 'Required fields are identified in text', wcag: ['3.3.2', '1.3.1'], level: 'A' },
  run: ({ def, values, ordered }) => {
    const required = values.filter((f) => f.required)
    if (!required.length) return []
    const out: AccessibilityFinding[] = []
    const explained = mentionsRequired(def.header?.enabled ? def.header.subtitle : undefined) || mentionsRequired(def.header?.enabled ? def.header.title : undefined)
      || ordered.some((f) => f.type === 'heading' && mentionsRequired(f.help_text))
    if (!explained) {
      const subtitle = def.header?.subtitle ? `${def.header.subtitle} Fields marked * are required.` : 'Fields marked * are required.'
      out.push(finding({
        id: 'required-indicator:legend', rule: 'required-indicator', severity: 'minor', wcag: ['3.3.2'],
        message: `${required.length} field${required.length === 1 ? ' is' : 's are'} marked required with an asterisk, but the form never says what the asterisk means.`,
        help: 'Say "Fields marked * are required" before the first field (the header subtitle is a good place).',
        fix: { kind: 'header', label: 'Explain the asterisk', patch: { enabled: true, subtitle: subtitle.slice(0, 300) } },
      }))
    }
    for (const f of required.filter(REQUIRED_NOT_EXPOSED)) {
      if (mentionsRequired(f.label) || mentionsRequired(f.help_text)) continue
      out.push(finding({
        id: `required-indicator:${f.key}`, rule: 'required-indicator', field_key: f.key, severity: 'minor', wcag: ['1.3.1', '3.3.2'],
        message: `${nameOf(f)} is required, but for this kind of control only the asterisk says so.`,
        help: 'Checkboxes, radio buttons, multi-select chips, uploads and custom controls do not announce "required". Mention it in the help text.',
        fix: { kind: 'field', label: 'Say "Required" in help', field_key: f.key, patch: { help_text: f.help_text ? `${f.help_text} (Required)` : 'Required.' } },
      }))
    }
    return out
  },
}

const errorSuggestion: Rule = {
  info: { rule: 'error-suggestion', title: 'Format errors explain how to fix them', wcag: ['3.3.1', '3.3.3'], level: 'A' },
  run: ({ values }) => values.filter((f) => !blank(f.pattern) && blank(f.pattern_message)).map((f) => {
    const label = isMachineLabel(f) ? humanizeKey(f.key) : f.label.trim()
    const message = f.help_text ? `${label}: ${f.help_text}`.slice(0, 200) : `Enter ${label.toLowerCase()} in the expected format.`
    return finding({
      id: `error-suggestion:${f.key}`, rule: 'error-suggestion', field_key: f.key, severity: 'moderate', wcag: ['3.3.1', '3.3.3'],
      message: `${nameOf(f)} checks a pattern but has no error message, so people only learn that the value is invalid, not why.`,
      help: 'Add a pattern error message that describes the expected format (ideally with an example).',
      fix: { kind: 'field', label: 'Add error message', field_key: f.key, patch: { pattern_message: message }, prompt: { property: 'pattern_message', question: `Error message for ${label}`, suggestion: message } },
    })
  }),
}

const focusOrder: Rule = {
  info: { rule: 'focus-order', title: 'Fields revealed by an answer come after it', wcag: ['2.4.3', '1.3.2'], level: 'A' },
  run: ({ ordered, byKey }) => {
    const index = new Map(ordered.map((f, i) => [f.key, i]))
    const out: AccessibilityFinding[] = []
    for (const f of ordered) {
      const controllerKey = f.visible_when?.field
      if (!controllerKey) continue
      const controller = byKey.get(controllerKey)
      if (!controller) continue
      // A cycle (A shows when B is set, B when A is set) hides both for good.
      const seen = new Set([f.key])
      let next: string | undefined = controllerKey
      let cyclic = false
      while (next) {
        if (seen.has(next)) { cyclic = true; break }
        seen.add(next)
        next = byKey.get(next)?.visible_when?.field
      }
      if (cyclic) {
        out.push(finding({
          id: `focus-order:${f.key}:cycle`, rule: 'focus-order', field_key: f.key, severity: 'serious', wcag: ['1.3.2', '2.4.3'],
          message: `${nameOf(f)} and ${nameOf(controller)} each depend on the other to be shown, so they can never appear.`,
          help: 'Break the "Visible when" chain so one of them is always shown.',
          fix: { kind: 'field', label: 'Always show', field_key: f.key, patch: { visible_when: undefined } },
        }))
        continue
      }
      if ((index.get(controllerKey) ?? -1) > (index.get(f.key) ?? -1)) {
        out.push(finding({
          id: `focus-order:${f.key}`, rule: 'focus-order', field_key: f.key, severity: 'moderate', wcag: ['2.4.3', '1.3.2'],
          message: `${nameOf(f)} appears when ${nameOf(controller)} is answered, but sits before it: it pops up behind the person filling in the form.`,
          help: 'Place fields after the question that reveals them, so keyboard and screen-reader users meet them next.',
        }))
      }
    }
    return out
  },
}

/** Height (px) of the clickable target of each choice control as the renderer draws it, and the gap to its neighbour. */
export const TARGET_METRICS: Record<'comfortable' | 'compact', Record<'radio' | 'chip' | 'checkbox', { height: number; gap: number }>> = {
  comfortable: { radio: { height: 20, gap: 6 }, chip: { height: 26, gap: 6 }, checkbox: { height: 40, gap: 0 } },
  compact: { radio: { height: 20, gap: 6 }, chip: { height: 26, gap: 6 }, checkbox: { height: 40, gap: 0 } },
}

/** WCAG 2.5.8: 24×24 px, or small targets spaced so a 24 px circle around each does not reach the next. */
export function targetPasses(m: { height: number; gap: number }): boolean {
  return m.height >= 24 || m.height + m.gap >= 24
}

const targetSize: Rule = {
  info: { rule: 'target-size', title: 'Choice targets are at least 24 px', wcag: ['2.5.8'], level: 'AA' },
  run: ({ def, values, opts }) => {
    const overrides = def.theme.source === 'custom' ? def.theme.overrides : opts.theme?.overrides
    const density = overrides?.density ?? 'comfortable'
    const metrics = TARGET_METRICS[density]
    const out: AccessibilityFinding[] = []
    for (const f of values) {
      const kind = f.type === 'multi_choice' ? 'chip' : f.type === 'boolean' ? 'checkbox' : f.type === 'choice' && f.display === 'radio' ? 'radio' : null
      if (!kind || targetPasses(metrics[kind])) continue
      out.push(finding({
        id: `target-size:${f.key}`, rule: 'target-size', field_key: f.key, severity: 'minor', wcag: ['2.5.8'],
        message: `The ${kind === 'chip' ? 'options' : kind === 'radio' ? 'radio buttons' : 'checkbox'} of ${nameOf(f)} are ${metrics[kind].height}px tall with ${metrics[kind].gap}px between them in the ${density} density.`,
        help: 'Use the comfortable density, or a dropdown for long option lists.',
        ...(def.theme.source === 'custom' && density === 'compact' ? { fix: { kind: 'theme' as const, label: 'Use comfortable density', patch: { theme: { source: 'custom', overrides: { ...def.theme.overrides, density: 'comfortable' } } } } } : {}),
      }))
    }
    for (const f of values) {
      const custom = customOf(f)
      const h = (custom as { size?: { min_height?: number } } | null)?.size?.min_height
      if (custom && typeof h === 'number' && h > 0 && h < 24) {
        out.push(finding({
          id: `target-size:${f.key}`, rule: 'target-size', field_key: f.key, severity: 'review', wcag: ['2.5.8'],
          message: `Custom control ${nameOf(f)} may be as small as ${h}px.`,
          help: 'Check that its interactive parts are at least 24×24 px or spaced apart.',
        }))
      }
    }
    return out
  },
}

const LONG_FORM = 8

const headings: Rule = {
  info: { rule: 'headings', title: 'Sections and the form have meaningful headings', wcag: ['1.3.1', '2.4.6', '2.4.2'], level: 'A' },
  run: ({ def, ordered, values, opts }) => {
    const out: AccessibilityFinding[] = []
    const sections = ordered.filter((f) => f.type === 'heading')
    // Declared sections (lib/forms/sections.ts) render as fieldset + legend (collapsible ones: a button with aria-expanded).
    const declared = layoutSections(def.layout)
    for (const s of declared) {
      const keys = new Set(sectionFieldKeys(def.layout, s.key))
      const required = values.filter((f) => keys.has(f.key) && f.required)
      if (s.collapsible && s.collapsed && required.length) {
        out.push(finding({
          id: `headings:section-collapsed:${s.key}`, rule: 'headings', severity: 'minor', wcag: ['3.3.2'],
          message: `Section "${s.title}" starts collapsed but holds ${required.length} required field${required.length === 1 ? '' : 's'}.`,
          help: 'People may submit without seeing what is required. Start it open (it still opens on an error), or make it optional.',
        }))
      }
      if (/^section( \d+)?$/i.test(s.title.trim()) && declared.length > 1) {
        out.push(finding({
          id: `headings:section-title:${s.key}`, rule: 'headings', severity: 'minor', wcag: ['2.4.6'],
          message: `Section "${s.key}" has the generic title "${s.title}".`,
          help: 'The section title is its legend: screen readers read it before each field in it. Say what the group is about.',
        }))
      }
    }
    for (const h of sections) {
      if (!isMachineLabel(h) || !blank(h.help_text)) continue
      out.push(finding({
        id: `headings:${h.key}`, rule: 'headings', field_key: h.key, severity: 'serious', wcag: ['1.3.1', '2.4.6'],
        message: `Section heading "${h.key}" has no text.`,
        help: 'An empty heading is announced as a heading with no name. Give it text, or remove it.',
        fix: { kind: 'field', label: 'Add heading text', field_key: h.key, patch: { label: humanizeKey(h.key) }, prompt: { property: 'label', question: 'Section heading', suggestion: humanizeKey(h.key) } },
      }))
    }
    if (values.length >= LONG_FORM) {
      if (!sections.length && !declared.length) {
        out.push(finding({
          id: 'headings:sections', rule: 'headings', severity: 'minor', wcag: ['1.3.1', '2.4.6'],
          message: `The form has ${values.length} fields and no section headings.`,
          help: 'Group long forms into sections with headings; screen-reader users jump between headings to find their place.',
        }))
      } else {
        const firstValue = ordered.findIndex((f) => !isDisplayField(f))
        const inSection = new Set(declared.flatMap((s) => sectionFieldKeys(def.layout, s.key)))
        const firstHeading = ordered.findIndex((f) => f.type === 'heading' || inSection.has(f.key))
        const before = ordered.slice(0, firstHeading).filter((f) => !isDisplayField(f)).length
        if (firstValue >= 0 && firstHeading > firstValue && before >= 3) {
          out.push(finding({
            id: 'headings:first', rule: 'headings', severity: 'minor', wcag: ['1.3.1'],
            message: `${before} fields come before the first section heading.`,
            help: 'Start a sectioned form with a heading so every field belongs to a section.',
          }))
        }
      }
    }
    // A title typed in the theme's header shows in the form header's place (lib/forms/header.ts).
    const header = withThemeHeaderText(def.header, (def.theme.source === 'custom' ? def.theme.overrides : opts.theme?.overrides)?.header)
    const titled = Boolean(header?.enabled && !blank(header.title))
    if (!titled) {
      const imageOnly = Boolean(header?.enabled && header.image !== 'none')
      out.push(finding({
        id: 'headings:title', rule: 'headings', severity: imageOnly ? 'moderate' : 'minor', wcag: ['2.4.2', '2.4.6'],
        message: imageOnly ? 'The header shows an image but no title, so the form has no heading.' : 'The form has no title in its header.',
        help: 'The header title is the form’s heading (level 2): it tells people what the form is for and lets screen-reader users find its start.',
        fix: { kind: 'header', label: 'Add a title', patch: { enabled: true, title: 'Form' }, prompt: { property: 'title', question: 'Form title', suggestion: '' } },
      }))
    }
    return out
  },
}

const BCP47 = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i
const LATIN_LANGS = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'da', 'sv', 'no', 'nb', 'nn', 'fi', 'pl', 'cs', 'sk', 'sl', 'hr', 'hu', 'ro', 'tr', 'id', 'ms', 'vi', 'mi', 'et', 'lv', 'lt', 'ga', 'cy', 'is', 'sq', 'af', 'sw', 'tl', 'eu', 'ca', 'gl'])

const language: Rule = {
  info: { rule: 'language', title: 'The language is set', wcag: ['3.1.1', '3.1.2'], level: 'A' },
  run: ({ def, opts, ordered }) => {
    const lang = opts.language === undefined ? 'en' : opts.language
    if (!lang || !BCP47.test(lang)) {
      return [finding({
        id: 'language:missing', rule: 'language', severity: 'serious', wcag: ['3.1.1'],
        message: lang ? `"${lang}" is not a valid language tag.` : 'The page language is not set.',
        help: 'Screen readers pick their pronunciation from the page language (lang attribute).',
      })]
    }
    const base = lang.toLowerCase().split('-')[0]
    if (!LATIN_LANGS.has(base)) return []
    const text = [def.header?.title, def.header?.subtitle, ...ordered.flatMap((f) => [f.label, f.help_text])].filter(Boolean).join(' ')
    const letters = text.match(/\p{L}/gu) ?? []
    const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length
    if (letters.length >= 20 && nonLatin / letters.length > 0.3) {
      return [finding({
        id: 'language:parts', rule: 'language', severity: 'review', wcag: ['3.1.2', '3.1.1'],
        message: `Much of the form's text is not in a Latin script, but the page language is "${lang}".`,
        help: 'If the form is written in another language, screen readers will mispronounce it. Check the workspace language for this form.',
      })]
    }
    return []
  },
}

const inputPurpose: Rule = {
  info: { rule: 'input-purpose', title: 'Personal-data fields declare their purpose', wcag: ['1.3.5'], level: 'AA' },
  run: ({ values }) => values.flatMap((f) => {
    if (f.autocomplete || f.read_only) return []
    const token = suggestAutocomplete(f)
    if (!token) return []
    return [finding({
      id: `input-purpose:${f.key}`, rule: 'input-purpose', field_key: f.key, severity: 'moderate', wcag: ['1.3.5'],
      message: `${nameOf(f)} looks like personal data (${token}) but does not declare its purpose.`,
      help: 'An autocomplete token lets browsers fill the value in and lets assistive tools show familiar icons. Set "Autocomplete (input purpose)".',
      fix: { kind: 'field', label: 'Apply autocomplete', field_key: f.key, patch: { autocomplete: token } },
    })]
  }),
}

/** Pages (steps / tabs) from the options or, generically, from the layout. */
export function formPages(def: FormDefinition, opts: CheckOptions): FormPageInfo[] {
  if (opts.pages) return opts.pages
  const layout = def.layout as unknown as Record<string, unknown> | null
  const raw = layout?.pages ?? layout?.steps ?? layout?.tabs
  if (!Array.isArray(raw)) return []
  return raw.filter((p) => p && typeof p === 'object').map((p: Record<string, unknown>) => ({
    id: typeof p.id === 'string' ? p.id : undefined,
    title: typeof p.title === 'string' ? p.title : typeof p.label === 'string' ? p.label : typeof p.name === 'string' ? p.name : null,
  }))
}

const pages: Rule = {
  info: { rule: 'pages', title: 'Steps and tabs have unique titles', wcag: ['2.4.6', '1.3.1'], level: 'A' },
  run: ({ def, opts }) => {
    const list = formPages(def, opts)
    if (list.length < 2) return []
    const out: AccessibilityFinding[] = []
    const seen = new Set<string>()
    list.forEach((p, i) => {
      const title = (p.title ?? '').trim()
      if (!title) {
        out.push(finding({
          id: `pages:${p.id ?? i}:missing`, rule: 'pages', severity: 'serious', wcag: ['2.4.6', '1.3.1'],
          message: `Page ${i + 1} of ${list.length} has no title.`,
          help: 'Step and tab titles name each page for screen readers and show people where they are.',
        }))
        return
      }
      const norm = title.toLowerCase()
      if (seen.has(norm)) {
        out.push(finding({
          id: `pages:${p.id ?? i}:duplicate`, rule: 'pages', severity: 'moderate', wcag: ['2.4.6'],
          message: `Two pages are titled "${title}".`,
          help: 'Give every step / tab a distinct title.',
        }))
      }
      seen.add(norm)
    })
    return out
  },
}

const timing: Rule = {
  info: { rule: 'timing', title: 'No unannounced time limits', wcag: ['2.2.1'], level: 'A' },
  run: ({ opts }) => {
    const t = opts.timeouts
    if (!t) return []
    const out: AccessibilityFinding[] = []
    if (t.time_limit_seconds && t.time_limit_seconds > 0 && !t.extendable) {
      out.push(finding({
        id: 'timing:limit', rule: 'timing', severity: 'serious', wcag: ['2.2.1'],
        message: `The form must be completed within ${Math.round(t.time_limit_seconds / 60)} minutes and the time cannot be extended.`,
        help: 'Let people turn off, adjust or extend a time limit (at least 20 seconds’ warning, extendable at least ten times).',
      }))
    }
    if (t.auto_expire) {
      out.push(finding({
        id: 'timing:expire', rule: 'timing', severity: 'review', wcag: ['2.2.1'],
        message: 'The task this form belongs to expires on its own.',
        help: 'Make sure the due date is shown with the form and that the deadline is long enough to be essential, or can be extended.',
      }))
    }
    return out
  },
}

const imageAlt: Rule = {
  info: { rule: 'image-alt', title: 'Header images have alternative text', wcag: ['1.1.1'], level: 'A' },
  run: ({ def }) => {
    const h = def.header
    if (!h?.enabled || !blank(h.image_alt)) return []
    if (h.image === 'upload') {
      return [finding({
        id: 'image-alt:header', rule: 'image-alt', severity: 'serious', wcag: ['1.1.1'],
        message: 'The uploaded header image has no alternative text.',
        help: 'Describe what the image shows (or the organisation for a logo). It is announced instead of the image.',
        fix: { kind: 'header', label: 'Add alt text', patch: { image_alt: '' }, prompt: { property: 'image_alt', question: 'Describe the header image', suggestion: h.title ? `${h.title} logo` : '' } },
      })]
    }
    if (h.image === 'workspace_logo' && blank(h.title)) {
      return [finding({
        id: 'image-alt:logo', rule: 'image-alt', severity: 'moderate', wcag: ['1.1.1'],
        message: 'The workspace logo is the only thing in the header and it has no alternative text.',
        help: 'Add a title or alt text naming the organisation.',
        fix: { kind: 'header', label: 'Add alt text', patch: { image_alt: '' }, prompt: { property: 'image_alt', question: 'Name of the organisation in the logo', suggestion: '' } },
      })]
    }
    return []
  },
}

/** The form's Submitted page (lib/forms/submitted-page.ts): it replaces the form, so it needs a heading, and an uploaded image a text alternative. */
const submittedPage: Rule = {
  info: { rule: 'submitted-page', title: 'The Submitted page has a heading and image text', wcag: ['1.1.1', '2.4.6'], level: 'A' },
  run: ({ def, opts }) => {
    const page = normalizeSubmittedPage(def.layout?.submitted_page)
    if (!page?.enabled || opts.surface === 'task') return []
    const out: AccessibilityFinding[] = []
    if (blank(page.heading)) {
      out.push(finding({
        id: 'submitted-page:heading', rule: 'submitted-page', severity: 'moderate', wcag: ['2.4.6', '1.3.1'],
        message: 'The Submitted page has no heading.',
        help: 'The heading (level 2, focused when the page appears) tells people the form was sent. Add one under Buttons & header → Submitted page.',
      }))
    }
    if (page.icon === 'upload' && page.icon_url && blank(page.icon_alt)) {
      out.push(finding({
        id: 'submitted-page:image-alt', rule: 'submitted-page', severity: 'serious', wcag: ['1.1.1'],
        message: 'The Submitted page\'s uploaded image has no alternative text.',
        help: 'Describe what the image shows (Buttons & header → Submitted page → Image description). It is announced instead of the image.',
      }))
    }
    return out
  },
}

const lookupAttachments: Rule = {
  info: { rule: 'lookup-attachments', title: 'Lookups and uploads explain how to use them', wcag: ['3.3.2'], level: 'A' },
  run: ({ values }) => values.filter((f) => f.type === 'lookup' && f.lookup?.allow_free_text !== true && blank(f.help_text) && !isMachineLabel(f)).map((f) => finding({
    id: `lookup-attachments:${f.key}`, rule: 'lookup-attachments', field_key: f.key, severity: 'minor', wcag: ['3.3.2'],
    message: `${nameOf(f)} only accepts one of its suggestions, but nothing says so.`,
    help: 'Tell people to start typing and pick a suggestion; typed text that is not picked is not kept.',
    fix: { kind: 'field', label: 'Add instructions', field_key: f.key, patch: { help_text: 'Start typing, then choose one of the suggestions.' } },
  })),
}

const GENERIC = /^(ok|okay|go|click( here)?|button|submit button|here|yes|no|\.+|>+|→)$/i
const KIND_LABEL: Record<string, string> = { submit: 'Submit', cancel: 'Cancel', draft: 'Save draft', outcome: 'Continue' }

const buttonNames: Rule = {
  info: { rule: 'button-names', title: 'Buttons have distinct, descriptive text', wcag: ['4.1.2', '2.4.6'], level: 'A' },
  run: ({ def }) => {
    const buttons: FormButton[] = (def.buttons ?? []).filter((b) => !b.hidden)
    const out: AccessibilityFinding[] = []
    const seen = new Set<string>()
    for (const b of buttons) {
      const text = (b.label ?? '').trim()
      if (!text) {
        const suggestion = b.kind === 'outcome' && b.outcome ? b.outcome : KIND_LABEL[b.kind] ?? 'Continue'
        out.push(finding({
          id: `button-names:${b.id}`, rule: 'button-names', severity: 'critical', wcag: ['4.1.2'],
          message: `The ${b.kind} button "${b.id}" has no text.`,
          help: 'A button without text is announced as just "button".',
          fix: { kind: 'button', label: 'Add button text', button_id: b.id, patch: { label: suggestion }, prompt: { property: 'label', question: 'Button text', suggestion } },
        }))
        continue
      }
      const norm = text.toLowerCase()
      if (seen.has(norm)) {
        out.push(finding({
          id: `button-names:${b.id}:duplicate`, rule: 'button-names', severity: 'moderate', wcag: ['2.4.6'],
          message: `Two buttons are labelled "${text}".`,
          help: 'Buttons that do different things need different text.',
        }))
      } else if (GENERIC.test(text)) {
        out.push(finding({
          id: `button-names:${b.id}:generic`, rule: 'button-names', severity: 'minor', wcag: ['2.4.6'],
          message: `The button "${text}" does not say what it does.`,
          help: 'Use a verb that describes the result, e.g. "Send request" or "Approve".',
        }))
      }
      seen.add(norm)
    }
    return out
  },
}

const submitPath: Rule = {
  info: { rule: 'submit-path', title: 'The form can be submitted from the form itself', wcag: ['2.1.1', '3.3.4'], level: 'A' },
  run: ({ def, opts }) => {
    // Application mode (no button bar) on a task form with no in-form Submit.
    const problem = submitPathProblem(def.fields, def.layout, opts.surface === 'task' ? 'task' : 'any')
    if (!problem) return []
    return [finding({
      id: 'submit-path:application-mode', rule: 'submit-path', severity: 'review', wcag: ['2.1.1', '3.3.4'],
      message: problem,
      help: 'Place a Button with a Submit action (it presses the hidden bar button), or turn Application mode off.',
    })]
  },
}

const customControls: Rule = {
  info: { rule: 'custom-control', title: 'Custom controls declare name, role and keyboard use', wcag: ['4.1.2', '2.1.1'], level: 'A' },
  run: ({ values }) => {
    const out: AccessibilityFinding[] = []
    for (const f of values) {
      const custom = customOf(f)
      if (!custom) continue
      const a11y = custom.accessibility ?? {}
      const what = custom.name || custom.tag || 'custom control'
      if (a11y.labelled_by_host === false && blank(a11y.role)) {
        out.push(finding({
          id: `custom-control:${f.key}:name`, rule: 'custom-control', field_key: f.key, severity: 'review', wcag: ['4.1.2'],
          message: `${nameOf(f)} (${what}) names itself and declares no ARIA role.`,
          help: 'Check with a screen reader that the control announces a name, its role and its value; ask its author to declare `accessibility.role` in the manifest.',
        }))
      }
      if (blank(a11y.keyboard)) {
        out.push(finding({
          id: `custom-control:${f.key}:keyboard`, rule: 'custom-control', field_key: f.key, severity: 'review', wcag: ['2.1.1'],
          message: `${nameOf(f)} (${what}) does not say how it is used with a keyboard.`,
          help: 'Check that every part works with Tab, arrow keys, Enter and Space; the manifest should document it in `accessibility.keyboard`.',
        }))
      }
    }
    return out
  },
}

const ruleHides: Rule = {
  info: { rule: 'rule-hides-required', title: 'Rules do not hide required fields for good', wcag: ['3.3.2', '2.1.1'], level: 'A' },
  run: ({ def }) => rulesHidingRequiredFields({ fields: def.fields as never, layout: (def.layout ?? { rows: [] }) as never, buttons: (def.buttons ?? null) as never }).map((hit) => {
    const field = def.fields.find((f) => f.key === hit.field)
    return finding({
      id: `rule-hides-required:${hit.field}`, rule: 'rule-hides-required', field_key: hit.field, severity: 'serious', wcag: ['3.3.2', '2.1.1'],
      message: `The rule "${hit.rule}" hides the required field ${field ? nameOf(field) : hit.field} and nothing shows it again.`,
      help: 'Add a rule (or a button) that shows it again, make the hiding rule an "Always" rule with a condition, or make the field optional. A hidden field is not required, so the form can be submitted without it.',
    })
  }),
}

/** Every message / question step of the form: its rules' and Buttons' (responses included), with where it lives. */
function messageSteps(def: FormDefinition): Array<{ where: string; field_key?: string; action: FieldButtonAction }> {
  const out: Array<{ where: string; field_key?: string; action: FieldButtonAction }> = []
  for (const r of layoutFormRules(def.layout)) {
    if (r.disabled) continue
    for (const action of allActions(r.then)) out.push({ where: `the rule "${r.name || r.id}"`, action })
  }
  for (const f of def.fields) {
    if (f.type !== 'button') continue
    for (const action of allActions(f.button?.actions)) out.push({ where: `the button ${f.label || f.key}`, field_key: f.key, action })
  }
  return out.filter((s) => s.action.type === 'message' || s.action.type === 'prompt')
}

const formMessages: Rule = {
  info: { rule: 'form-messages', title: 'Messages stay long enough and questions have a name', wcag: ['2.2.1', '4.1.2'], level: 'A' },
  run: ({ def }) => {
    const out: AccessibilityFinding[] = []
    messageSteps(def).forEach(({ where, field_key, action }, i) => {
      if (action.type === 'message' && action.duration === 'auto' && (action.seconds ?? 6) < MIN_READABLE_SECONDS) {
        out.push(finding({
          id: `form-messages:short:${i}`, rule: 'form-messages', ...(field_key ? { field_key } : {}), severity: 'moderate', wcag: ['2.2.1'],
          message: `A message from ${where} hides itself after ${action.seconds} seconds.`,
          help: `Give people at least ${MIN_READABLE_SECONDS} seconds (it also pauses while hovered or focused), or keep it until dismissed.`,
        }))
      }
      if (action.type === 'prompt' && !accessibleName(action.title, action.text)) {
        out.push(finding({
          id: `form-messages:unnamed:${i}`, rule: 'form-messages', ...(field_key ? { field_key } : {}), severity: 'serious', wcag: ['4.1.2'],
          message: `A question from ${where} has no title or text a screen reader can announce.`,
          help: 'Give the question a title, or text that is not only a {{placeholder}}.',
        }))
      }
    })
    return out
  },
}

/**
 * Labels (lib/forms/label-field.ts) whose value changes while the form is
 * open are a polite live region, announced by their caption: without one a
 * screen reader hears a bare number with no idea what it is.
 */
const dynamicLabels: Rule = {
  info: { rule: 'label-dynamic-name', title: 'Labels that update have a caption', wcag: ['4.1.3', '1.3.1'], level: 'AA' },
  run: ({ ordered, def }) => ordered.filter((f) => f.type === 'label' && isDynamicLabel(f, def.layout) && isMachineLabel(f)).map((f) => {
    const suggestion = humanizeKey(f.key)
    return finding({
      id: `label-dynamic-name:${f.key}`, rule: 'label-dynamic-name', field_key: f.key, severity: 'serious', wcag: ['4.1.3', '1.3.1'],
      message: `Label "${f.key}" updates as the form is filled in, but has no caption${blank(f.label) ? '' : ` (only its key "${f.label}")`}.`,
      help: 'Its new value is announced to screen readers (a status message); the caption says what the value is ("Order total"). Hide the caption visually if you need to — it is still announced.',
      fix: { kind: 'field', label: 'Add caption', field_key: f.key, patch: { label: suggestion }, prompt: { property: 'label', question: `Caption for "${f.key}"`, suggestion } },
    })
  }),
}

/** Survey controls (lib/forms/survey/controls.ts): settings that make them harder to use. */
const surveyControls: Rule = {
  info: { rule: 'survey-controls', title: 'Survey controls stay easy to use', wcag: ['2.5.8', '1.3.1', '3.3.2', '1.4.1'], level: 'AA' },
  run: ({ values }) => {
    const out: AccessibilityFinding[] = []
    for (const f of values) {
      if (f.type === 'rating' && f.survey?.half) {
        out.push(finding({
          id: `survey-controls:${f.key}:half`, rule: 'survey-controls', field_key: f.key, severity: 'review', wcag: ['2.5.8'],
          message: `${nameOf(f)} allows half steps, so each half of a symbol is a 22px target.`,
          help: 'Half steps are spaced inside 44px symbols (the spacing exception), and the arrow keys move by half steps. Turn them off if people find them fiddly.',
          fix: { kind: 'field', label: 'Whole steps only', field_key: f.key, patch: { survey: { ...f.survey, half: undefined } } },
        }))
      }
      if (f.type === 'matrix' && (f.options?.length ?? 0) > 7) {
        out.push(finding({
          id: `survey-controls:${f.key}:columns`, rule: 'survey-controls', field_key: f.key, severity: 'minor', wcag: ['1.3.1'],
          message: `${nameOf(f)} has ${f.options!.length} columns: every statement repeats them for screen-reader users and they wrap on phones.`,
          help: 'Keep a grid to 5 (at most 7) columns, or split it into separate questions.',
        }))
      }
      if (f.type === 'matrix' && (f.survey?.rows?.length ?? 0) > 12) {
        out.push(finding({
          id: `survey-controls:${f.key}:rows`, rule: 'survey-controls', field_key: f.key, severity: 'review', wcag: ['3.3.2'],
          message: `${nameOf(f)} has ${f.survey!.rows!.length} statements in one grid.`,
          help: 'Long grids tire people out (and lower answer quality). Consider splitting it over two questions or steps.',
        }))
      }
      if (f.type === 'slider' && f.survey?.hide_value && !f.survey.low_label && !f.survey.high_label) {
        out.push(finding({
          id: `survey-controls:${f.key}:value`, rule: 'survey-controls', field_key: f.key, severity: 'moderate', wcag: ['3.3.2'],
          message: `${nameOf(f)} hides its value and has no end labels, so people can't tell what they picked.`,
          help: 'Show the value beside the slider, or label both ends.',
          fix: { kind: 'field', label: 'Show the value', field_key: f.key, patch: { survey: { ...f.survey, hide_value: undefined } } },
        }))
      }
      if (f.type === 'ranking' && (f.options?.length ?? 0) > 10) {
        out.push(finding({
          id: `survey-controls:${f.key}:options`, rule: 'survey-controls', field_key: f.key, severity: 'minor', wcag: ['3.3.2'],
          message: `${nameOf(f)} asks people to rank ${f.options!.length} options.`,
          help: 'Ranking more than about 7 items is hard, especially with the keyboard (Move up / down). Ask for the top few with a multi-select instead.',
        }))
      }
      if (f.type === 'nps' && f.survey?.bands && !f.help_text) {
        out.push(finding({
          id: `survey-controls:${f.key}:bands`, rule: 'survey-controls', field_key: f.key, severity: 'review', wcag: ['1.4.1'],
          message: `${nameOf(f)} colours its score bands; the colours carry no meaning on their own.`,
          help: 'The bands are decorative (the numbers and end labels say it all). If the bands matter to people, explain them in the help text.',
        }))
      }
    }
    return out
  },
}

export const STRUCTURAL_RULES: Rule[] = [
  labelMissing, placeholderOnly, placeholderInstructions, duplicateLabels, helpAssociation, requiredIndicator,
  errorSuggestion, focusOrder, targetSize, headings, language, inputPurpose, pages, timing, imageAlt, submittedPage,
  lookupAttachments, buttonNames, customControls, submitPath, ruleHides, formMessages, dynamicLabels, surveyControls,
]
