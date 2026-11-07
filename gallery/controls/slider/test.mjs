/** Contract spec for <ut-slider> (run by scripts/browser-test.mjs). */
export const label = 'How confident are you?'
export const props = { min: 0, max: 100, step: 1, value_suffix: '%', marks: ['Low', 'Medium', 'High'], default_value: 50, show_input: true }
export const sampleValue = 70

export default async function spec(h) {
  const { page, assert } = h
  // Not set yet: the slider shows the starting position but emits nothing until moved.
  await h.mount({ value: null })
  const range = h.shadow('input[type="range"]')
  assert((await range.inputValue()) === '50', 'an empty slider should sit at the starting position')
  const unsetText = await range.getAttribute('aria-valuetext')
  assert(/^Not set/.test(unsetText), `an empty slider should say "Not set" (got "${unsetText}")`)
  assert((await h.events('ut-change')).length === 0, 'mounting must not emit')
  await h.shot('unset')
  // Keyboard: Tab in, Enter accepts the start, arrows move, Home / End jump.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  assert((await h.lastValue()) === 50, 'Enter on an empty slider accepts the starting position')
  await page.keyboard.press('ArrowRight')
  assert((await h.lastValue()) === 51, `ArrowRight should give 51 (got ${await h.lastValue()})`)
  await page.keyboard.press('End')
  assert((await h.lastValue()) === 100, 'End should give 100')
  assert((await range.getAttribute('aria-valuetext')) === '100%, High', `valuetext at max is "${await range.getAttribute('aria-valuetext')}"`)
  await page.keyboard.press('Home')
  assert((await h.lastValue()) === 0, 'Home should give 0')
  // The number box: exact entry.
  await h.shadow('input.number').fill('42')
  assert((await h.lastValue()) === 42, 'typing 42 in the number box should emit 42')
  await h.shadow('input.number').fill('')
  assert((await h.lastValue()) === null, 'clearing the number box empties the field')
  // Prefix in valuetext.
  await h.mount({ value: 2500, props: { min: 0, max: 5000, step: 100, value_prefix: '$', value_suffix: '', marks: [] } })
  const money = await h.shadow('input[type="range"]').getAttribute('aria-valuetext')
  assert(money === '$2,500', `valuetext with a prefix is "${money}"`)
  // Validity: out of range and off-step values.
  await h.mount({ value: 150, props: { value_suffix: '' } })
  let validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === false && validity.detail.message === 'Choose a value from 0 to 100', `150 should be invalid (got ${JSON.stringify(validity?.detail)})`)
  await h.mount({ value: 7, props: { step: 5, value_suffix: '' } })
  validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === false, '7 with step 5 should be invalid')
  await h.mount({ value: 35, props: { step: 5 } })
  validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === true, '35 with step 5 should be valid')
}
