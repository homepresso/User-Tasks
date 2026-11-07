/** Contract spec for <ut-rich-text> (run by scripts/browser-test.mjs). */
export const label = 'Describe the problem'
export const props = { placeholder: 'What happened, and what did you expect?', max_length: 5000, toolbar: 'full', min_height: 140 }
export const sampleValue = {
  html: '<h2>Leak under the sink</h2><p>Water pools after <strong>every</strong> wash. Started <em>last Tuesday</em>.</p><ul><li>Checked the trap</li><li>Seal looks <u>cracked</u></li></ul><p>Photos: <a href="https://example.com/photos" rel="noopener noreferrer" target="_blank">shared album</a></p>',
  text: 'Leak under the sink\nWater pools after every wash. Started last Tuesday.\n• Checked the trap\n• Seal looks cracked\nPhotos: shared album',
}

const EVIL = '<img src=x onerror="alert(1)"><script>alert(2)</script><p style="color:red" onclick="alert(3)">Hello <b>bold</b> <i>it</i></p>'
  + '<a href="javascript:alert(4)">bad link</a> <a href="https://ok.example/x" onclick="alert(5)" style="x">good link</a>'
  + '<iframe src="https://evil.example"></iframe><div class="c">from a div</div><svg><text>svg text</text></svg><h1>Big</h1>'

function clean(html, assert, where) {
  for (const bad of ['<script', 'onerror', 'onclick', 'javascript:', 'style=', 'class=', '<img', '<iframe', '<svg', '<div', '<h1', '<b>', '<i>', 'alert(']) {
    assert(!html.includes(bad), `${where} still contains "${bad}": ${html}`)
  }
}

export default async function spec(h) {
  const { page, assert } = h
  // Typing emits { html, text }.
  await h.mount({ value: null })
  const editor = h.shadow('[role="textbox"]')
  assert((await editor.getAttribute('aria-multiline')) === 'true', 'the editor is a multi-line textbox')
  assert((await editor.getAttribute('aria-label')) === label, 'the editor is named by the host label')
  await editor.click()
  await page.keyboard.type('Hello')
  let v = await h.lastValue()
  assert(v && v.html === '<p>Hello</p>' && v.text === 'Hello', `typing should emit <p>Hello</p> (got ${JSON.stringify(v)})`)
  // Ctrl/Cmd+B makes bold; the Bold button reflects it.
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type(' world')
  v = await h.lastValue()
  assert(v && /<strong>(&nbsp;| )world<\/strong>/.test(v.html), `Ctrl+B then typing should give <strong> (got ${v && v.html})`)
  await page.waitForTimeout(50)
  assert((await h.shadow('button[aria-label="Bold"]').getAttribute('aria-pressed')) === 'true', 'Bold should be pressed inside bold text')
  await page.keyboard.press('ControlOrMeta+b')
  // Undo via the shortcut changes the value back.
  await page.keyboard.press('ControlOrMeta+z')
  v = await h.lastValue()
  assert(v && !v.html.includes(' world'), `Ctrl+Z should undo the typing (got ${v && v.html})`)
  // Bulleted list via the toolbar.
  await h.shadow('button[aria-label="Bulleted list"]').click()
  v = await h.lastValue()
  assert(v && /^<ul><li>/.test(v.html) && v.text.startsWith('• '), `Bulleted list should wrap the line (got ${JSON.stringify(v)})`)
  // Link: select a word, Ctrl+K, type the address, Enter.
  await h.mount({ value: { html: '<p>See the docs</p>', text: 'See the docs' } })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('ControlOrMeta+k')
  const linkInput = h.shadow('.linkbar input')
  assert(await linkInput.isVisible(), 'Ctrl+K should open the link box')
  await page.keyboard.type('javascript:alert(1)')
  await page.keyboard.press('Enter')
  assert(await h.shadow('.linkerr').isVisible(), 'a javascript: link must be refused')
  await linkInput.fill('example.com/docs')
  await page.keyboard.press('Enter')
  v = await h.lastValue()
  assert(v && v.html === '<p>See the <a href="https://example.com/docs" rel="noopener noreferrer" target="_blank">docs</a></p>', `link html is ${v && v.html}`)
  // Paste: hostile HTML is sanitised before it reaches the editor or the value.
  await h.mount({ value: null })
  await editor.click()
  await page.evaluate(([tag, evil]) => {
    const ed = document.querySelector(tag).shadowRoot.querySelector('[role="textbox"]')
    const dt = new DataTransfer()
    dt.setData('text/html', evil)
    dt.setData('text/plain', 'plain')
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }))
  }, [h.manifest.tag, EVIL])
  v = await h.lastValue()
  assert(v && v.html, 'paste should emit a value')
  clean(v.html, assert, 'pasted value')
  clean(await editor.evaluate((el) => el.innerHTML), assert, 'editor after paste')
  assert(v.html.includes('<a href="https://ok.example/x" rel="noopener noreferrer" target="_blank">good link</a>'), `safe link kept: ${v.html}`)
  assert(v.text.includes('bad link') && v.text.includes('from a div') && v.text.includes('Big'), `text of dropped elements kept: ${v.text}`)
  assert(!v.text.includes('svg text') && !v.text.includes('alert'), `script / svg text dropped: ${v.text}`)
  // A stored value is sanitised before it is rendered.
  await h.mount({ value: { html: EVIL, text: 'x' } })
  clean(await editor.evaluate((el) => el.innerHTML), assert, 'editor with a stored value')
  // Toolbar: one Tab stop, arrows move, aria-pressed toggles.
  await h.mount({ value: null })
  await page.keyboard.press('Tab')
  const focused = () => page.evaluate((tag) => document.querySelector(tag).shadowRoot.activeElement?.getAttribute('aria-label'), h.manifest.tag)
  assert((await focused()) === 'Bold', `first Tab should land on Bold (got ${await focused()})`)
  await page.keyboard.press('ArrowRight')
  assert((await focused()) === 'Italic', 'ArrowRight should move to Italic')
  await page.keyboard.press('End')
  assert((await focused()) === 'Redo', 'End should move to the last button')
  await page.keyboard.press('Tab')
  assert((await focused()) === label, 'Tab from the toolbar should reach the editor')
  // Counter and validity.
  await h.mount({ value: { html: '<p>This is far too long</p>', text: 'This is far too long' }, props: { max_length: 10 } })
  const validity = (await h.events('ut-validity')).pop()
  assert(validity && validity.detail.valid === false && validity.detail.message === 'Shorten the text to 10 characters', `validity ${JSON.stringify(validity?.detail)}`)
  assert((await h.shadow('.footer').textContent()).trim() === '20 / 10', 'the counter shows 20 / 10')
  // Basic toolbar.
  await h.mount({ value: null, props: { toolbar: 'basic' } })
  assert((await h.shadow('.tool').count()) === 8, `basic toolbar has 8 buttons (got ${await h.shadow('.tool').count()})`)
  // Read-only: no contenteditable, no toolbar.
  await h.mount({ value: sampleValue, readonly: true })
  assert((await h.shadow('[contenteditable]').count()) === 0, 'read-only must not be editable')
  assert((await h.shadow('[role="toolbar"]').count()) === 0, 'read-only has no toolbar')
}
