import { describe, expect, it, vi } from 'vitest'
import { normalizeFormDefinition, type FormDefinition } from '@/lib/forms/definition'
import {
  applyAccessibilityFix, checkFormAccessibility, mergeFindings, RULES, RULE_CAP, scoreFindings, SEVERITY_WEIGHT,
  suggestAutocomplete, type AccessibilityFinding, type CheckOptions,
} from '@/lib/forms/accessibility'
import { applyFixToDesigner } from '@/lib/forms/accessibility/designer'
import { targetPasses, TARGET_METRICS, humanizeKey, isMachineLabel, suggestedLabel } from '@/lib/forms/accessibility/rules'
import { criteriaFromAxeTags, levelOf, wcagUrl } from '@/lib/forms/accessibility/wcag'
import { formAccessibilityFromTenantSettings, parseFormAccessibilitySettings } from '@/lib/forms/accessibility/settings'
import { normalizeAutocomplete } from '@/lib/forms/autocomplete'
import { designerStateFrom, definitionFrom } from '@/lib/forms/designer-state'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { normalizeFormHeader } from '@/lib/forms/header'
import * as colors from '@/lib/theme/colors'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const OK_HEADER = { enabled: true, image: 'none', title: 'Leave request' }

/** A definition that passes every rule, with `fields` (and anything else) swapped in. */
function form(fields: any[], extra: Record<string, unknown> = {}): FormDefinition {
  return normalizeFormDefinition({ fields, header: OK_HEADER, ...extra } as any)
}

const ids = (def: FormDefinition, opts: CheckOptions = {}) => checkFormAccessibility(def, opts).findings.map((f) => f.id)
const rules = (def: FormDefinition, opts: CheckOptions = {}) => checkFormAccessibility(def, opts).findings.map((f) => f.rule)

const GOOD = [
  { key: 'reason', label: 'Reason', type: 'textarea' },
  { key: 'days', label: 'Days', type: 'number' },
]

describe('form accessibility: a clean form', () => {
  it('scores 100 with no findings and lists every rule as passed', () => {
    const result = checkFormAccessibility(form(GOOD))
    expect(result.findings).toEqual([])
    expect(result.score).toBe(100)
    expect(result.passed.map((r) => r.rule).sort()).toEqual(RULES.map((r) => r.rule).sort())
    expect(result.summary).toEqual({ total: 0, critical: 0, serious: 0, moderate: 0, minor: 0, review: 0 })
  })

  it('structuralOnly skips the colour rules', () => {
    const result = checkFormAccessibility(form(GOOD), { structuralOnly: true })
    expect(result.passed.some((r) => r.rule.startsWith('contrast'))).toBe(false)
  })
})

