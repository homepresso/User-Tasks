/** Contract spec for <ut-map> (run by scripts/browser-test.mjs). `tile` requests are answered from a fixture: the harness never hits the internet. */
export const label = 'Site location'
export const props = {}
export const sampleValue = { lat: -36.844149, lng: 174.76716 }
export const settle = 400
export const ignoreErrors = ['Failed to load resource', 'net::ERR_FAILED', 'ERR_BLOCKED']

const TILE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAFQklEQVR42u3UoRWAMBBEwfRfEhqBooAIFIIu4FHCxZzYEYefx+aPY99e51zmjf/z3LPtrnm2Xqedn7/TLgAeAL8ACAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD//cgD8AH7+PL8AeAD8AiAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz8AmAA/PwCYAD8/AJgAPz89QD4Afz8eX4B8AD4BUAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj5BcAA+PkFwAD4+QXAAPj56wHwA/j58/wC4AHwC4AA8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDzC4AB8PMLgAHw8wuAAfDz1wPgB/Dz5/kFwAPgFwAB4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnFwAD4OcXAAPg5xcAA+DnrwfAD+Dnz/MLgAfALwACwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPLwAGwM8vAAbAzy8ABsDPXw+AH8DPn+cXAA+AXwAEgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfXwAMgJ9fAAyAn18ADICfvx4AP4CfP88vAB4AvwAIAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP78AGAA/vwAYAD+/ABgAP/9yAJxzmfcBQQP23jzElC0AAAAASUVORK5CYII=', 'base64')
export const fixtures = { tile: { type: 'image/png', __bytes: TILE_PNG.toString('base64') } }

const ADDRESS = {
  formatted: '1 Queen Street, Auckland CBD, Auckland 1010, New Zealand', street: '1 Queen Street', city: 'Auckland', region: 'Auckland',
  postcode: '1010', country: 'New Zealand', country_code: 'NZ', lat: -36.8441486, lng: 174.7671598, place_id: 'ChIJLWl7ckhIDW0RRhZBrhyJUBE',
}
const ctx = (location) => ({ fields: { location }, field_key: 'location', form_id: null, task_id: null, workflow_id: null })
const mapLabel = (h) => h.shadow('.map').getAttribute('aria-label')

