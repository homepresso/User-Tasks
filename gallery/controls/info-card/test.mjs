/** Contract spec for <ut-info-card> (run by scripts/browser-test.mjs). */
export const label = 'Approval check'
export const props = {
  variant: 'warning',
  card_title: 'Over budget',
  body: 'This request exceeds the cost centre budget.\nCheck with the budget holder before approving.',
}
const filled = {
  card_title: 'Over budget for {{field1}}',
  body: 'This request is {{field2}} and was raised on {{field3}}.\nCheck with the budget holder <b>before</b> approving.',
}
export const sampleValue = null
const ctx = { fields: { field1: 'Marketing', field2: 12500.5, field3: '2026-10-28' }, field_key: 'card' }

export default async function spec(h) {
  const { assert } = h
  await h.mount({ context: ctx, props: filled })
  const card = h.shadow('.card')
  assert((await card.getAttribute('role')) === 'status', 'warning cards are a status region')
  const title = await h.shadow('.title').textContent()
  assert(title === 'Warning: Over budget for Marketing', `sr prefix + filled title (got "${title}")`)
  const body = await h.shadow('.body').textContent()
  assert(body.includes('12,500.5') && body.includes('28 Oct 2026'), `numbers and dates formatted (got "${body}")`)
  assert(body.includes('<b>before</b>') && (await h.shadow('.body b').count()) === 0, 'HTML stays text')
  assert(body.includes('\n'), 'line breaks kept')
  assert((await h.shadow('.icon').getAttribute('aria-hidden')) === 'true', 'icon is decorative')
  // Plain format.
  await h.mount({ context: ctx, props: { ...filled, format: 'plain' } })
  assert((await h.shadow('.body').textContent()).includes('2026-10-28'), 'plain format keeps the stored text')
  // Key / value layout.
  await h.mount({ context: ctx, props: { variant: 'info', layout: 'key-value', labels: ['Cost centre', 'Amount', 'Raised'], card_title: 'Request', body: '' } })
  assert((await h.shadow('.card').getAttribute('role')) === 'note', 'info cards are a note')
  const dts = await h.shadow('dt').allTextContents()
  const dds = await h.shadow('dd').allTextContents()
  assert(dts.join('|') === 'Cost centre|Amount|Raised', `labels (got ${dts.join('|')})`)
  assert(dds[1] === '12,500.5', `formatted value (got ${dds[1]})`)
  await h.shot('key-value')
  for (const variant of ['success', 'error', 'neutral']) {
    await h.mount({ context: ctx, props: { ...filled, variant } })
    await h.shot(variant)
  }
  assert((await h.events('ut-change')).length === 0, 'never emits ut-change')
}