describe('labels', () => {
  it('label-missing: an empty label (normalized to its key) is critical/serious, a real label passes', () => {
    const def = form([{ key: 'field_1', label: '', type: 'text' }, ...GOOD])
    const f = checkFormAccessibility(def).findings.find((x) => x.rule === 'label-missing')!
    expect(f).toMatchObject({ field_key: 'field_1', severity: 'serious', wcag: ['1.3.1', '2.4.6', '4.1.2'], level: 'A' })
    expect(f.fix).toMatchObject({ kind: 'field', label: 'Add label', patch: { label: 'Field 1' } })
    // A truly empty label (designer state before normalization) is critical.
    const raw = { ...form(GOOD), fields: [{ key: 'x', label: '', type: 'text' } as any, ...form(GOOD).fields] }
    expect(checkFormAccessibility(raw).findings.find((x) => x.rule === 'label-missing')?.severity).toBe('critical')
    expect(rules(form(GOOD))).not.toContain('label-missing')
  })

  it('isMachineLabel / humanizeKey', () => {
    expect(isMachineLabel({ key: 'first_name', label: 'first_name' })).toBe(true)
    expect(isMachineLabel({ key: 'name', label: 'name' })).toBe(false)
    expect(isMachineLabel({ key: 'x', label: 'field_2' })).toBe(true)
    expect(isMachineLabel({ key: 'text_2', label: 'Text 2' })).toBe(true)
    expect(isMachineLabel({ key: 'email', label: 'Email' })).toBe(false)
    expect(suggestedLabel({ key: 'field_2', type: 'email' })).toBe('Email')
    expect(suggestedLabel({ key: 'field_2', type: 'text' })).toBe('')
    expect(suggestedLabel({ key: 'contact_name', type: 'text' })).toBe('Contact name')
    expect(humanizeKey('first_name')).toBe('First name')
  })

  it('label-placeholder-only: a placeholder standing in for the label', () => {
    const def = form([{ key: 'field_2', label: '', type: 'text', placeholder: 'Your email' }, ...GOOD])
    const f = checkFormAccessibility(def).findings.find((x) => x.rule === 'label-placeholder-only')!
    expect(f).toMatchObject({ severity: 'serious', wcag: ['3.3.2', '1.3.1'] })
    expect(rules(def)).not.toContain('label-missing')
    expect(rules(form([{ key: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' }]))).not.toContain('label-placeholder-only')
  })

  it('placeholder-instructions: long or format placeholders without help text', () => {
    expect(rules(form([{ key: 'ref', label: 'Reference', type: 'text', placeholder: 'Format: AAA-1234' }]))).toContain('placeholder-instructions')
    expect(rules(form([{ key: 'ref', label: 'Reference', type: 'text', placeholder: 'Format: AAA-1234', help_text: 'Three letters, dash, four digits' }]))).not.toContain('placeholder-instructions')
    expect(rules(form([{ key: 'ref', label: 'Reference', type: 'text', placeholder: 'ABC-1234' }]))).not.toContain('placeholder-instructions')
  })

  it('label-duplicate: same label twice (case-insensitive)', () => {
    const def = form([{ key: 'a', label: 'Amount', type: 'number' }, { key: 'b', label: 'amount ', type: 'number' }])
    expect(ids(def)).toContain('label-duplicate:b')
    expect(rules(form([{ key: 'a', label: 'Amount', type: 'number' }, { key: 'b', label: 'Amount (tax)', type: 'number' }]))).not.toContain('label-duplicate')
  })

  it('lookup and attachments controls need labels too, and a pick-only lookup needs instructions', () => {
    expect(ids(form([{ key: 'cust_1', label: '', type: 'lookup', lookup: { source: 'table', table_id: 't' } }]))).toContain('label-missing:cust_1')
    expect(ids(form([{ key: 'files_1', label: '', type: 'attachments' }]))).toContain('label-missing:files_1')
    const lookup = { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: 't' } }
    expect(rules(form([lookup]))).toContain('lookup-attachments')
    expect(rules(form([{ ...lookup, help_text: 'Pick a customer' }]))).not.toContain('lookup-attachments')
    expect(rules(form([{ ...lookup, lookup: { ...lookup.lookup, allow_free_text: true } }]))).not.toContain('lookup-attachments')
  })
})

describe('help, required and errors', () => {
  it('help-association: a section description without heading text; custom controls naming themselves', () => {
    expect(ids(form([{ key: 'section_1', label: '', type: 'heading', help_text: 'About you' }, ...GOOD]))).toContain('help-association:section_1')
    expect(rules(form([{ key: 'about', label: 'About you', type: 'heading', help_text: 'Tell us' }, ...GOOD]))).not.toContain('help-association')
    const custom = { key: 'rating', label: 'Rating', type: 'text', help_text: '1 to 5' }
    const def = form([custom])
    ;(def.fields[0] as any).type = 'custom'
    ;(def.fields[0] as any).custom = { tag: 'acme-rating', accessibility: { labelled_by_host: false, role: 'slider', keyboard: 'Arrows' } }
    expect(checkFormAccessibility(def).findings.find((f) => f.rule === 'help-association')?.severity).toBe('review')
  })

  it('required-indicator: the asterisk is explained, and required is said in text for controls that do not announce it', () => {
    const fields = [{ key: 'agree', label: 'I agree', type: 'boolean', required: true }]
    const found = ids(form(fields))
    expect(found).toEqual(expect.arrayContaining(['required-indicator:legend', 'required-indicator:agree']))
    const explained = form([{ ...fields[0], help_text: 'Required to continue' }], { header: { ...OK_HEADER, subtitle: 'Fields marked * are required.' } })
    expect(rules(explained)).not.toContain('required-indicator')
    // A text input announces required (aria-required): only the legend is needed.
    expect(ids(form([{ key: 'reason', label: 'Reason', type: 'text', required: true }]))).toEqual(['required-indicator:legend'])
  })

  it('error-suggestion: a pattern without a message', () => {
    const def = form([{ key: 'code', label: 'Code', type: 'text', pattern: '^[A-Z]{3}$' }])
    const f = checkFormAccessibility(def).findings.find((x) => x.rule === 'error-suggestion')!
    expect(f).toMatchObject({ severity: 'moderate', wcag: ['3.3.1', '3.3.3'], level: 'A' })
    expect(rules(form([{ key: 'code', label: 'Code', type: 'text', pattern: '^[A-Z]{3}$', pattern_message: 'Three capital letters' }]))).not.toContain('error-suggestion')
  })
})

describe('order, headings, pages, language, timing', () => {
  it('focus-order: a field revealed by a controller placed after it', () => {
    const fields = [
      { key: 'other', label: 'Other reason', type: 'text', visible_when: { field: 'kind', operator: 'equals', value: 'Other' } },
      { key: 'kind', label: 'Kind', type: 'choice', options: ['Sick', 'Other'] },
    ]
    expect(ids(form(fields))).toContain('focus-order:other')
    // The grid decides the order, not the field list.
    const layout = { rows: [{ columns: 1, cells: [{ field_key: 'kind', span: 1 }] }, { columns: 1, cells: [{ field_key: 'other', span: 1 }] }] }
    expect(rules(form(fields, { layout }))).not.toContain('focus-order')
  })

  it('focus-order: a visible_when cycle is serious with an "Always show" fix', () => {
    const def = form([
      { key: 'a', label: 'A', type: 'text', visible_when: { field: 'b', operator: 'is_set' } },
      { key: 'b', label: 'B', type: 'text', visible_when: { field: 'a', operator: 'is_set' } },
    ])
    const f = checkFormAccessibility(def).findings.find((x) => x.id === 'focus-order:a:cycle')!
    expect(f.severity).toBe('serious')
    const fixed = applyAccessibilityFix(def, f.fix!)
    expect(ids(fixed)).not.toContain('focus-order:a:cycle')
  })

  it('headings: empty section headings, long forms without sections, and the form title', () => {
    expect(ids(form([{ key: 'heading_1', label: '', type: 'heading' }, ...GOOD]))).toContain('headings:heading_1')
    const many = Array.from({ length: 8 }, (_, i) => ({ key: `q${i}`, label: `Question ${i + 1}`, type: 'text' }))
    expect(ids(form(many))).toContain('headings:sections')
    expect(ids(form([{ key: 's', label: 'Section', type: 'heading' }, ...many]))).not.toContain('headings:sections')
    expect(ids(form([...many.slice(0, 4), { key: 's', label: 'More', type: 'heading' }, ...many.slice(4)]))).toContain('headings:first')
    const untitled = form(GOOD, { header: { enabled: true, image: 'default' } })
    expect(checkFormAccessibility(untitled).findings.find((f) => f.id === 'headings:title')?.severity).toBe('moderate')
    expect(checkFormAccessibility(form(GOOD, { header: null })).findings.find((f) => f.id === 'headings:title')?.severity).toBe('minor')
    expect(rules(form(GOOD))).not.toContain('headings')
  })

  it('pages: titles present and unique (read generically from the layout or options)', () => {
    expect(rules(form(GOOD), { pages: [{ title: 'You' }, { title: '' }] })).toContain('pages')
    expect(ids(form(GOOD), { pages: [{ id: 'p1', title: 'You' }, { id: 'p2', title: 'you' }] })).toContain('pages:p2:duplicate')
    expect(rules(form(GOOD), { pages: [{ title: 'You' }, { title: 'Leave' }] })).not.toContain('pages')
    const def = form(GOOD)
    ;(def as any).layout = { rows: def.layout?.rows ?? [], pages: [{ id: 'a', title: 'One' }, { id: 'b' }] }
    expect(ids(def)).toContain('pages:b:missing')
  })

  it('language: missing or invalid lang is serious; foreign-script content under "en" is a review item', () => {
    expect(ids(form(GOOD), { language: null })).toContain('language:missing')
    expect(ids(form(GOOD), { language: 'english!' })).toContain('language:missing')
    expect(rules(form(GOOD), { language: 'en-NZ' })).not.toContain('language')
    const greek = form([{ key: 'onoma', label: 'Ονοματεπώνυμο αιτούντος', type: 'text' }, { key: 'dieuthinsi', label: 'Διεύθυνση κατοικίας', type: 'text' }])
    expect(ids(greek, { language: 'en' })).toContain('language:parts')
    expect(rules(greek, { language: 'el' })).not.toContain('language')
  })

  it('timing: a fixed time limit is serious, an auto-expiring task is a review item', () => {
    expect(ids(form(GOOD), { timeouts: { time_limit_seconds: 600 } })).toContain('timing:limit')
    expect(ids(form(GOOD), { timeouts: { time_limit_seconds: 600, extendable: true } })).not.toContain('timing:limit')
    expect(checkFormAccessibility(form(GOOD), { timeouts: { auto_expire: true } }).findings.find((f) => f.rule === 'timing')?.severity).toBe('review')
    expect(rules(form(GOOD), { timeouts: null })).not.toContain('timing')
  })
})

describe('input purpose (1.3.5)', () => {
  it.each([
    [{ key: 'first_name', label: 'First name', type: 'text' }, 'given-name'],
    [{ key: 'surname', label: 'Surname', type: 'text' }, 'family-name'],
    [{ key: 'name', label: 'Name', type: 'text' }, 'name'],
    [{ key: 'contact', label: 'Contact email', type: 'email' }, 'email'],
    [{ key: 'mobile', label: 'Mobile', type: 'phone' }, 'tel'],
    [{ key: 'postcode', label: 'Postcode', type: 'text' }, 'postal-code'],
    [{ key: 'dob', label: 'Date of birth', type: 'date' }, 'bday'],
    [{ key: 'company', label: 'Company', type: 'text' }, 'organization'],
    [{ key: 'country', label: 'Country', type: 'text' }, 'country-name'],
    [{ key: 'address', label: 'Home address', type: 'textarea' }, 'street-address'],
  ])('%o → %s', (field, token) => {
    expect(suggestAutocomplete(field as any)).toBe(token)
  })

  it.each([
    [{ key: 'product_name', label: 'Product name', type: 'text' }],
    [{ key: 'status', label: 'Order status', type: 'text' }],
    [{ key: 'due', label: 'Due date', type: 'date' }],
    [{ key: 'country', label: 'Country', type: 'choice' }],
  ])('no token for %o', (field) => {
    expect(suggestAutocomplete(field as any)).toBeNull()
  })

  it('flags a personal-data field without autocomplete and the fix applies the token', () => {
    const def = form([{ key: 'first_name', label: 'First name', type: 'text' }])
    const f = checkFormAccessibility(def).findings.find((x) => x.rule === 'input-purpose')!
    expect(f).toMatchObject({ severity: 'moderate', wcag: ['1.3.5'], level: 'AA', fix: { label: 'Apply autocomplete', patch: { autocomplete: 'given-name' } } })
    const fixed = applyAccessibilityFix(def, f.fix!)
    expect(fixed.fields[0].autocomplete).toBe('given-name')
    expect(rules(fixed)).not.toContain('input-purpose')
  })

  it('the field schema keeps only valid WHATWG tokens on input types', () => {
    expect(normalizeAutocomplete('given-name')).toBe('given-name')
    expect(normalizeAutocomplete(' Shipping  Postal-Code ')).toBe('shipping postal-code')
    expect(normalizeAutocomplete('work email')).toBe('work email')
    expect(normalizeAutocomplete('work given-name')).toBeUndefined()
    expect(normalizeAutocomplete('favourite-colour')).toBeUndefined()
    expect(normalizeAutocomplete('off')).toBe('off')
    const fields = normalizeTaskFields([
      { key: 'a', label: 'A', type: 'text', autocomplete: 'email' },
      { key: 'b', label: 'B', type: 'text', autocomplete: 'bogus' },
      { key: 'c', label: 'C', type: 'choice', options: ['x'], autocomplete: 'email' },
    ])
    expect(fields.map((f) => f.autocomplete)).toEqual(['email', undefined, undefined])
  })
})

describe('images, buttons, custom controls, target size', () => {
  const upload = { enabled: true, image: 'upload', image_url: 'storage://task-files/form-headers/da680d12-52d1-4097-a260-d6e5bf87c9d3/logo.png', title: 'Leave' }

  it('image-alt: an uploaded header image needs alt text (prompted fix)', () => {
    const def = form(GOOD, { header: upload })
    const f = checkFormAccessibility(def).findings.find((x) => x.rule === 'image-alt')!
    expect(f).toMatchObject({ severity: 'serious', wcag: ['1.1.1'], fix: { kind: 'header', label: 'Add alt text', prompt: { property: 'image_alt' } } })
    const fixed = applyAccessibilityFix(def, f.fix!, 'Northwind logo')
    expect(fixed.header?.image_alt).toBe('Northwind logo')
    expect(rules(fixed)).not.toContain('image-alt')
    expect(normalizeFormHeader({ ...upload, image_alt: '  Northwind logo ' })?.image_alt).toBe('Northwind logo')
    expect(normalizeFormHeader({ enabled: true, image: 'none', image_alt: 'x' })?.image_alt).toBeUndefined()
  })

  it('button-names: empty, duplicate and generic button text', () => {
    const buttons = (list: any[]) => form(GOOD, { buttons: list })
    const base = { kind: 'submit', style: 'primary' }
    expect(ids(buttons([{ id: 'a', label: 'Send', ...base }, { id: 'b', label: 'send', kind: 'cancel', style: 'secondary' }]))).toContain('button-names:b:duplicate')
    expect(ids(buttons([{ id: 'a', label: 'OK', ...base }]))).toContain('button-names:a:generic')
    const blank = form(GOOD)
    blank.buttons = [{ id: 'go', label: '', kind: 'submit', style: 'primary' }]
    const f = checkFormAccessibility(blank).findings.find((x) => x.id === 'button-names:go')!
    expect(f.severity).toBe('critical')
    expect(rules(applyAccessibilityFix(blank, f.fix!))).not.toContain('button-names')
    expect(rules(buttons([{ id: 'a', label: 'Send request', ...base }]))).not.toContain('button-names')
  })

  it('custom-control: no role while naming itself, or no keyboard notes → review items', () => {
    const def = form([{ key: 'stars', label: 'Rating', type: 'text' }])
    ;(def.fields[0] as any).type = 'custom'
    ;(def.fields[0] as any).custom = { tag: 'acme-stars', accessibility: { labelled_by_host: false } }
    const found = checkFormAccessibility(def).findings.filter((f) => f.rule === 'custom-control')
    expect(found.map((f) => f.id)).toEqual(['custom-control:stars:keyboard', 'custom-control:stars:name'])
    expect(found.every((f) => f.severity === 'review')).toBe(true)
    ;(def.fields[0] as any).custom = { tag: 'acme-stars', accessibility: { role: 'slider', keyboard: 'Left / Right arrows' } }
    expect(rules(def)).not.toContain('custom-control')
    // Labelled by the host by default: an empty host label is still a label finding.
    ;(def.fields[0] as any).label = ''
    expect(rules(def)).toContain('label-missing')
  })

  it('target-size: the renderer’s targets pass; smaller ones fail unless spaced', () => {
    expect(targetPasses(TARGET_METRICS.comfortable.radio)).toBe(true)
    expect(targetPasses(TARGET_METRICS.compact.chip)).toBe(true)
    expect(targetPasses({ height: 16, gap: 2 })).toBe(false)
    expect(targetPasses({ height: 16, gap: 8 })).toBe(true)
    expect(rules(form([{ key: 'k', label: 'Kind', type: 'choice', display: 'radio', options: ['a', 'b'] }]))).not.toContain('target-size')
    const spy = vi.spyOn(TARGET_METRICS.comfortable, 'radio', 'get').mockReturnValue({ height: 16, gap: 2 })
    try {
      expect(ids(form([{ key: 'k', label: 'Kind', type: 'choice', display: 'radio', options: ['a', 'b'] }]))).toContain('target-size:k')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('colour contrast (reusing lib/theme)', () => {
  const lowTheme = { source: 'custom', overrides: { colors: { light: { text: '#bbbbbb', background: '#ffffff', accent: '#dddddd' } } } }

  it('measures with the shared contrastRatio helper (known ratios)', () => {
    const spy = vi.spyOn(colors, 'contrastRatio')
    checkFormAccessibility(form(GOOD))
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
    expect(colors.contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(colors.contrastRatio('#767676', '#FFFFFF')!).toBeGreaterThan(4.5)
  })

  it('the default workspace theme passes in light and dark', () => {
    const theme = defaultWorkspaceTheme()
    expect(rules(form(GOOD), { theme: { light: theme.colors.light, dark: theme.colors.dark } }).filter((r) => r.startsWith('contrast'))).toEqual([])
  })

  it('a low-contrast mini theme: raw colours (theme), the focus ring and the selected state fail; Auto-fix contrast fixes them', () => {
    const def = form([...GOOD, { key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'] }], { theme: lowTheme })
    const result = checkFormAccessibility(def, { modes: ['light'] })
    const found = result.findings.map((f) => f.id)
    expect(found).toEqual(expect.arrayContaining([
      'contrast-theme:light:text/background', 'contrast-theme:light:accent/background', 'contrast-focus:light:focus ring/background', 'color-only-state:light',
    ]))
    const text = result.findings.find((f) => f.id === 'contrast-theme:light:text/background')!
    expect(text).toMatchObject({ severity: 'serious', wcag: ['1.4.3'], mode: 'light', fix: { kind: 'theme', label: 'Auto-fix contrast' } })
    const fixed = applyAccessibilityFix(def, text.fix!)
    const after = checkFormAccessibility(fixed, { modes: ['light'] })
    expect(after.findings.filter((f) => f.rule.startsWith('contrast') || f.rule === 'color-only-state')).toEqual([])
    expect(after.score).toBeGreaterThan(result.score)
  })

  it('a saved theme the caller did not resolve is a review item; resolved, it is checked', () => {
    const def = form(GOOD, { theme: { source: 'saved', theme_id: '11111111-1111-4111-8111-111111111111' } })
    expect(ids(def)).toContain('contrast-theme:saved')
    expect(ids(def, { theme: { overrides: lowTheme.overrides as any } })).toContain('contrast-theme:light:text/background')
  })
})

describe('score, merge and helpers', () => {
  const f = (rule: string, severity: AccessibilityFinding['severity'], id = `${rule}:${severity}:${Math.random()}`): AccessibilityFinding => ({ id, rule, severity, wcag: ['1.3.1'], level: 'A', message: 'm', help: 'h' })

  it('weights by severity, caps each rule, 100 only with no findings', () => {
    expect(scoreFindings([])).toBe(100)
    expect(scoreFindings([f('a', 'review')])).toBe(99)
    expect(scoreFindings([f('a', 'critical'), f('b', 'minor')])).toBe(100 - SEVERITY_WEIGHT.critical - SEVERITY_WEIGHT.minor)
    expect(scoreFindings(Array.from({ length: 10 }, () => f('a', 'critical')))).toBe(100 - RULE_CAP)
    expect(scoreFindings(Array.from({ length: 12 }, (_, i) => f(`r${i}`, 'critical')))).toBe(0)
  })

  it('sorts findings by severity', () => {
    const result = checkFormAccessibility(form([{ key: 'field_1', label: '', type: 'text' }, { key: 'code', label: 'Code', type: 'text', pattern: 'x' }]))
    const order = result.findings.map((x) => x.severity)
    expect(order).toEqual([...order].sort((a, b) => ['critical', 'serious', 'moderate', 'minor', 'review'].indexOf(a) - ['critical', 'serious', 'moderate', 'minor', 'review'].indexOf(b)))
  })

  it('mergeFindings drops duplicates (same id, same rule on the same field, same targets) and rescoring', () => {
    const base = checkFormAccessibility(form([{ key: 'field_1', label: '', type: 'text', placeholder: 'Email' }, ...GOOD]))
    const extra: AccessibilityFinding[] = [
      { ...f('label-missing', 'critical', 'axe:label:#preview-field_1'), field_key: 'field_1', source: 'axe', targets: ['#preview-field_1'] },
      { ...f('axe-region', 'moderate', 'axe:region:#x'), source: 'axe', targets: ['#x'] },
      { ...f('axe-region', 'moderate', 'axe:region:#x-dark'), source: 'axe', targets: ['#x'] },
    ]
    const merged = mergeFindings(base, extra)
    expect(merged.findings.filter((x) => x.source === 'axe').map((x) => x.id)).toEqual(['axe:region:#x'])
    expect(merged.score).toBe(base.score - SEVERITY_WEIGHT.moderate)
  })

  it('wcag helpers', () => {
    expect(wcagUrl('1.4.3')).toBe('https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum')
    expect(levelOf(['1.4.3', '1.3.5'])).toBe('AA')
    expect(levelOf(['1.4.3', '1.3.1'])).toBe('A')
    expect(criteriaFromAxeTags(['wcag2a', 'wcag111', 'wcag1411', 'best-practice'])).toEqual(['1.1.1', '1.4.11'])
  })

  it('settings parse with defaults', () => {
    expect(parseFormAccessibilitySettings(undefined)).toEqual({ mode: 'warn', min_score: 80 })
    expect(parseFormAccessibilitySettings({ mode: 'block', min_score: 120 })).toEqual({ mode: 'block', min_score: 100 })
    expect(formAccessibilityFromTenantSettings({ forms: { accessibility: { mode: 'off', min_score: 50 } } })).toEqual({ mode: 'off', min_score: 50 })
  })
})

describe('fixes', () => {
  it('every fix on a poor form removes its finding (definition and designer state)', () => {
    const poor = form([
      { key: 'field_1', label: '', type: 'text', placeholder: 'Your email' },
      { key: 'field_2', label: '', type: 'text' },
      { key: 'first_name', label: 'First name', type: 'text' },
      { key: 'code', label: 'Code', type: 'text', pattern: '^[A-Z]+$' },
      { key: 'agree', label: 'I agree', type: 'boolean', required: true },
    ], { header: { enabled: true, image: 'upload', image_url: 'storage://task-files/form-headers/da680d12-52d1-4097-a260-d6e5bf87c9d3/x.png' } })
    const before = checkFormAccessibility(poor)
    let state = designerStateFrom(poor)
    let def = poor
    for (const finding of before.findings) {
      if (!finding.fix) continue
      const answer = finding.fix.prompt ? (finding.fix.prompt.suggestion || 'Answer') : undefined
      def = applyAccessibilityFix(def, finding.fix, answer)
      state = applyFixToDesigner(state, finding.fix, answer)
    }
    const fixedIds = before.findings.filter((x) => x.fix).map((x) => x.id)
    const afterDef = checkFormAccessibility(def)
    const afterState = checkFormAccessibility(definitionFrom(state))
    for (const id of fixedIds) {
      expect(afterDef.findings.map((x) => x.id)).not.toContain(id)
      expect(afterState.findings.map((x) => x.id)).not.toContain(id)
    }
    expect(afterDef.score).toBeGreaterThan(before.score)
  })
})
