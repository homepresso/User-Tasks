/** Contract spec for <ut-saved-report> (run by scripts/browser-test.mjs). */
const customers = ['Acme Ltd', 'Bluebird Co', 'Kiwi Foods', 'Harbour Health', 'Summit Legal', 'Tui Tech', 'Orbit Media']
const statuses = ['Open', 'Approved', 'Paid']
const rows = Array.from({ length: 23 }, (_, i) => ({
  invoice: `INV-${1040 + i}`,
  customer: customers[i % customers.length],
  status: statuses[i % statuses.length],
  amount: Math.round(((i * 7919) % 5000) + 250) + 0.5,
  due: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
}))

export const label = 'Outstanding invoices'
export const props = { report_id: 'rep-42', selectable: true }
export const sampleValue = rows[2]
export const settle = 400

export const fixtures = {
  report: {
    report: { id: 'rep-42', name: 'Invoices due this month', description: 'Unpaid invoices from the Finance table', visualization: 'table' },
    columns: [
      { key: 'invoice', label: 'Invoice', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'due', label: 'Due', type: 'date' },
    ],
    rows,
    total: 23,
    truncated: false,
  },
}

export default async function spec(h) {
  const { page, assert } = h
  await h.mount({ value: null })
  const reqs = await h.requests()
  assert(reqs.some((r) => r.kind === 'report' && r.payload.limit === 100), `requests the report with limit 100 (${JSON.stringify(reqs)})`)
  assert((await h.shadow('tbody tr').count()) === 10, 'first page has 10 rows')
  assert((await h.shadow('.pager span').first().textContent()) === 'Rows 1-10 of 23', 'range text')
  assert((await h.shadow('caption').textContent()).includes('Invoices due this month'), 'table caption')
  // Dates and numbers formatted with the locale.
  const firstRow = await h.shadow('tbody tr').first().textContent()
  assert(/1 Nov 2026/.test(firstRow), `dates formatted (got ${firstRow})`)
  // Pagination.
  await h.shadow('button:has-text("Next")').click()
  assert((await h.shadow('.pager span').first().textContent()) === 'Rows 11-20 of 23', 'Next shows rows 11-20')
  assert((await h.shadow('tbody tr').first().textContent()).includes('INV-1050'), 'second page starts at INV-1050')
  await h.shadow('button:has-text("Next")').click()
  assert((await h.shadow('tbody tr').count()) === 3, 'last page has 3 rows')
  assert(await h.shadow('button:has-text("Next")').isDisabled(), 'Next disabled on the last page')
  // Sorting with the keyboard.
  await h.shadow('th:has-text("Amount") button').focus()
  await page.keyboard.press('Enter')
  assert((await h.shadow('th:has-text("Amount")').getAttribute('aria-sort')) === 'ascending', 'aria-sort ascending')
  const asc = Number((await h.shadow('tbody tr').first().locator('td.num').textContent()).replace(/[^\d.]/g, ''))
  await page.keyboard.press('Enter')
  assert((await h.shadow('th:has-text("Amount")').getAttribute('aria-sort')) === 'descending', 'aria-sort descending')
  const desc = Number((await h.shadow('tbody tr').first().locator('td.num').textContent()).replace(/[^\d.]/g, ''))
  assert(desc > asc, `descending first amount (${desc}) > ascending (${asc})`)
  // Selecting a row with the keyboard emits the row object; again unselects.
  await h.mount({ value: null })
  await h.shadow('button.pick').nth(1).focus()
  await page.keyboard.press('Enter')
  const v = await h.lastValue()
  assert(v && v.invoice === 'INV-1041' && v.amount === rows[1].amount, `Enter selects the row (got ${JSON.stringify(v)})`)
  assert((await h.shadow('button.pick').nth(1).getAttribute('aria-pressed')) === 'true', 'pressed state')
  await page.keyboard.press('Space')
  assert((await h.lastValue()) === null, 'Space again unselects')
  // Row click selects too.
  await h.shadow('tbody tr').nth(3).locator('td').nth(2).click()
  assert((await h.lastValue())?.invoice === 'INV-1043', 'clicking a row selects it')
  // Not selectable: no pick column, value stays null.
  await h.mount({ value: null, props: { selectable: false } })
  assert((await h.shadow('button.pick').count()) === 0, 'no select buttons when not selectable')
  await h.shadow('tbody tr').first().click()
  assert((await h.lastValue()) === undefined, 'clicking a row does nothing when not selectable')
  // Read-only: the selection is shown, no select buttons.
  await h.mount({ value: rows[2], readonly: true })
  assert((await h.shadow('button.pick').count()) === 0, 'read-only has no select buttons')
  assert((await h.shadow('tr.sel').count()) === 1, 'read-only shows the selected row')
  // Chart view.
  await h.mount({ props: { view: 'chart' } })
  await page.waitForTimeout(300)
  assert((await h.shadow('canvas').count()) === 1, 'chart view draws a canvas')
  assert(((await h.shadow('.plot').getAttribute('aria-label')) || '').includes('Invoices due this month'), 'chart has a text alternative')
  await h.shot('chart')
  await h.shadow('button:has-text("Table")').click()
  assert((await h.shadow('table').count()) === 1, 'switching back to the table')
  // Refresh + host errors.
  await page.evaluate(() => { window.__answers.report = () => Promise.reject(new Error('The report is not shared with you, or it was deleted.')) })
  await h.shadow('button[aria-label="Refresh report"]').click()
  await page.waitForTimeout(100)
  assert((await h.shadow('[role="alert"]').textContent()).includes('not shared with you'), 'shows the host error')
  // Truncated results.
  await page.evaluate(() => { const r = window.__answers.report; window.__answers.report = undefined; window.__trunc = true })
  await page.evaluate(([fx]) => { window.__answers.report = { ...fx, total: 2345, truncated: true } }, [fixtures.report])
  await h.shadow('button[aria-label="Refresh report"]').click()
  await page.waitForTimeout(100)
  assert((await h.shadow('.note').first().textContent()).includes('Showing first 23 of 2,345'), 'truncation note')
  // Empty report.
  await page.evaluate(([fx]) => { window.__answers.report = { ...fx, rows: [], total: 0 } }, [fixtures.report])
  await h.shadow('button[aria-label="Refresh report"]').click()
  await page.waitForTimeout(100)
  assert((await h.shadow('.state').textContent()).includes('no rows'), 'empty report message')
  // No report chosen.
  await h.mount({ props: { report_id: '' } })
  assert((await h.shadow('.state').textContent()).includes('Choose a report in the form designer'), 'asks the designer to choose a report')
  assert((await h.requests()).length === 0, 'no request without a report')
}
