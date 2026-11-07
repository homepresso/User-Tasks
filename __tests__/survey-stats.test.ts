/**
 * Survey aggregation (lib/forms/survey-stats.ts) — NPS math, rating and
 * CSAT distributions, Likert shares, matrix rows (also from the wizard's
 * per-statement columns), slider histograms, ranking positions, choices,
 * trend and completion — and the charts (components/forms/survey-charts)
 * rendering those aggregates with text alternatives and table data; plus
 * the wizard's survey question kinds end to end (fields, columns, the
 * workflow's column values and the one responses report).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import {
  completionStats, csatStat, likertStat, matrixStat, npsStat, rankingStat, ratingStat, responseTrend, sliderStat, statHeadline, surveyStats, tableRowValue,
  choiceStat, type SurveyStat,
} from '@/lib/forms/survey-stats'
import { SurveyStatChart, statTable } from '@/components/forms/survey-charts/survey-charts'
import { WizardSpecSchema, type WizardSpecInput } from '@/lib/forms/wizard/spec'
import { assignWizardKeys, buildFormFields, buildReports, buildTableColumns, buildWorkflow } from '@/lib/forms/wizard/build'
import { specFromTemplate } from '@/lib/forms/wizard/templates'
import { fieldDefinitionProblems } from '@/lib/task-field-schema'
import { resolveExpression } from '@/lib/expression-resolver'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const f = (raw: Record<string, unknown>): TaskFieldDef => normalizeTaskFields([raw])[0]

describe('survey stats', () => {
  it('NPS: % promoters − % detractors, rounded; groups and 0–10 distribution', () => {
    const s = npsStat(f({ key: 'n', label: 'N', type: 'nps' }), [10, 9, 9, 8, 7, 6, 0, '10', null, 11])
    // 4 promoters (10, 9, 9, 10), 2 passives, 2 detractors of 8 valid → 25
    expect(s).toMatchObject({ answered: 8, promoters: 4, passives: 2, detractors: 2, score: 25 })
    expect(s.distribution.find((b) => b.name === '9')!.value).toBe(2)
    expect(npsStat(f({ key: 'n', label: 'N', type: 'nps' }), [0, 3]).score).toBe(-100)
    expect(npsStat(f({ key: 'n', label: 'N', type: 'nps' }), []).score).toBeNull()
  })

  it('rating: average and per-point distribution (half steps count on the point above)', () => {
    const s = ratingStat(f({ key: 'r', label: 'R', type: 'rating', max: 5, survey: { half: true } }), [5, 4.5, 3, 1])
    expect(s.average).toBe(3.38)
    expect(s.distribution.map((b) => b.value)).toEqual([1, 0, 1, 0, 2])
  })

  it('Likert: distribution, average position, agree / neutral / disagree shares', () => {
    const s = likertStat(f({ key: 'l', label: 'L', type: 'likert', options: ['SD', 'D', 'N', 'A', 'SA'] }), ['SA', 'A', 'A', 'N', 'D', 'x'])
    expect(s.distribution.map((b) => b.value)).toEqual([0, 1, 1, 2, 1])
    expect(s).toMatchObject({ answered: 5, average: 3.6, agree: 60, neutral: 20, disagree: 20 })
  })

  it('matrix: per row counts and averages, from objects or per-statement columns', () => {
    const m = f({ key: 'g', label: 'G', type: 'matrix', options: ['Bad', 'OK', 'Good'], survey: { rows: [{ label: 'Speed' }, { label: 'Price' }] } })
    expect(tableRowValue(m, { g_speed: 'Good', g_price: 'OK' })).toEqual({ speed: 'Good', price: 'OK' })
    const [s] = surveyStats([m], [{ g: { speed: 'Good', price: 'Bad' } }, { g_speed: 'OK' }, {}]) as any[]
    expect(s.kind).toBe('matrix')
    expect(s.answered).toBe(2)
    expect(s.total).toBe(3)
    expect(s.rows).toEqual([
      { key: 'speed', label: 'Speed', counts: [0, 1, 1], answered: 2, average: 2.5 },
      { key: 'price', label: 'Price', counts: [1, 0, 0], answered: 1, average: 1 },
    ])
    expect(matrixStat(m, []).rows[0].average).toBeNull()
  })

  it('slider: average, median, range, histogram per point or in 10 bins', () => {
    const small = sliderStat(f({ key: 's', label: 'S', type: 'slider', min: 0, max: 10, survey: { step: 1, unit: 'h' } }), [2, 4, 4, 10])
    expect(small).toMatchObject({ average: 5, median: 4, lowest: 2, highest: 10, unit: 'h' })
    expect(small.histogram).toHaveLength(11)
    const big = sliderStat(f({ key: 's', label: 'S', type: 'slider', min: 0, max: 1000 }), [0, 999, 1000, 500])
    expect(big.histogram).toHaveLength(10)
    expect(big.histogram[9].value).toBe(2)
    expect(big.histogram.reduce((a, b) => a + b.value, 0)).toBe(4)
  })

  it('CSAT: satisfied share (top two of five, top one of three)', () => {
    expect(csatStat(f({ key: 'c', label: 'C', type: 'csat' }), [5, 4, 3, 1])).toMatchObject({ satisfied: 50, average: 3.25 })
    expect(csatStat(f({ key: 'c', label: 'C', type: 'csat', survey: { faces: 3 } }), [3, 2, 3])).toMatchObject({ satisfied: 66.7, faces: 3 })
  })

  it('ranking: average position (best first), first places, positions', () => {
    const s = rankingStat(f({ key: 'k', label: 'K', type: 'ranking', options: ['A', 'B', 'C'] }), [['B', 'A', 'C'], ['B', 'C', 'A'], 'A > B > C', []])
    expect(s.answered).toBe(3)
    expect(s.items.map((i) => [i.name, i.average_position, i.first])).toEqual([['B', 1.33, 2], ['A', 2, 1], ['C', 2.67, 0]])
    expect(s.items[0].positions).toEqual([2, 1, 0])
  })

  it('choices: counts (several per answer), split display for yes / no / maybe and checkboxes', () => {
    const multi = choiceStat(f({ key: 'm', label: 'M', type: 'multi_choice', options: ['A', 'B'] }), [['A', 'B'], ['A'], '["B"]'])
    expect(multi).toMatchObject({ multiple: true, display: 'bar', answered: 3 })
    expect(multi.distribution.map((b) => b.value)).toEqual([2, 2])
    expect(choiceStat(f({ key: 'y', label: 'Y', type: 'yes_no_maybe', options: ['Yes', 'No', 'Maybe'] }), ['Yes', 'Maybe']).display).toBe('split')
    expect(choiceStat(f({ key: 'b', label: 'B', type: 'boolean' }), [true, false, 'true']).distribution.map((b) => [b.label, b.value])).toEqual([['Yes', 2], ['No', 1]])
  })

  it('trend and completion', () => {
    const now = Date.parse('2026-11-06T12:00:00Z')
    const t = responseTrend(['2026-11-06T01:00:00Z', '2026-11-05T23:00:00Z', '2026-11-05T01:00:00Z', '2026-09-01T00:00:00Z', 'bad'], 7, now)
    expect(t).toHaveLength(7)
    expect(t[6]).toEqual({ date: '2026-11-06', count: 1 })
    expect(t[5]).toEqual({ date: '2026-11-05', count: 2 })
    const fields = [f({ key: 'a', label: 'A', type: 'text' }), f({ key: 'g', label: 'G', type: 'matrix', options: ['x', 'y'], survey: { rows: [{ label: 'R' }] } })]
    expect(completionStats(fields, [{ a: 'hi', g: {} }, { g_r: 'x' }])).toEqual([{ key: 'a', label: 'A', answered: 1, share: 50 }, { key: 'g', label: 'G', answered: 1, share: 50 }])
  })

  it('headlines read as one line', () => {
    expect(statHeadline(npsStat(f({ key: 'n', label: 'N', type: 'nps' }), [10, 0]))).toBe('NPS 0 · 1 promoters, 0 passives, 1 detractors')
    expect(statHeadline(csatStat(f({ key: 'c', label: 'C', type: 'csat' }), [5]))).toMatch(/CSAT 100% satisfied/)
  })
})

describe('survey charts render from aggregates', () => {
  const stats: SurveyStat[] = surveyStats([
    f({ key: 'r', label: 'Overall', type: 'rating', max: 5 }),
    f({ key: 'n', label: 'Recommend', type: 'nps' }),
    f({ key: 'l', label: 'Easy', type: 'likert', options: ['D', 'N', 'A'] }),
    f({ key: 'g', label: 'Grid', type: 'matrix', options: ['Bad', 'Good'], survey: { rows: [{ label: 'Speed' }] } }),
    f({ key: 's', label: 'Hours', type: 'slider', min: 0, max: 10 }),
    f({ key: 'c', label: 'Mood', type: 'csat' }),
    f({ key: 'k', label: 'Order', type: 'ranking', options: ['A', 'B'] }),
    f({ key: 'p', label: 'Pick', type: 'image_choice', options: ['Tea', 'Coffee'] }),
    f({ key: 'y', label: 'Come', type: 'yes_no_maybe', options: ['Yes', 'No', 'Maybe'] }),
    f({ key: 'm', label: 'Cost', type: 'currency' }),
  ], [
    { r: 5, n: 10, l: 'A', g: { speed: 'Good' }, s: 4, c: 5, k: ['B', 'A'], p: 'Tea', y: 'Yes', m: 10 },
    { r: 3, n: 6, l: 'N', g: { speed: 'Bad' }, s: 6, c: 2, k: ['A', 'B'], p: 'Coffee', y: 'Maybe', m: 30 },
  ])

  it('one chart per question type, each with its text alternative and a table', () => {
    expect(stats.map((s) => s.kind)).toEqual(['rating', 'nps', 'likert', 'matrix', 'slider', 'csat', 'ranking', 'choice', 'choice', 'number'])
    for (const stat of stats) {
      const html = renderToStaticMarkup(createElement(SurveyStatChart, { stat }))
      expect(html, stat.key).toContain(`data-survey-chart="${stat.kind}"`)
      expect(html).toContain('class="sr-only"')
      expect(html).toContain('data-chart-table-toggle')
      expect(html).toContain('role="figure"')
      expect(statTable(stat).rows.length).toBeGreaterThan(0)
    }
    const nps = renderToStaticMarkup(createElement(SurveyStatChart, { stat: stats[1] }))
    expect(nps).toContain('Promoters (9–10)')
    expect(nps).toMatch(/aria-label="Detractors \(0–6\): 1 \(50%\)"/)
    expect(renderToStaticMarkup(createElement(SurveyStatChart, { stat: { ...stats[0], answered: 0 } as SurveyStat }))).toContain('No answers yet')
  })
})

describe('wizard survey question kinds', () => {
  const spec = (input: Partial<WizardSpecInput>) => assignWizardKeys(WizardSpecSchema.parse({ name: 'S', ...input }))

  it('build real controls, a column per grid statement, workflow paths and one report', () => {
    const s = spec({ questions: [
      { id: 'a', kind: 'rating', label: 'Stars', settings: { max: 10, icon: 'heart' } },
      { id: 'b', kind: 'matrix', label: 'Rate us', rows: ['Speed', 'Price'], options: ['Bad', 'Good'] },
      { id: 'c', kind: 'slider', label: 'Hours', settings: { min: 0, max: 8, step: 0.5, unit: 'h' } },
      { id: 'd', kind: 'image_choice', label: 'Drink', options: ['Tea', 'Coffee'], settings: { multiple: true, icons: { Tea: 'leaf' } } },
      { id: 'e', kind: 'csat', label: 'Mood', settings: { faces: 3 }, show_if: { question: 'a', op: 'gt', value: '5' } },
    ] })
    const fields = buildFormFields(s)
    expect(fieldDefinitionProblems(normalizeTaskFields(fields))).toEqual({})
    expect(fields.map((x) => x.type)).toEqual(['rating', 'matrix', 'slider', 'image_choice', 'csat'])
    expect(fields[0]).toMatchObject({ max: 10, survey: { icon: 'heart' } })
    expect(fields[3].survey).toEqual({ multiple: true, images: { Tea: 'icon:leaf' } })
    const key = s.questions[1].key!
    const cols = buildTableColumns(s).map((c) => c.key)
    expect(cols).toEqual(expect.arrayContaining([`${key}_speed`, `${key}_price`]))
    expect(cols).not.toContain(key)
    const wf = buildWorkflow(s, { formId: 'f', formName: 'S', tableId: 't', tableName: 'S responses' })
    const save = wf.nodes.find((n) => n.id === 'save')!.config.column_values as Record<string, string>
    expect(save[`${key}_speed`]).toBe(`{{form.${key}.speed}}`)
    // The engine resolves the per-statement path from the submitted object (and keeps lists / numbers typed).
    const ctx: any = { variables: { form: { [key]: { speed: 'Good' }, [s.questions[3].key!]: ['Tea'], [s.questions[0].key!]: 7 } } }
    expect(resolveExpression(save[`${key}_speed`], ctx)).toBe('Good')
    expect(resolveExpression(save[s.questions[3].key!], ctx)).toEqual(['Tea'])
    expect(resolveExpression(save[s.questions[0].key!], ctx)).toBe(7)
    const reports = buildReports(s, 't')
    expect(reports).toHaveLength(1)
    expect(reports[0].config.columns).toEqual(expect.arrayContaining([`data_${key}_speed`, `data_${s.questions[0].key}`]))
  })

  it('refuses grids without statements and conditions on a ranking', () => {
    expect(() => spec({ questions: [{ id: 'b', kind: 'matrix', label: 'G', options: ['A', 'B'] }] })).toThrow(/statement/)
    expect(() => spec({ questions: [{ id: 'k', kind: 'ranking', label: 'K', options: ['A', 'B'] }, { id: 'x', kind: 'short_text', label: 'X', show_if: { question: 'k', op: 'answered' } }] })).toThrow(/can't depend/)
  })

  it('survey, feedback and quiz templates use the new controls', () => {
    const kinds = (t: 'survey' | 'feedback' | 'quiz') => specFromTemplate(t).spec.questions!.map((q) => q.kind)
    expect(kinds('survey')).toEqual(expect.arrayContaining(['rating', 'matrix', 'ranking', 'nps']))
    expect(kinds('feedback')).toEqual(expect.arrayContaining(['csat', 'likert']))
    expect(kinds('quiz')).toContain('slider')
  })
})
