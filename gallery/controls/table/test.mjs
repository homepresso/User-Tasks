/** Contract spec for <ut-table> (run by scripts/browser-test.mjs). */
export const label = 'Line items'
const columns = [
  { key: 'item', label: 'Item', type: 'text', required: true, width: 200 },
  { key: 'quantity', label: 'Quantity', type: 'number', min: 1, width: 100 },
  { key: 'unit_price', label: 'Unit price', type: 'currency', min: 0, width: 120 },
  { key: 'needed_by', label: 'Needed by', type: 'date', width: 150 },
  { key: 'category', label: 'Category', type: 'select', options: ['Hardware', 'Software', 'Services'], width: 140 },
  { key: 'urgent', label: 'Urgent', type: 'checkbox', width: 80 },
]
export const props = { columns, show_totals: true, currency: 'USD', min_rows: 0, max_rows: 50 }
export const sampleValue = [
  { item: 'Laptop', quantity: 2, unit_price: 1499, needed_by: '2026-11-20', category: 'Hardware', urgent: true },
  { item: 'Docking station', quantity: 2, unit_price: 189.5, needed_by: null, category: 'Hardware', urgent: false },
  { item: 'Setup', quantity: 0, unit_price: 120, needed_by: '2026-11-25', category: 'Services', urgent: false },
]

export default async function spec(h) {
  const { page, assert } = h
  const tag = h.manifest.tag
  const focused = () => page.evaluate((t) => { const a = document.querySelector(t).shadowRoot.activeElement; return a ? { r: a.dataset.r ?? a.closest('[data-r]')?.dataset.r, c: a.dataset.c, tag: a.localName, label: a.getAttribute('aria-label') } : null }, tag)

  // Per-cell validation in the sample: row 3 quantity 0 < min 1.
  await h.mount({ value: sampleValue })
  let validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === false && validity.detail.message === 'Row 3: Quantity must be at least 1', `validity: ${JSON.stringify(validity?.detail)}`)
  const bad = h.shadow('td[data-r="2"][data-c="1"]')
  assert((await bad.getAttribute('aria-invalid')) === 'true', 'the bad cell is aria-invalid')
  const errId = await bad.getAttribute('aria-describedby')
  assert(errId && (await h.shadow(`#${errId}`).textContent()).includes('at least 1'), 'the bad cell is described by its error')
  // Totals: quantity 4, unit price 1,808.50.
  const foot = await h.shadow('tfoot').textContent()
  assert(foot.includes('$1,808.50') && foot.includes('4'), `totals row: ${foot}`)

  // Keyboard: Tab into the grid lands on the first cell; arrows move; typing edits; Enter commits and moves down.
  await h.mount({ value: null })
  assert((await h.shadow('tbody td.empty').count()) === 1, 'an empty table shows the empty state')
  await h.shadow('button.add').click()
  let v = await h.lastValue()
  assert(Array.isArray(v) && v.length === 1 && v[0].item === null && v[0].urgent === false, `Add row emits a blank row: ${JSON.stringify(v)}`)
  let f = await focused()
  assert(f && f.r === '0' && f.c === '0', `after Add row the first cell has focus: ${JSON.stringify(f)}`)
  await page.keyboard.type('Monitor')
  await h.shot('editing')
  await page.keyboard.press('Enter')
  v = await h.lastValue()
  assert(v[0].item === 'Monitor', `typing then Enter stores the text: ${JSON.stringify(v)}`)
  await page.keyboard.press('ArrowRight')
  f = await focused()
  assert(f && f.r === '0' && f.c === '1', `ArrowRight moves to Quantity: ${JSON.stringify(f)}`)
  await page.keyboard.press('Enter')
  await page.keyboard.type('3')
  await page.keyboard.press('Tab')
  v = await h.lastValue()
  assert(v[0].quantity === 3, `quantity stored as a number: ${JSON.stringify(v[0])}`)
  f = await focused()
  assert(f && f.c === '2', `Tab after editing moves to the next cell: ${JSON.stringify(f)}`)
  await page.keyboard.type('1,250.5')
  await page.keyboard.press('Enter')
  v = await h.lastValue()
  assert(v[0].unit_price === 1250.5, `currency parsed: ${JSON.stringify(v[0])}`)
  // Escape cancels an edit.
  await page.keyboard.press('Home')
  await page.keyboard.type('Oops')
  await page.keyboard.press('Escape')
  v = await h.lastValue()
  assert(v[0].item === 'Monitor', 'Escape cancels the edit')
  f = await focused()
  assert(f && f.r === '0' && f.c === '0', `Escape returns focus to the cell: ${JSON.stringify(f)}`)
  // Date and select editors.
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await h.shadow('input[type="date"].editor').fill('2026-12-01')
  await page.keyboard.press('Enter')
  v = await h.lastValue()
  assert(v[0].needed_by === '2026-12-01', `date stored as YYYY-MM-DD: ${JSON.stringify(v[0])}`)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await h.shadow('select.editor').selectOption('Software')
  await page.keyboard.press('Enter')
  v = await h.lastValue()
  assert(v[0].category === 'Software', `select stores the option: ${JSON.stringify(v[0])}`)
  // Checkbox: Space toggles.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  v = await h.lastValue()
  assert(v[0].urgent === true, `Space ticks the box: ${JSON.stringify(v[0])}`)
  // Delete clears a cell; invalid number text stays and is reported.
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type('lots')
  await page.keyboard.press('Enter')
  validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.message === 'Row 1: Quantity must be a number', `non-number reported: ${JSON.stringify(validity?.detail)}`)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Delete')
  v = await h.lastValue()
  assert(v[0].quantity === null, 'Delete clears the cell')
  // Ctrl+Enter adds a row; the delete button is labelled and removes it.
  await page.keyboard.press('Control+Enter')
  v = await h.lastValue()
  assert(v.length === 2, 'Ctrl+Enter adds a row')
  validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.message === 'Row 2: Item is required', `blank required cell reported: ${JSON.stringify(validity?.detail)}`)
  await page.keyboard.press('End')
  f = await focused()
  assert(f && f.label === 'Delete row 2', `End reaches the Delete row 2 button: ${JSON.stringify(f)}`)
  await page.keyboard.press('Enter')
  v = await h.lastValue()
  assert(v.length === 1, 'Delete row removes the row')
  // Tab leaves the grid at the end.
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Tab')
  const out = await page.evaluate((t) => document.querySelector(t).shadowRoot.activeElement?.className, tag)
  assert(out === 'add', `Tab from the last cell leaves the grid (focus on ${out})`)

  // Default rows are shown but not emitted until edited.
  await h.mount({ value: null, props: { default_rows: [{ item: 'Desk', quantity: 1, unit_price: 300 }] } })
  assert((await h.events('ut-change')).length === 0, 'default rows are not emitted on mount')
  assert((await h.shadow('tbody td[data-r="0"][data-c="0"]').textContent()).includes('Desk'), 'default rows are shown')
  // max_rows.
  await h.mount({ value: [{ item: 'A' }], props: { max_rows: 1 } })
  assert((await h.shadow('button.add').getAttribute('aria-disabled')) === 'true', 'Add row is disabled at max_rows')
  // Read-only: a plain table, no grid or inputs.
  await h.mount({ value: sampleValue, readonly: true })
  assert((await h.shadow('[role="grid"]').count()) === 0 && (await h.shadow('input, button, select').count()) === 0, 'read-only has no editors')
}