export default async function spec(h) {
  const { page, assert } = h
  // Show mode: the address from the context, tiles through blob: URLs, attribution, never emits.
  await h.mount({ value: null, context: ctx(ADDRESS) })
  await page.waitForTimeout(300)
  assert((await h.shadow('.ut-pin').count()) === 1, 'one pin for the mapped address')
  assert((await mapLabel(h)).includes('-36.84415, 174.76716'), `the map is named with the pin (${await mapLabel(h)})`)
  const srcs = await page.evaluate(() => [...document.querySelector('ut-map').shadowRoot.querySelectorAll('.ut-tile img')].map((i) => i.src))
  assert(srcs.length > 0 && srcs.every((s) => s.startsWith('blob:')), `tiles are blob: images (${srcs.length})`)
  const attrib = await h.shadow('.attrib').textContent()
  assert(attrib.includes('© OpenStreetMap contributors') && !attrib.includes('CARTO'), `attribution (${attrib})`)
  await h.shadow('.map').click({ position: { x: 200, y: 150 } })
  // The context changes (another address): the pin follows; still no value.
  await h.update({ context: ctx('-41.2865, 174.7762') })
  await page.waitForTimeout(150)
  assert((await mapLabel(h)).includes('-41.28650, 174.77620'), 'a "lat,lng" string moves the pin')
  await h.update({ context: ctx({ latitude: -43.5321, longitude: 172.6362 }) })
  assert((await mapLabel(h)).includes('-43.53210, 172.63620'), '{latitude, longitude} moves the pin')
  await h.update({ context: ctx({ lat: 51.5, lon: -0.12 }) })
  assert((await mapLabel(h)).includes('51.50000, -0.12000'), '{lat, lon} moves the pin')
  assert((await h.events('ut-change')).length === 0, 'show mode never emits')
  assert((await h.shadow('input').count()) === 0, 'no coordinate inputs in show mode')
  assert((await h.shadow('.coords').textContent()).includes('51.50000'), 'coordinates shown under the map')

  // Pick mode: click drops the pin.
  await h.mount({ value: null, props: { pick: true } })
  await h.shadow('.map').click({ position: { x: 300, y: 160 } })
  const clicked = await h.lastValue()
  assert(clicked && typeof clicked.lat === 'number' && typeof clicked.lng === 'number' && Math.abs(clicked.lat) <= 90, `click emits {lat,lng} (${JSON.stringify(clicked)})`)
  await h.shot('pick')

  // Keyboard: Tab to the map (crosshair), Enter drops the pin at the centre, arrows pan.
  await h.mount({ value: sampleValue, props: { pick: true } })
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => document.querySelector('ut-map').shadowRoot.activeElement?.classList.contains('map'))
  assert(focused, 'Tab focuses the map')
  const cross = await page.evaluate(() => getComputedStyle(document.querySelector('ut-map').shadowRoot.querySelector('.crosshair')).display)
  assert(cross === 'block', `crosshair while the map has keyboard focus (${cross})`)
  await h.shot('keyboard')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  const keyed = await h.lastValue()
  assert(keyed && Math.abs(keyed.lat - sampleValue.lat) < 0.01 && keyed.lng > sampleValue.lng, `Enter drops the pin at the panned centre (${JSON.stringify(keyed)})`)
  await page.keyboard.press('Minus')
  await page.waitForTimeout(300)

  // Coordinate inputs set the pin; bad input is reported and not emitted.
  const before = (await h.events('ut-change')).length
  await h.shadow('#lat').fill('95')
  await h.shadow('#lng').fill('10')
  await h.shadow('#lng').press('Enter')
  assert((await h.events('ut-change')).length === before, 'an out-of-range latitude is not emitted')
  assert((await h.shadow('[role="alert"]').textContent()).includes('Latitude'), 'the problem is announced')
  await h.shadow('#lat').fill('-45.8788')
  await h.shadow('#lng').fill('170.5028')
  await h.shadow('#lng').press('Enter')
  const typed = await h.lastValue()
  assert(typed.lat === -45.8788 && typed.lng === 170.5028, `coordinate inputs set the pin (${JSON.stringify(typed)})`)
  assert((await mapLabel(h)).includes('-45.87880, 170.50280'), 'the map follows the inputs')
  await h.shadow('button:has-text("Clear")').click()
  assert((await h.lastValue()) === null, 'Clear removes the pin')

  // Pick mode follows a changed address.
  await h.mount({ value: null, props: { pick: true }, context: ctx(null) })
  await h.update({ context: ctx(ADDRESS) })
  await page.waitForTimeout(100)
  const followed = await h.lastValue()
  assert(followed && followed.lat === -36.844149 && followed.lng === 174.76716, `a new address moves the pin in pick mode (${JSON.stringify(followed)})`)

  // Read-only: the pin, no picking, no inputs.
  await h.mount({ value: sampleValue, props: { pick: true }, readonly: true })
  await h.shadow('.map').click({ position: { x: 100, y: 100 } })
  await page.keyboard.press('Enter')
  assert((await h.events('ut-change')).length === 0, 'read-only never emits')
  assert((await h.shadow('input').count()) === 0, 'no coordinate inputs when read-only')
  assert((await h.shadow('.ut-pin').count()) === 1, 'read-only shows the pin')

  // Tiles blocked (hosts not approved): neutral background, the pin, and the note.
  await h.mount({ value: sampleValue, props: { tiles: 'osm' } })
  // The host refuses tiles (hosts not approved): mount a fresh map with that answer in place.
  await page.evaluate(() => {
    window.__answers.tile = () => Promise.reject(new Error('Map tiles are not approved for this control'))
    const old = document.querySelector('ut-map')
    window.__mount('ut-map', { value: old.value, props: old.props, theme: old.theme, label: old.label, context: old.context, capabilities: old.capabilities }, ['tiles', 'zoom', 'height', 'pick', 'show_coordinates'])
  })
  await page.waitForTimeout(800)
  await page.waitForTimeout(400)
  const note = await h.shadow('.note').textContent().catch(() => '')
  assert(note.includes('Map tiles are blocked until an administrator approves tile.openstreetmap.org'), `blocked-tiles note (${note})`)
  assert((await h.shadow('.ut-pin').count()) === 1, 'the pin still shows without tiles')
  assert(!(await h.shadow('.attrib').textContent()).includes('CARTO'), 'OSM attribution only for OSM tiles')
  await h.shot('blocked')
}
