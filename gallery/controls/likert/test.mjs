/** Contract spec for <ut-likert> (run by scripts/browser-test.mjs). */
export const label = 'How did we do?'
export const props = {
  statements: ['The request was handled quickly', 'The staff were helpful & courteous', 'I would recommend us to a colleague', 'The request was handled quickly'],
  show_na: true,
}
export const sampleValue = { the_request_was_handled_quickly: 4, the_staff_were_helpful_courteous: 5, i_would_recommend_us_to_a_colleague: 0 }

export default async function spec(h) {
  const { page, assert } = h
  await h.mount({ value: null })
  // Tab into the first statement, arrows choose within the row.
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowRight')
  let v = await h.lastValue()
  assert(JSON.stringify(v) === '{"the_request_was_handled_quickly":2}', `ArrowRight chooses 2 (got ${JSON.stringify(v)})`)
  await page.keyboard.press('End')
  v = await h.lastValue()
  assert(v.the_request_was_handled_quickly === 0, 'End chooses N/A (0)')
  await page.keyboard.press('Home')
  assert((await h.lastValue()).the_request_was_handled_quickly === 1, 'Home chooses 1')
  // Tab goes to the next statement (one stop per statement).
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.activeElement.shadowRoot.activeElement?.dataset.r)
  assert(focused === '1', `Tab moves to the second statement (focus on row ${focused})`)
  await page.keyboard.press('Space')
  v = await h.lastValue()
  assert(v.the_staff_were_helpful_courteous === 1 && v.the_request_was_handled_quickly === 1, `Space chooses the focused point (got ${JSON.stringify(v)})`)
  // Duplicate statements get _2.
  await h.shadow('[data-r="3"][data-i="4"]').click()
  v = await h.lastValue()
  assert(v.the_request_was_handled_quickly_2 === 5, `duplicate statement key gets _2 (got ${JSON.stringify(v)})`)
  // Delete clears one statement.
  await h.shadow('[data-r="3"][data-i="4"]').focus()
  await page.keyboard.press('Delete')
  v = await h.lastValue()
  assert(v.the_request_was_handled_quickly_2 === undefined, 'Delete clears the answer')
  // Radio semantics.
  await h.mount({ value: sampleValue })
  const checked = await h.shadow('[role="radiogroup"]').nth(0).locator('[aria-checked="true"]').getAttribute('aria-label')
  assert(checked === 'Agree', `checked option named "${checked}"`)
  const groupName = await h.shadow('[role="radiogroup"]').nth(1).getAttribute('aria-labelledby')
  assert(groupName && (await h.shadow(`#${groupName}`).textContent()).includes('helpful'), 'radiogroup is labelled by the statement')
  // all_required: validity lists what is left.
  await h.mount({ value: sampleValue, props: { all_required: true } })
  let validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === false && /1 left/.test(validity.detail.message), `all_required reports 1 left (got ${JSON.stringify(validity?.detail)})`)
  await h.shadow('[data-r="3"][data-i="2"]').click()
  validity = (await h.events('ut-validity')).pop()
  assert(validity.detail.valid === true, 'valid once every statement is answered')
  // Custom scale.
  await h.mount({ value: null, props: { scale: 'custom', scale_labels: ['Bad', 'OK', 'Great'], show_na: false } })
  assert((await h.shadow('[role="radiogroup"]').first().locator('[role="radio"]').count()) === 3, 'custom scale has 3 points')
  // Read-only: arrows move focus but never choose.
  await h.mount({ value: sampleValue, readonly: true })
  await h.shadow('[data-r="0"][data-i="3"]').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  assert((await h.lastValue()) === undefined, 'read-only never emits')
  // Narrow layout: cards with visible labels.
  await page.setViewportSize({ width: 360, height: 800 })
  await h.mount({ value: sampleValue })
  await page.waitForTimeout(200)
  assert(await h.shadow('.matrix.narrow').count() === 1, 'narrow layout under 520px')
  assert(await h.shadow('.text').first().isVisible(), 'option labels visible in the narrow layout')
  await page.setViewportSize({ width: 720, height: 900 })
}
