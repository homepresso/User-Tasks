/** Contract spec for <ut-pdf-viewer> (run by scripts/browser-test.mjs). */
export const label = 'Service agreement'
export const props = { allow_upload: false }
// A hand-written 2-page PDF (Helvetica text), 1406 bytes.
const PDF = 'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFs1IDAgUiA3IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nID4+CmVuZG9iago0IDAgb2JqCjw8IC9MZW5ndGggMzEzID4+CnN0cmVhbQpCVAovRjEgMjIgVGYgMSAwIDAgMSA3MiA3NjAgVG0gKFNlcnZpY2UgYWdyZWVtZW50KSBUagovRjEgMTMgVGYgMSAwIDAgMSA3MiA3MjAgVG0gKFBhZ2Ugb25lOiB0aGUgcGFydGllcyBhZ3JlZSB0byB0aGUgdGVybXMgYmVsb3cuKSBUagovRjEgMTMgVGYgMSAwIDAgMSA3MiA2OTYgVG0gKDEuIFNjb3BlIG9mIHdvcmsgYW5kIGRlbGl2ZXJhYmxlcy4pIFRqCi9GMSAxMyBUZiAxIDAgMCAxIDcyIDY3MiBUbSAoMi4gRmVlcyBhcmUgZHVlIHdpdGhpbiAzMCBkYXlzLikgVGoKRVQKMC4xOCAwLjM3IDAuODIgUkcgMiB3IDcyIDc0MiBtIDU0MCA3NDIgbCBTCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDMgMCBSID4+ID4+IC9Db250ZW50cyA0IDAgUiA+PgplbmRvYmoKNiAwIG9iago8PCAvTGVuZ3RoIDI5MSA+PgpzdHJlYW0KQlQKL0YxIDIyIFRmIDEgMCAwIDEgNzIgNzYwIFRtIChTY2hlZHVsZSBBKSBUagovRjEgMTMgVGYgMSAwIDAgMSA3MiA3MjAgVG0gKFBhZ2UgdHdvOiBzaWduYXR1cmVzIGFuZCBkYXRlcy4pIFRqCi9GMSAxMyBUZiAxIDAgMCAxIDcyIDY5NiBUbSAoU2lnbmVkIGZvciB0aGUgY3VzdG9tZXI6IF9fX19fX19fKSBUagovRjEgMTMgVGYgMSAwIDAgMSA3MiA2NzIgVG0gKFNpZ25lZCBmb3IgdGhlIHN1cHBsaWVyOiBfX19fX19fXykgVGoKRVQKMC4xOCAwLjM3IDAuODIgUkcgMiB3IDcyIDc0MiBtIDU0MCA3NDIgbCBTCmVuZHN0cmVhbQplbmRvYmoKNyAwIG9iago8PCAvVHlwZSAvUGFnZSAvUGFyZW50IDIgMCBSIC9NZWRpYUJveCBbMCAwIDYxMiA3OTJdIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDMgMCBSID4+ID4+IC9Db250ZW50cyA2IDAgUiA+PgplbmRvYmoKeHJlZgowIDgKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNjQgMDAwMDAgbiAKMDAwMDAwMDEyNyAwMDAwMCBuIAowMDAwMDAwMjI0IDAwMDAwIG4gCjAwMDAwMDA1ODggMDAwMDAgbiAKMDAwMDAwMDcxNCAwMDAwMCBuIAowMDAwMDAxMDU2IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgOCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMTE4MgolJUVPRgo='
const REF = { id: 'f1', name: 'sample.pdf', size: 1406, type: 'application/pdf' }
export const fixtures = {
  file: { ...REF, __bytes: PDF },
  upload: { id: 'u1', name: 'uploaded.pdf', size: 1406, type: 'application/pdf' },
}
// The generic checks (themes, read-only, axe, mobile) show the uploaded-PDF case: the value is the file.
export const sampleValue = [REF]
export const settle = 900

const CONTEXT = { fields: { document: [{ id: 'a0', name: 'photo.jpg', size: 2000, type: 'image/jpeg' }, REF] }, field_key: 'pdf', form_id: null, task_id: null, workflow_id: null }

async function waitFor(h, check, message, ms = 5000) {
  const until = Date.now() + ms
  while (Date.now() < until) { if (await check()) return; await h.page.waitForTimeout(50) }
  throw new Error(message)
}

