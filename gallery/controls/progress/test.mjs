/** Contract spec for <ut-progress> (run by scripts/browser-test.mjs). */
export const label = 'Onboarding checklist'
export const props = { current_value: 7, total_value: 12, unit: 'tasks', warn_below: 25, good_above: 80 }
export const sampleValue = null

export default async function spec(h) {
  const { assert } = h
  // Bar from props.
  await h.mount({})
  const bar = h.shadow('[role="progressbar"]')
  assert((await bar.getAttribute('aria-valuenow')) === '7' && (await bar.getAttribute('aria-valuemax')) === '12', 'valuenow / valuemax from props')
  const text = await bar.getAttribute('aria-valuetext')
  assert(text === '7 of 12 tasks, 58.3%', `valuetext (got "${text}")`)
  // Context wins over props; thresholds.
  await h.mount({ context: { fields: { current: '2', total: 10 }, field_key: 'p' } })
  assert((await h.shadow('[role="progressbar"]').getAttribute('aria-valuetext')).includes('Needs attention'), 'below warn_below says Needs attention')
  await h.mount({ context: { fields: { current: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], total: 10 }, field_key: 'p' }, props: { appearance: 'ring', label_template: '{{remaining}} left' } })
  const ring = h.shadow('svg[role="progressbar"]')
  assert((await ring.getAttribute('aria-valuetext')) === '1 left, 90%, On track', `ring valuetext (got "${await ring.getAttribute('aria-valuetext')}")`)
  await h.shot('ring')
  // Steps: current by name.
  await h.mount({ props: { appearance: 'steps', steps: ['Submitted', 'Review', 'Approval', 'Payment', 'Done'] }, context: { fields: { current: 'review' }, field_key: 'p' } })
  assert((await h.shadow('.steps-head strong').textContent()) === 'Step 2 of 5: Review', 'steps heading')
  assert((await h.shadow('li[aria-current="step"] .name').textContent()).startsWith('Review'), 'aria-current on the current step')
  assert((await h.shadow('li.done').count()) === 1, 'one step done')
  await h.shot('steps')
  // Steps: current by number.
  await h.mount({ props: { appearance: 'steps', steps: ['A', 'B', 'C'], current_value: 3 } })
  assert((await h.shadow('.steps-head strong').textContent()) === 'Step 3 of 3: C', 'current step by number')
  // Never emits.
  assert((await h.events('ut-change')).length === 0, 'never emits ut-change')
}
