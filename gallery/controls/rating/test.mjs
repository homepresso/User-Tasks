/** Contract spec for <ut-rating> (run by scripts/browser-test.mjs). */
export const label = 'How was your visit?'
export const props = { max: 5, labels: ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] }
export const sampleValue = 4

export default async function spec(h) {
  const { page, assert } = h
  await h.mount({ value: null })
  // Keyboard: Tab in, arrows set the value, End / Home jump, Delete clears.
  await page.keyboard.press('Tab')
  await page.keyboard.press('ArrowRight')
  assert((await h.lastValue()) === 1, 'ArrowRight from empty should rate 1')
  await page.keyboard.press('End')
  assert((await h.lastValue()) === 5, 'End should rate 5')
  await page.keyboard.press('ArrowLeft')
  assert((await h.lastValue()) === 4, 'ArrowLeft should rate 4')
  await page.keyboard.press('Delete')
  assert((await h.lastValue()) === null, 'Delete should clear')
  // Pointer: click the third star.
  await h.shadow('[data-n="3"]').click()
  assert((await h.lastValue()) === 3, 'clicking the third star should rate 3')
  // Radio semantics and names.
  await h.mount({ value: 2 })
  const checked = await h.shadow('[role="radio"][aria-checked="true"]').getAttribute('aria-label')
  assert(checked === '2 of 5: Fair', `checked radio is named "${checked}"`)
  // Validity: an out-of-range value is reported.
  await h.mount({ value: 9 })
  const validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === false, 'a value of 9 should report invalid')
}
