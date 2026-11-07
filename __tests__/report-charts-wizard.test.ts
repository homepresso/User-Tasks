/**
 * The form wizard's ONE responses report carries summary charts
 * (buildResponseCharts): the base four, status with approval, score for a
 * quiz, then the most chart-worthy questions — never more than 8, all valid
 * against the report's own columns.
 */
import { describe, expect, it } from 'vitest'
import { WizardSpecSchema, type WizardSpec, type WizardSpecInput } from '@/lib/forms/wizard/spec'
import { assignWizardKeys, buildReports, buildResponseCharts, buildTableColumns, STATUS } from '@/lib/forms/wizard/build'
import { customTableToSource } from '@/lib/report-sources'
import { MAX_REPORT_CHARTS, validateReportChart } from '@/lib/report-charts'
import { normalizeReportConfig } from '@/lib/report-config'

const U1 = '11111111-1111-4111-8111-111111111111'
const approval: WizardSpecInput['approval'] = { mode: 'single', stages: [{ id: 's1', name: 'Manager', assignee: { kind: 'person', user_id: U1 } }] }

function spec(input: Partial<WizardSpecInput> = {}): WizardSpec {
  return assignWizardKeys(WizardSpecSchema.parse({
    name: 'Feedback',
    questions: [
      { id: 'q1', kind: 'short_text', label: 'Name' },
      { id: 'q2', kind: 'choice', label: 'Team', options: ['Sales', 'Support', 'Ops'] },
    ],
    ...input,
  }))
}

/** The report's columns as the data table source lists them. */
function sourceColumnKeys(s: WizardSpec): string[] {
  return customTableToSource({ id: 't', name: 'x', columns: buildTableColumns(s) }).columns.map((c) => c.key)
}

describe('wizard responses report: summary charts', () => {
  it('a plain form: total, over time (90 days), weekday, hour, then its choice question', () => {
    const s = spec()
    const charts = buildResponseCharts(s)
    expect(charts.map((c) => c.id)).toEqual(['total', 'over_time', 'by_weekday', 'by_hour', `q2_${s.questions[1].key}`])
    expect(charts[0]).toMatchObject({ type: 'number', title: 'Total responses', measure: { fn: 'count' } })
    expect(charts[1]).toMatchObject({ type: 'area', dimension: { field: 'created_at', bucket: 'day' }, range_days: 90 })
    expect(charts[2]).toMatchObject({ type: 'column', dimension: { field: 'created_at', bucket: 'day_of_week' } })
    expect(charts[3]).toMatchObject({ type: 'column', dimension: { field: 'created_at', bucket: 'hour_of_day' } })
    expect(charts[4]).toMatchObject({ type: 'donut', dimension: { field: `data_${s.questions[1].key}` }, categories: ['Sales', 'Support', 'Ops'] })
    expect(charts.some((c) => c.id === 'by_status' || c.id === 'avg_score')).toBe(false)
  })

  it('with approval: a status donut in the review order', () => {
    const s = spec({ approval })
    const status = buildResponseCharts(s).find((c) => c.id === 'by_status')!
    expect(status).toMatchObject({ type: 'donut', dimension: { field: 'data_status' } })
    // The same options (and order) as the table's status column.
    expect(status.categories).toEqual(buildTableColumns(s).find((c) => c.key === 'status')!.options)
    expect(status.categories!.slice(0, 3)).toEqual([STATUS.pending, STATUS.approved, STATUS.declined])
  })

  it('a quiz: average score card and the score spread', () => {
    const s = spec({ questions: [{ id: 'q1', kind: 'choice', label: '2 + 2', options: ['3', '4'], score: { correct: ['4'], points: 1 } }] })
    const charts = buildResponseCharts(s)
    expect(charts.find((c) => c.id === 'avg_score')).toMatchObject({ type: 'number', measure: { fn: 'avg', field: 'data_score' } })
    expect(charts.find((c) => c.id === 'score_spread')).toMatchObject({ type: 'column', dimension: { field: 'data_score' }, sort: 'label' })
  })

  it('a survey: NPS as a card, scales as columns in scale order, best questions first, max 3, never over 8', () => {
    const s = spec({
      approval,
      questions: [
        { id: 'a', kind: 'long_text', label: 'Comments' },
        { id: 'b', kind: 'yes_no', label: 'Return?' },
        { id: 'c', kind: 'rating', label: 'Overall', settings: { max: 5 } },
        { id: 'd', kind: 'likert', label: 'Easy to use', options: ['Disagree', 'Neutral', 'Agree'] },
        { id: 'e', kind: 'nps', label: 'Recommend us' },
        { id: 'f', kind: 'choices', label: 'Liked', options: ['A', 'B'] },
        { id: 'g', kind: 'matrix', label: 'Grid', options: ['Bad', 'Good'], rows: ['Speed'] },
      ],
    })
    const charts = buildResponseCharts(s)
    expect(charts.length).toBeLessThanOrEqual(MAX_REPORT_CHARTS)
    const questionCharts = charts.filter((c) => c.id.startsWith('q'))
    expect(questionCharts).toHaveLength(3)
    const [nps, rating, likert] = questionCharts
    expect(nps).toMatchObject({ type: 'number', measure: { fn: 'nps' }, title: 'Recommend us: NPS' })
    expect(rating).toMatchObject({ type: 'column', categories: ['1', '2', '3', '4', '5'] })
    expect(likert).toMatchObject({ type: 'column', categories: ['Disagree', 'Neutral', 'Agree'] })
  })

  it('approval + quiz + many questions: 8 charts at most (one question chart left)', () => {
    const s = spec({
      approval,
      questions: [
        { id: 'q1', kind: 'choice', label: 'Pick', options: ['A', 'B'], score: { correct: ['A'], points: 1 } },
        { id: 'q2', kind: 'nps', label: 'Recommend' },
        { id: 'q3', kind: 'rating', label: 'Rate' },
      ],
    })
    const charts = buildResponseCharts(s)
    expect(charts).toHaveLength(MAX_REPORT_CHARTS)
    expect(charts.filter((c) => c.id.startsWith('q')).map((c) => c.measure.fn)).toEqual(['nps'])
  })

  it('every chart is valid against the report columns and survives the config normaliser', () => {
    for (const s of [spec(), spec({ approval }), spec({ questions: [{ id: 'q', kind: 'csat', label: 'Happy?' }, { id: 'y', kind: 'yes_no_maybe', label: 'Again?' }, { id: 's', kind: 'slider', label: 'How much' }] })]) {
      const [report] = buildReports(s, 't')
      const keys = sourceColumnKeys(s)
      for (const c of report.config.charts!) expect(validateReportChart(c, keys), c.id).toEqual([])
      expect(normalizeReportConfig(report.config).charts).toEqual(report.config.charts)
    }
  })

  it('stays ONE report per form', () => {
    expect(buildReports(spec({ approval }), 't').map((r) => r.key)).toEqual(['responses'])
  })
})
