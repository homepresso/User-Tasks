/**
 * Survey controls (lib/forms/survey/controls.ts) as first-class field types:
 * normalising, validation (required / bounds / steps / options, a matrix's
 * every row), coercion to the stored type, read-only text, data table
 * columns, CSV columns, rule conditions on their values, the accessibility
 * audit's survey rule, and the controls' static render (roles, names,
 * required / read-only state).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  coerceTaskFieldValues, defaultTaskFieldValues, fieldDefinitionProblems, fieldValueSchemaType, isRuleMet, mergeTaskFieldValues, normalizeTaskFields,
  validateTaskFieldValues, TASK_FIELD_TYPES, type TaskFieldDef,
} from '@/lib/task-field-schema'
import {
  SURVEY_FIELD_TYPES, cleanOptionImage, formatSurveyValue, matrixRowKey, npsBand, snapToScale, surveyColumns, surveyConditionSubjects, surveyCsvColumns,
  surveyFieldDefaults, surveyScale,
} from '@/lib/forms/survey/controls'
import { ruleConditionMet } from '@/lib/forms/form-rules'
import { checkFormAccessibility } from '@/lib/forms/accessibility'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { SurveyAnswerView, SurveyFieldControl } from '@/components/forms/survey/survey-controls'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const field = (raw: Record<string, unknown>): TaskFieldDef => normalizeTaskFields([raw])[0]

const rating = field({ key: 'stars', label: 'Stars', type: 'rating', max: 5, required: true, survey: { icon: 'heart', half: true, bogus: 1 } })
const nps = field({ key: 'nps', label: 'Recommend', type: 'nps', survey: { bands: true, low_label: 'No', high_label: 'Yes' } })
const likert = field({ key: 'agree', label: 'Easy to use', type: 'likert', options: ['Disagree', 'Neutral', 'Agree'] })
const matrix = field({ key: 'grid', label: 'Rate', type: 'matrix', required: true, options: ['Bad', 'OK', 'Good'], survey: { rows: [{ label: 'Speed' }, { label: 'Price' }, { label: 'Speed' }] } })
const slider = field({ key: 'hours', label: 'Hours', type: 'slider', min: 0, max: 10, survey: { step: 0.5, unit: 'h' } })
const csat = field({ key: 'mood', label: 'Mood', type: 'csat', survey: { faces: 3 } })
const ranking = field({ key: 'rank', label: 'Rank', type: 'ranking', options: ['A', 'B', 'C'] })
const pics = field({ key: 'pic', label: 'Pick', type: 'image_choice', options: ['Tea', 'Coffee'], min: 1, max: 2, survey: { multiple: true, images: { Tea: 'icon:leaf', Coffee: 'javascript:alert(1)', Juice: 'icon:x' } } })
const ynm = field({ key: 'ynm', label: 'Come?', type: 'yes_no_maybe', options: ['Yes', 'No', 'Maybe'] })
const ALL = [rating, nps, likert, matrix, slider, csat, ranking, pics, ynm]

describe('survey field types: definitions', () => {
  it('are registered field types with a value type', () => {
    for (const t of SURVEY_FIELD_TYPES) expect(TASK_FIELD_TYPES).toContain(t)
    expect(ALL.map((f) => f.type)).toEqual([...SURVEY_FIELD_TYPES])
    expect(['rating', 'nps', 'slider', 'csat'].map((t) => fieldValueSchemaType(t as any))).toEqual(['number', 'number', 'number', 'number'])
    expect(fieldValueSchemaType('ranking')).toBe('array')
    expect(fieldValueSchemaType('matrix')).toBe('object')
  })

  it('normalise their settings: only what applies, unsafe images dropped, row keys unique', () => {
    expect(rating.survey).toEqual({ icon: 'heart', half: true })
    expect(rating.min).toBeUndefined()
    expect(matrix.survey?.rows).toEqual([{ key: 'speed', label: 'Speed' }, { key: 'price', label: 'Price' }, { key: 'speed_2', label: 'Speed' }])
    expect(pics.survey?.images).toEqual({ Tea: 'icon:leaf' })
    expect(cleanOptionImage('https://example.com/a.png')).toBe('https://example.com/a.png')
    expect(cleanOptionImage('/brand/a.png')).toBe('/brand/a.png')
    for (const bad of ['//evil.com/a.png', 'http://x.com/a.png', 'data:image/png;base64,AA', 'icon:nope']) expect(cleanOptionImage(bad)).toBeUndefined()
    expect(matrixRowKey('Value for money!')).toBe('value_for_money')
    expect(field({ key: 'one', label: 'One', type: 'image_choice', options: ['A', 'B'], min: 1, max: 2 }).max).toBeUndefined()
  })

  it('defaults are valid fields; problems are flagged', () => {
    const defaults = SURVEY_FIELD_TYPES.map((t) => field({ key: `f_${t}`, label: t, type: t, ...surveyFieldDefaults(t) }))
    expect(fieldDefinitionProblems(defaults)).toEqual({})
    expect(fieldDefinitionProblems([field({ key: 'g', label: 'G', type: 'matrix', options: ['A', 'B'] })]).g).toMatch(/row/)
    expect(fieldDefinitionProblems([field({ key: 'l', label: 'L', type: 'likert', options: ['Only'] })]).l).toMatch(/two options/)
    expect(fieldDefinitionProblems([field({ key: 's', label: 'S', type: 'slider', min: 5, max: 5 })]).s).toMatch(/greater/)
  })

  it('scales: rating with half steps, NPS, CSAT, slider', () => {
    expect(surveyScale(rating)).toEqual({ min: 0.5, max: 5, step: 0.5 })
    expect(surveyScale(nps)).toEqual({ min: 0, max: 10, step: 1 })
    expect(surveyScale(csat)).toEqual({ min: 1, max: 3, step: 1 })
    expect(surveyScale(slider)).toEqual({ min: 0, max: 10, step: 0.5 })
    expect(snapToScale(3.3, surveyScale(slider)!)).toBe(3.5)
    expect([0, 6, 7, 8, 9, 10].map(npsBand)).toEqual(['detractor', 'detractor', 'passive', 'passive', 'promoter', 'promoter'])
  })
})

describe('survey field types: values', () => {
  it('validate: required, bounds, steps, options, a full ranking, every matrix row', () => {
    const errors = validateTaskFieldValues(ALL, {
      stars: 3.25, nps: 11, agree: 'Maybe', grid: { speed: 'Good' }, hours: 3.3, mood: 4, rank: ['A', 'A', 'B'], pic: ['Tea', 'Juice'], ynm: 'Perhaps',
    })
    expect(errors.stars).toMatch(/steps of 0.5/)
    expect(errors.nps).toMatch(/between 0 and 10/)
    expect(errors.agree).toMatch(/one of/)
    expect(errors.grid).toMatch(/every row \(Price, Speed\)/)
    expect(errors.hours).toMatch(/steps of 0.5/)
    expect(errors.mood).toMatch(/between 1 and 3/)
    expect(errors.rank).toMatch(/only be ranked once/)
    expect(errors.pic).toMatch(/must be from/)
    expect(errors.ynm).toMatch(/one of/)
    expect(validateTaskFieldValues(ALL, {}).stars).toMatch(/required/)
    expect(validateTaskFieldValues(ALL, { grid: {} }).grid).toMatch(/required/)
    expect(validateTaskFieldValues([ranking], { rank: ['A', 'B'] }).rank).toMatch(/rank all 3/)
    expect(validateTaskFieldValues([pics], { pic: [] })).toEqual({})
    expect(validateTaskFieldValues([pics], { pic: ['Tea', 'Coffee', 'Tea'] }).pic).toMatch(/once/)
    expect(validateTaskFieldValues([matrix], { grid: { speed: 'Good', price: 'OK', speed_2: 'Bad', nope: 'OK' } }).grid).toMatch(/not one of its rows/)
  })

  it('accept good answers and coerce them to the stored type', () => {
    const good = { stars: '4.5', nps: '9', agree: 'Agree', grid: JSON.stringify({ speed: 'Good', price: 'OK', speed_2: 'Bad' }), hours: '2.5', mood: '3', rank: 'C,A,B', pic: ['Coffee'], ynm: 'Maybe' }
    expect(validateTaskFieldValues(ALL, good)).toEqual({})
    expect(coerceTaskFieldValues(ALL, good)).toEqual({
      stars: 4.5, nps: 9, agree: 'Agree', grid: { speed: 'Good', price: 'OK', speed_2: 'Bad' }, hours: 2.5, mood: 3, rank: ['C', 'A', 'B'], pic: ['Coffee'], ynm: 'Maybe',
    })
    expect(defaultTaskFieldValues(ALL)).toMatchObject({ stars: null, grid: null, rank: [], pic: [] })
    // The server's merge path (task forms, submissions) judges and stores the same way.
    const { errors, templateValues } = mergeTaskFieldValues({ fields: ALL }, good)
    expect(errors).toEqual({})
    expect(templateValues.grid).toEqual({ speed: 'Good', price: 'OK', speed_2: 'Bad' })
  })

  it('read as text for people', () => {
    expect(formatSurveyValue(rating, 4.5)).toBe('4.5 / 5')
    expect(formatSurveyValue(csat, 3)).toBe('Happy (3)')
    expect(formatSurveyValue(slider, 2.5)).toBe('2.5 h')
    expect(formatSurveyValue(matrix, { price: 'OK', speed: 'Good' })).toBe('Speed: Good; Price: OK')
    expect(formatSurveyValue(ranking, ['B', 'A'])).toBe('1. B, 2. A')
    expect(formatSurveyValue(ranking, [])).toBe('—')
  })
})

describe('survey field types: data tables, CSV, rules', () => {
  it('map to data table columns (a matrix: one select column per row)', () => {
    expect(surveyColumns(rating)).toEqual([{ key: 'stars', name: 'Stars', type: 'number', path: 'stars' }])
    expect(surveyColumns(likert)[0]).toMatchObject({ type: 'select', options: ['Disagree', 'Neutral', 'Agree'] })
    expect(surveyColumns(matrix).map((c) => [c.key, c.name, c.type, c.path])).toEqual([
      ['grid_speed', 'Rate: Speed', 'select', 'grid.speed'], ['grid_price', 'Rate: Price', 'select', 'grid.price'], ['grid_speed_2', 'Rate: Speed', 'select', 'grid.speed_2'],
    ])
    expect(surveyColumns(ranking)[0].type).toBe('text')
    expect(surveyColumns(pics)[0].type).toBe('text')
    expect(surveyColumns(ynm)[0]).toMatchObject({ type: 'select', options: ['Yes', 'No', 'Maybe'] })
  })

  it('CSV: a column per matrix row, a ranking as A > B > C', () => {
    const values = { grid: { speed: 'Good' }, rank: ['B', 'C', 'A'], pic: ['Tea', 'Coffee'] }
    expect(surveyCsvColumns(matrix).map((c) => [c.header, c.cell(values)])).toEqual([['grid.speed', 'Good'], ['grid.price', ''], ['grid.speed_2', '']])
    expect(surveyCsvColumns(ranking)[0].cell(values)).toBe('B > C > A')
    expect(surveyCsvColumns(pics)[0].cell(values)).toBe('Tea, Coffee')
  })

  it('rule conditions: equals / greater than on scores, contains on lists, a matrix row by path', () => {
    const scope = { values: { stars: 4, nps: 9, rank: ['B', 'A', 'C'], pic: ['Tea'], grid: { speed: 'Good' }, agree: 'Agree' } }
    expect(ruleConditionMet({ column: 'stars', operator: 'gt', value: '3' } as any, scope)).toBe(true)
    expect(ruleConditionMet({ column: 'nps', operator: 'lte', value: '6' } as any, scope)).toBe(false)
    expect(ruleConditionMet({ column: 'pic', operator: 'contains', value: 'Tea' } as any, scope)).toBe(true)
    expect(ruleConditionMet({ column: 'rank', operator: 'contains', value: 'C' } as any, scope)).toBe(true)
    expect(ruleConditionMet({ column: 'grid.speed', operator: 'eq', value: 'Good' } as any, scope)).toBe(true)
    expect(ruleConditionMet({ column: 'agree', operator: 'eq', value: 'Agree' } as any, scope)).toBe(true)
    expect(isRuleMet({ field: 'nps', operator: 'equals', value: '9' }, scope.values)).toBe(true)
    expect(surveyConditionSubjects(matrix).map((s) => s.value)).toEqual(['grid.speed', 'grid.price', 'grid.speed_2'])
  })
})

describe('survey field types: accessibility', () => {
  it('the audit flags fiddly settings', () => {
    const def = normalizeFormDefinition({
      fields: [
        rating,
        field({ key: 'wide', label: 'Wide grid', type: 'matrix', options: ['1', '2', '3', '4', '5', '6', '7', '8'], survey: { rows: [{ label: 'A' }] } }),
        field({ key: 'blind', label: 'Blind slider', type: 'slider', survey: { hide_value: true } }),
      ],
      layout: null,
    } as any)
    const ids = checkFormAccessibility(def).findings.filter((f) => f.rule === 'survey-controls').map((f) => f.id)
    expect(ids).toEqual(expect.arrayContaining(['survey-controls:stars:half', 'survey-controls:wide:columns', 'survey-controls:blind:value']))
  })

  it('render as labelled radio groups / lists with 44px targets, required and read-only state', () => {
    const html = (f: TaskFieldDef, value: unknown, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(SurveyFieldControl, { field: f, value, onChange: () => {}, id: `x-${f.key}`, describedBy: `x-${f.key}-help`, ...extra }))
    const stars = html(rating, 3)
    expect(stars).toContain('role="radiogroup"')
    expect(stars).toContain('aria-labelledby="x-stars-label"')
    expect(stars).toContain('aria-describedby="x-stars-help"')
    expect(stars).toContain('aria-required="true"')
    expect(stars).toContain('aria-label="3 hearts out of 5"')
    expect(stars).toMatch(/aria-checked="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-checked="true"/)
    expect((stars.match(/role="radio"/g) ?? []).length).toBe(10)
    const n = html(nps, null)
    expect((n.match(/role="radio"/g) ?? []).length).toBe(11)
    expect(n).toContain('min-h-11')
    expect(html(matrix, { speed: 'Good' }).match(/role="radiogroup"/g)?.length).toBe(3)
    expect(html(slider, null)).toContain('aria-valuetext="Not answered yet"')
    expect(html(slider, 2.5)).toContain('aria-valuetext="2.5 h"')
    expect(html(csat, 2)).toContain('aria-label="Neutral"')
    const rank = html(ranking, ['B', 'A', 'C'])
    expect(rank).toContain('<ol')
    expect(rank).toContain('Move B up (now 1 of 3)')
    expect(rank).toContain('aria-live="polite"')
    expect(html(pics, ['Tea'])).toContain('role="checkbox"')
    expect(html(ynm, 'No', { readOnly: true })).toContain('aria-readonly="true"')
    expect(html(ynm, 'No', { disabled: true })).toContain('disabled=""')
  })

  it('read-only answers render nicely', () => {
    const view = (f: TaskFieldDef, v: unknown) => renderToStaticMarkup(createElement(SurveyAnswerView, { field: f, value: v }))
    expect(view(rating, 4)).toContain('4 / 5')
    expect(view(nps, 10)).toContain('Promoter')
    expect(view(matrix, { speed: 'Good' })).toContain('<table')
    expect(view(ranking, ['C', 'B', 'A'])).toContain('<ol')
    expect(view(pics, ['Tea'])).toContain('Tea')
  })
})
