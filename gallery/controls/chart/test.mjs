/** Contract spec for <ut-chart> (run by scripts/browser-test.mjs). */
export const label = 'Monthly sales'
export const props = {
  chart_title: 'Sales vs costs',
  selectable: true,
  data: { labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'], datasets: [{ label: 'Sales', data: [12, 15, 18, 22, 19] }, { label: 'Costs', data: [8, 9, 11, 10, 13] }] },
}
export const sampleValue = { label: 'Mar', value: 18, series: 'Sales' }
export const settle = 600

export const fixtures = {
  lookup: {
    items: [
      { value: '42', label: 'Auckland', fields: { region: 'Auckland', open_cases: 42 } },
      { value: '17', label: 'Wellington', fields: { region: 'Wellington', open_cases: 17 } },
      { value: '23', label: 'Christchurch', fields: { region: 'Christchurch', open_cases: 23 } },
    ],
  },
  report: {
    report: { id: 'rep-1', name: 'Tickets by priority', description: null, visualization: 'bar' },
    columns: [{ key: 'priority', label: 'Priority', type: 'text' }, { key: 'count', label: 'Tickets', type: 'number' }],
    rows: [{ priority: 'High', count: 14 }, { priority: 'Medium', count: 31 }, { priority: 'Low', count: 9 }],
    total: 3,
    truncated: false,
  },
}

const live = (h) => h.shadow('[aria-live]').textContent()

export default async function spec(h) {
  const { page, assert } = h
  // Keyboard: focus the plot, walk the points, Up changes series, Enter selects.
  await h.mount({ value: null })
  await h.shadow('.plot').focus()
  await page.keyboard.press('ArrowRight')
  assert((await live(h)).startsWith('Jan: 12 (Sales)'), `announces the first point (got "${await live(h)}")`)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  assert((await live(h)).startsWith('Mar: 18 (Sales)'), `announces Mar (got "${await live(h)}")`)
  await page.keyboard.press('Enter')
  let v = await h.lastValue()
  assert(v && v.label === 'Mar' && v.value === 18 && v.series === 'Sales', `Enter selects Mar/Sales (got ${JSON.stringify(v)})`)
  await page.keyboard.press('ArrowUp')
  assert((await live(h)).startsWith('Mar: 11 (Costs)'), `Up moves to the Costs series (got "${await live(h)}")`)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  v = await h.lastValue()
  assert(v && v.label === 'May' && v.value === 13 && v.series === 'Costs', `End + Enter selects May/Costs (got ${JSON.stringify(v)})`)
  // Clear button.
  await h.shadow('button.link').click()
  assert((await h.lastValue()) === null, 'Clear resets the value')
  // Data table toggle.
  const toggle = h.shadow('button.toggle')
  await toggle.click()
  assert((await toggle.getAttribute('aria-expanded')) === 'true', 'toggle is expanded')
  assert((await h.shadow('tbody tr').count()) === 5, 'data table has five rows')
  assert((await h.shadow('thead th').count()) === 3, 'data table has label + two series columns')
  // Not selectable: Enter does nothing.
  await h.mount({ value: null, props: { selectable: false } })
  await h.shadow('.plot').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  assert((await h.lastValue()) === undefined, 'Enter does not select when points are not selectable')
  // Read-only: Enter does nothing, value still shown.
  await h.mount({ value: sampleValue, readonly: true })
  await h.shadow('.plot').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  assert((await h.lastValue()) === undefined, 'read-only never selects')
  assert((await h.shadow('.chip').textContent()).includes('Mar: 18 (Sales)'), 'read-only shows the selected point')
  // Lookup source.
  await h.mount({ props: { source: 'lookup', chart_type: 'horizontal-bar', label_field: 'region', value_field: 'open_cases', chart_title: '' } })
  await page.waitForTimeout(400)
  const reqs = await h.requests()
  assert(reqs.some((r) => r.kind === 'lookup' && r.payload.query === ''), 'requests the lookup with an empty query')
  await h.shadow('button.toggle').click()
  const lookupCells = await h.shadow('tbody th').allTextContents()
  assert(lookupCells.join() === 'Auckland,Wellington,Christchurch', `lookup labels (got ${lookupCells.join()})`)
  assert((await h.shadow('tbody td').first().textContent()) === '42', 'lookup values from fields')
  await h.shot('lookup')
  // Report source: first text / first numeric column by default, report name as title.
  await h.mount({ props: { source: 'report', chart_type: 'doughnut', chart_title: '' } })
  await page.waitForTimeout(600)
  assert((await h.requests()).some((r) => r.kind === 'report'), 'requests the report')
  assert((await h.shadow('.title').textContent()) === 'Tickets by priority', 'report name is the title')
  await h.shadow('.plot').focus()
  await page.keyboard.press('ArrowRight')
  assert((await live(h)).startsWith('High: 14'), `report point (got "${await live(h)}")`)
  await h.shot('report')
  // Context source with grouping.
  await h.mount({
    props: { source: 'context', chart_type: 'pie', label_field: 'team', value_field: 'hours', aggregate: 'sum', chart_title: 'Hours by team' },
    context: { fields: { data: [{ team: 'Ops', hours: 3 }, { team: 'Dev', hours: 5 }, { team: 'Ops', hours: 4 }] }, field_key: 'chart' },
  })
  await h.shadow('button.toggle').click()
  const rows = await h.shadow('tbody tr').allTextContents()
  assert(rows.length === 2 && rows[0].includes('Ops') && rows[0].includes('7'), `sum groups by label (got ${rows.join(' | ')})`)
  // Request errors are shown, never thrown.
  await h.mount({ props: { source: 'lookup', chart_title: '' } })
  await page.evaluate(() => { window.__answers.lookup = () => Promise.reject(new Error('The lookup source is not configured')) })
  await h.update({ props: { lookup_query: 'x' }, lookup_query: 'x' })
  await page.waitForTimeout(200)
  assert((await h.shadow('[role="alert"]').textContent()).includes('not configured'), 'shows the request error')
  // Empty data.
  await h.mount({ props: { data: [] } })
  assert((await h.shadow('.state').textContent()).includes('No data'), 'empty state')
  // Invalid value is reported.
  await h.mount({ value: { foo: 1 } })
  const validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === false, 'an invalid value is reported')
}