export default async function spec(h) {
  const { page, assert } = h
  const tag = h.manifest.tag
  const canvasLabel = () => h.shadow('canvas').getAttribute('aria-label')
  const pageText = () => page.evaluate((t) => document.querySelector(t).shadowRoot.querySelector('.viewer .sr-only')?.textContent ?? '', tag)
  const painted = () => page.evaluate((t) => {
    const c = document.querySelector(t).shadowRoot.querySelector('canvas')
    if (!c || !c.width) return false
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 16) if (d[i] < 128 && d[i + 3] > 0) dark++
    return dark > 50
  }, tag)

  // Empty state without a mapped document.
  await h.mount({ value: null })
  assert((await h.shadow('.state').textContent()).includes('No document yet'), 'empty state without a document')
  assert((await h.requests()).length === 0, 'no request without a document')
  await h.shot('empty')

  // The first PDF of the mapped Attachments field (the JPEG is skipped), read with request('file').
  await h.mount({ value: null, context: CONTEXT })
  await waitFor(h, async () => (await canvasLabel()) === 'Page 1 of 2, sample.pdf' && await painted(), 'page 1 should render from the context document')
  const reqs = await h.requests()
  assert(reqs.length === 1 && reqs[0].kind === 'file' && reqs[0].payload.id === 'f1', `requests: ${JSON.stringify(reqs)}`)
  await waitFor(h, async () => (await pageText()).includes('Service agreement'), 'page text for screen readers')
  assert((await h.shadow('.pageinfo').textContent()).trim() === 'Page 1 of 2', 'page indicator')
  assert((await h.events('ut-change')).length === 0, 'viewing never emits ut-change')
  // Keyboard on the viewer: PageDown / PageUp / End / Home, + / - / 0.
  await h.shadow('.viewer').focus()
  // PageDown scrolls a zoomed page first, then turns to the next one.
  for (let i = 0; i < 4 && (await canvasLabel()) !== 'Page 2 of 2, sample.pdf'; i++) { await page.keyboard.press('PageDown'); await page.waitForTimeout(400) }
  await waitFor(h, async () => (await canvasLabel()) === 'Page 2 of 2, sample.pdf' && (await pageText()).includes('Schedule A'), 'PageDown shows page 2 and its text')
  await page.keyboard.press('Home')
  await waitFor(h, async () => (await canvasLabel()) === 'Page 1 of 2, sample.pdf', 'Home goes to page 1')
  const w0 = await h.shadow('canvas').evaluate((c) => c.getBoundingClientRect().width)
  await page.keyboard.press('-')
  await waitFor(h, async () => (await h.shadow('canvas').evaluate((c) => c.getBoundingClientRect().width)) < w0 - 10, 'minus zooms out')
  await page.keyboard.press('0')
  await waitFor(h, async () => Math.abs((await h.shadow('canvas').evaluate((c) => c.getBoundingClientRect().width)) - w0) < 3, '0 fits the width again')
  // Toolbar buttons.
  await h.shadow('button[aria-label="Next page"]').click()
  await waitFor(h, async () => (await canvasLabel()) === 'Page 2 of 2, sample.pdf', 'Next page button')
  assert(await h.shadow('button[aria-label="Next page"]').isDisabled(), 'Next is disabled on the last page')
  await h.shadow('button[aria-label="Rotate clockwise"]').click()
  await waitFor(h, async () => { const r = await h.shadow('canvas').evaluate((c) => c.getBoundingClientRect()); return r.width > 0 && r.height < r.width }, 'rotation turns the page landscape')
  await h.shot('context')

  // Errors: not a PDF, and a rejected request.
  await page.evaluate(() => { window.__answers.file = { id: 'f1', name: 'sample.pdf', type: 'application/pdf', size: 5, bytes: new TextEncoder().encode('hello').buffer } })
  await h.update({ context: { ...CONTEXT, fields: { document: [{ ...REF, id: 'f2' }] } } })
  await waitFor(h, async () => (await h.shadow('[role="alert"]').count()) === 1, 'a non-PDF shows an error')
  assert((await h.shadow('[role="alert"]').textContent()).includes('isn’t a PDF'), 'the error says it isn’t a PDF')
  await page.evaluate(() => { window.__answers.file = () => Promise.reject(new Error('Refused')) })
  await h.update({ context: { ...CONTEXT, fields: { document: [{ ...REF, id: 'f3' }] } } })
  await waitFor(h, async () => ((await h.shadow('[role="alert"]').textContent().catch(() => '')) || '').includes('couldn’t be loaded'), 'a rejected request shows a friendly error')

  // Upload: Choose a PDF → request('upload') → value [{ id, name, size, type }], shown from the local bytes.
  await h.mount({ value: null, props: { allow_upload: true } })
  assert(await h.shadow('button.primary').isVisible(), 'Choose a PDF is shown when uploads are allowed')
  const bytes = Buffer.from(PDF, 'base64')
  await h.shadow('input[type="file"]').setInputFiles({ name: 'mine.pdf', mimeType: 'application/pdf', buffer: bytes })
  await waitFor(h, async () => Array.isArray(await h.lastValue()), 'upload emits the file')
  const v = await h.lastValue()
  assert(v.length === 1 && v[0].id === 'u1' && v[0].name === 'uploaded.pdf' && v[0].type === 'application/pdf', `value: ${JSON.stringify(v)}`)
  const up = (await h.requests()).find((r) => r.kind === 'upload')
  assert(up && up.payload.name === 'mine.pdf' && up.payload.size === bytes.length, `upload request: ${JSON.stringify(up)}`)
  await waitFor(h, async () => (await canvasLabel()) === 'Page 1 of 2, uploaded.pdf' && await painted(), 'the uploaded PDF renders')
  assert(!(await h.requests()).some((r) => r.kind === 'file'), 'the uploaded PDF is shown from its local bytes')
  // A non-PDF upload is refused before any request.
  await h.shadow('input[type="file"]').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('just text') })
  await waitFor(h, async () => (await h.shadow('[role="alert"]').count()) === 1, 'a non-PDF upload shows an error')
  assert((await h.requests()).filter((r) => r.kind === 'upload').length === 1, 'no upload request for a non-PDF')
  // Remove clears the value.
  await h.mount({ value: [{ id: 'u1', name: 'uploaded.pdf', size: 1406, type: 'application/pdf' }], props: { allow_upload: true } })
  await h.shadow('button[aria-label="Remove the PDF"]').click()
  assert((await h.lastValue()) === null, 'Remove empties the field')
  // Read-only: no upload controls, viewing still works.
  await h.mount({ value: null, readonly: true, props: { allow_upload: true }, context: CONTEXT })
  await waitFor(h, async () => (await canvasLabel()) === 'Page 1 of 2, sample.pdf', 'read-only still shows the document')
  assert((await h.shadow('input[type="file"]').count()) === 0 && (await h.shadow('button.primary').count()) === 0, 'read-only has no upload')
}
