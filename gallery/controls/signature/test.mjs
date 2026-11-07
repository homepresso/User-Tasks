/** Contract spec for <ut-signature> (run by scripts/browser-test.mjs). */
export const label = 'Customer signature'
export const props = {}
export const sampleValue = [{ id: 'file_sig0', name: 'signature.png', size: 682, type: 'image/png' }]

const SIGNATURE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAABACAYAAABfuzgrAAACdElEQVR42u2ca27EMAgGOUWlqvc/5/YEm9gJ4A+YkfKn2u4GwjjYedgHAL5ipAAAQQAQBABBABAEAEEAEAQAQQAQBABBAABBABAEAEFAi7/fn68bggBy3GwIAtsFhCAIghzNCmclvqu/IwhsjazVJbmKBUHARZCqktzFUTlOBDlYPF0FefoZBEGQ7dG3+tmjuiQ2sUizDs7q73YSxOuzCCLQ+6sUT+WzCIIUHeFPT4p3f6ti8TzZ52pxmpoYHgncWTWKOki7v1HxLIIgh+V4ksS778iSpHvxeB4jBEkc5Vf+N1qQyH1HkAGCPLmw5N2mRBbjhOJRjtGznTY1OZ5K4iGUYvEoShIxT8zuTMoLsirJmwRkrJ4pFU93QSLadlOV42nQb/t+xeLxWqjoPAhcxRouiFcgnpPXqFUvheLxWgWLkMQzX5HftbI400aQ6JGxQvHsXmjMusakOJistu0hgnRKrLIgHgsa3td/OrajLQWZMvH0XqRQm69FdBXeWIcgOh8o79ZJacXvbd4ylsTtRCAVBFGK0Xte0fWaUQThgnD7RJ4kGRNblVtzsuoqXRBl1GPMuONZQX6lnFtkINzCXSvWk48EZ8yj5AWpWDQdB4HV/T/5gJlKvs17xKleOBOeBIxeBIjMe3a+Lcv0ygXTXZCIRYCIvJ/YpxBBprzKZsLrQ1XeAnNqnyzD9A7FMkEQ2r0gQSa8LbDT6zRp94IF2TG924FCjvOCZIIghU73iJKfZ+ti+oTTPXxqCXJVQFNO+YAgwLwDQVR7eza2k6+SRRA2BEEQNgRhDgLAJB0AQQAQBABBABAEAEEAEAQAEAQAQQDe8w/62muIHWAZWAAAAABJRU5ErkJggg=='

export const fixtures = {
  file: { id: 'file_sig0', name: 'signature.png', type: 'image/png', size: 682, __bytes: SIGNATURE_PNG },
  upload: { id: 'file_sig1', name: 'signature.png', size: 1234, type: 'image/png' },
}

async function drawStroke(h, from = [0.15, 0.4], to = [0.7, 0.55]) {
  const box = await h.shadow('canvas.draw').boundingBox()
  const { mouse } = h.page
  await mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await mouse.down()
  for (let i = 1; i <= 12; i++) {
    const t = i / 12
    await mouse.move(box.x + box.width * (from[0] + (to[0] - from[0]) * t), box.y + box.height * (from[1] + (to[1] - from[1]) * t + Math.sin(t * 6) * 0.12))
  }
  await mouse.up()
}

export default async function spec(h) {
  const { page, assert } = h
  // Existing value: the stored image is fetched with request('file') and shown through a blob: URL.
  await h.mount({ value: sampleValue })
  await page.waitForTimeout(200)
  const src = await h.shadow('img').getAttribute('src')
  assert(src && src.startsWith('blob:'), `the saved signature should be a blob: image (got ${src})`)
  assert((await h.requests()).some((r) => r.kind === 'file' && r.payload.id === 'file_sig0'), 'should request the file bytes')
  assert(await h.shadow('text=Signed').isVisible(), 'shows the Signed state')

  // Draw, undo, draw again, use: uploads a PNG and emits [{ id, name, size, type }].
  await h.mount({ value: null })
  const use = h.shadow('button.primary')
  assert(await use.isDisabled(), '"Use this signature" is disabled on an empty pad')
  await drawStroke(h)
  assert(!(await use.isDisabled()), 'drawing enables "Use this signature"')
  await h.shadow('button:has-text("Undo")').click()
  assert(await use.isDisabled(), 'Undo removed the only stroke')
  await drawStroke(h)
  await drawStroke(h, [0.2, 0.7], [0.85, 0.3])
  await h.shot('drawing')
  await use.click()
  await page.waitForTimeout(250)
  const uploads = (await h.requests()).filter((r) => r.kind === 'upload')
  assert(uploads.length === 1 && uploads[0].payload.type === 'image/png' && uploads[0].payload.size > 200, `one PNG upload (${JSON.stringify(uploads)})`)
  const value = await h.lastValue()
  assert(Array.isArray(value) && value.length === 1 && value[0].id === 'file_sig1' && value[0].type === 'image/png', `emits the stored file (${JSON.stringify(value)})`)
  assert(await h.shadow('text=Signed').isVisible(), 'shows Signed after saving')
  // Sign again clears the value.
  await h.shadow('button:has-text("Sign again")').click()
  assert((await h.lastValue()) === null, 'Sign again clears the value')

  // Keyboard: type the name instead and press Enter.
  await h.mount({ value: null })
  await h.shadow('button:has-text("Type your name instead")').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ana Lopez')
  await h.update({ theme: h.DARK })
  await page.evaluate(() => { document.body.style.background = '#262522' })
  await h.shot('typed-dark')
  await page.evaluate(() => { document.body.style.background = '' })
  await h.shadow('#typed').focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  const typed = await h.lastValue()
  assert(Array.isArray(typed) && typed[0]?.id === 'file_sig1', 'typed signature uploads and emits')

  // Upload failure: friendly alert, no value.
  await h.mount({ value: null })
  await page.evaluate(() => { window.__answers.upload = () => Promise.reject(new Error('Storage is full')) })
  await drawStroke(h)
  await h.shadow('button.primary').click()
  await page.waitForTimeout(200)
  const alert = await h.shadow('[role="alert"]').textContent()
  assert(/could not be saved/.test(alert || ''), `shows the upload error (${alert})`)
  assert((await h.events('ut-change')).length === 0, 'no value after a failed upload')

  // Resize keeps the strokes.
  await h.mount({ value: null })
  await drawStroke(h)
  await page.setViewportSize({ width: 500, height: 900 })
  await page.waitForTimeout(150)
  assert(!(await h.shadow('button.primary').isDisabled()), 'strokes survive a resize')
  const inked = await page.evaluate(() => {
    const c = document.querySelector('ut-signature').shadowRoot.querySelector('canvas.draw')
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true
    return false
  })
  assert(inked, 'the canvas still has ink after the resize')
  await page.setViewportSize({ width: 720, height: 900 })

  // Read-only without a value: no pad.
  await h.mount({ value: null, readonly: true })
  assert((await h.shadow('canvas').count()) === 0, 'no drawing pad when read-only')
}
