/** Contract spec for <ut-address> (run by scripts/browser-test.mjs). */
export const label = 'Site address'
export const props = { show_details: true }
export const sampleValue = {
  formatted: '1 Queen Street, Auckland CBD, Auckland 1010, New Zealand', street: '1 Queen Street', city: 'Auckland', region: 'Auckland',
  postcode: '1010', country: 'New Zealand', country_code: 'NZ', lat: -36.8441486, lng: 174.7671598, place_id: 'ChIJLWl7ckhIDW0RRhZBrhyJUBE',
}

/** What the server returns for the Google Places API (New) reference (toLookupItem: display fields formattedAddress, addressComponents, location; value field id). */
export const fixtures = {
  lookup: {
  "items": [
    {
      "value": "ChIJLWl7ckhIDW0RRhZBrhyJUBE",
      "label": "1 Queen Street, Auckland CBD, Auckland 1010, New Zealand",
      "description": "[{\"longText\":\"1\",\"shortText\":\"1\",\"types\":[\"street_number\"],\"languageCode\":\"en\"},{\"longText\":\"Queen Street\",\"shortText\":\"Queen St\",\"types\":[\"route\"],\"languageCode\":\"en\"},{\"longText\":\"Auckland CBD\",\"sho \u00b7 {\"latitude\":-36.8441486,\"longitude\":174.7671598}",
      "fields": {
        "formattedAddress": "1 Queen Street, Auckland CBD, Auckland 1010, New Zealand",
        "addressComponents": [
          {
            "longText": "1",
            "shortText": "1",
            "types": [
              "street_number"
            ],
            "languageCode": "en"
          },
          {
            "longText": "Queen Street",
            "shortText": "Queen St",
            "types": [
              "route"
            ],
            "languageCode": "en"
          },
          {
            "longText": "Auckland CBD",
            "shortText": "Auckland CBD",
            "types": [
              "sublocality_level_1",
              "sublocality",
              "political"
            ],
            "languageCode": "en"
          },
          {
            "longText": "Auckland",
            "shortText": "Auckland",
            "types": [
              "locality",
              "political"
            ],
            "languageCode": "en"
          },
          {
            "longText": "Auckland",
            "shortText": "AUK",
            "types": [
              "administrative_area_level_1",
              "political"
            ],
            "languageCode": "en"
          },
          {
            "longText": "New Zealand",
            "shortText": "NZ",
            "types": [
              "country",
              "political"
            ],
            "languageCode": "en"
          },
          {
            "longText": "1010",
            "shortText": "1010",
            "types": [
              "postal_code"
            ],
            "languageCode": "en"
          }
        ],
        "location": {
          "latitude": -36.8441486,
          "longitude": 174.7671598
        },
        "id": "ChIJLWl7ckhIDW0RRhZBrhyJUBE"
      }
    },
    {
      "value": "ChIJ9WwMzP2xbW0RkK3ZSVn0b-A",
      "label": "1 Queen Street East, Hastings 4122, New Zealand",
      "description": "[{\"longText\":\"1\",\"shortText\":\"1\",\"types\":[\"street_number\"],\"languageCode\":\"en\"},{\"longText\":\"Queen Street East\",\"shortText\":\"Queen St E\",\"types\":[\"route\"],\"languageCode\":\"en\"},{\"longText\":\"Hastings\",\" \u00b7 {\"latitude\":-39.6406571,\"longitude\":176.8448713}",
      "fields": {
        "formattedAddress": "1 Queen Street East, Hastings 4122, New Zealand",
        "addressComponents": [
          {
            "longText": "1",
            "shortText": "1",
            "types": [
              "street_number"
            ],
            "languageCode": "en"
          },
          {
            "longText": "Queen Street East",
            "shortText": "Queen St E",
            "types": [
              "route"
            ],
            "languageCode": "en"
          },
          {
            "longText": "Hastings",
            "shortText": "Hastings",
            "types": [
              "locality",
              "political"
            ],
            "languageCode": "en"
          },
          {
            "longText": "Hawke's Bay",
            "shortText": "HKB",
            "types": [
              "administrative_area_level_1",
              "political"
            ],
            "languageCode": "en"
          },
          {
            "longText": "New Zealand",
            "shortText": "NZ",
            "types": [
              "country",
              "political"
            ],
            "languageCode": "en"
          },
          {
            "longText": "4122",
            "shortText": "4122",
            "types": [
              "postal_code"
            ],
            "languageCode": "en"
          }
        ],
        "location": {
          "latitude": -39.6406571,
          "longitude": 176.8448713
        },
        "id": "ChIJ9WwMzP2xbW0RkK3ZSVn0b-A"
      }
    }
  ]
},
}

const input = (h) => h.shadow('input[role="combobox"]')
const validity = async (h) => (await h.events('ut-validity')).pop()?.detail

export default async function spec(h) {
  const { page, assert } = h
  await h.mount({ value: null })
  // Combobox semantics.
  const box = input(h)
  assert((await box.getAttribute('aria-expanded')) === 'false', 'collapsed at first')
  const listId = await box.getAttribute('aria-controls')
  assert(listId && (await h.shadow(`#${listId}`).getAttribute('role')) === 'listbox', 'aria-controls points at the listbox')

  // Too short: no request.
  await box.focus()
  await page.keyboard.type('1 Q')
  await page.waitForTimeout(100)
  await page.keyboard.type('ueen')
  await page.waitForTimeout(500)
  const reqs = (await h.requests()).filter((r) => r.kind === 'lookup')
  assert(reqs.length === 1 && reqs[0].payload.query === '1 Queen', `one debounced lookup for "1 Queen" (${JSON.stringify(reqs)})`)
  assert((await box.getAttribute('aria-expanded')) === 'true', 'expanded with suggestions')
  assert((await h.shadow('[role="option"]').count()) === 2, 'two options')
  const typed = await validity(h)
  assert(typed && typed.valid === false && /Choose an address from the list/.test(typed.message), `typed but unselected is invalid (${JSON.stringify(typed)})`)
  await h.shot('open')

  // Keyboard: Down, Down, Up, Enter.
  await page.keyboard.press('ArrowDown')
  const first = await box.getAttribute('aria-activedescendant')
  assert(first && (await h.shadow(`#${first}`).getAttribute('aria-selected')) === 'true', 'Down activates the first option')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  const v = await h.lastValue()
  assert(v && v.formatted === sampleValue.formatted, `Enter chooses the first address (${JSON.stringify(v)})`)
  for (const k of ['street', 'city', 'region', 'postcode', 'country', 'country_code', 'lat', 'lng', 'place_id']) {
    assert(v[k] === sampleValue[k], `parsed ${k}: ${JSON.stringify(v[k])} (expected ${JSON.stringify(sampleValue[k])})`)
  }
  assert((await box.getAttribute('aria-expanded')) === 'false', 'closes after choosing')
  assert((await validity(h)).valid === true, 'valid after choosing')
  assert((await box.inputValue()) === sampleValue.formatted, 'the input shows the formatted address')

  // Mouse: clear, search, click the second option.
  await h.shadow('button[aria-label="Clear the address"]').click()
  assert((await h.lastValue()) === null, 'Clear empties the value')
  await box.fill('1 Queen')
  await page.waitForTimeout(500)
  await h.shadow('[role="option"]').nth(1).click()
  const second = await h.lastValue()
  assert(second.city === 'Hastings' && second.region === "Hawke's Bay" && second.postcode === '4122' && second.street === '1 Queen Street East', `click chooses the second (${JSON.stringify(second)})`)

  // Escape closes, then clears.
  await box.fill('1 Queen')
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  assert((await box.getAttribute('aria-expanded')) === 'false', 'Escape closes')
  await page.keyboard.press('Escape')
  assert((await box.inputValue()) === '', 'second Escape clears the text')

  // Country hint is appended to the query.
  await h.mount({ value: null, props: { country_hint: 'New Zealand' } })
  await input(h).fill('12 High St')
  await page.waitForTimeout(500)
  const hinted = (await h.requests()).filter((r) => r.kind === 'lookup').pop()
  assert(hinted?.payload.query === '12 High St, New Zealand', `country hint appended (${hinted?.payload.query})`)

  // No matches + the live region.
  await h.mount({ value: null })
  await page.evaluate(() => { window.__answers.lookup = { items: [] } })
  await input(h).fill('zzzz')
  await page.waitForTimeout(500)
  assert(await h.shadow('.notice:has-text("No matches")').isVisible(), 'shows No matches')
  assert((await h.shadow('[aria-live]').textContent()).includes('No matches'), 'announces No matches')

  // Error.
  await page.evaluate(() => { window.__answers.lookup = () => Promise.reject(new Error('Quota exceeded')) })
  await input(h).fill('zzzzz')
  await page.waitForTimeout(500)
  assert(await h.shadow('.notice.error').isVisible(), 'shows the lookup error')
  await h.shot('error')

  // Legacy Places / Geocoding shape and flat fields.
  await page.evaluate(() => {
    window.__answers.lookup = { items: [
      { value: 'legacy1', label: 'Unter den Linden 77, 10117 Berlin, Germany', fields: { place_id: 'legacy1', formatted_address: 'Unter den Linden 77, 10117 Berlin, Germany',
        address_components: [{ long_name: '77', short_name: '77', types: ['street_number'] }, { long_name: 'Unter den Linden', short_name: 'Unter den Linden', types: ['route'] },
          { long_name: 'Berlin', short_name: 'Berlin', types: ['locality', 'political'] }, { long_name: 'Berlin', short_name: 'BE', types: ['administrative_area_level_1', 'political'] },
          { long_name: 'Germany', short_name: 'DE', types: ['country', 'political'] }, { long_name: '10117', short_name: '10117', types: ['postal_code'] }],
        geometry: { location: { lat: 52.5163, lng: 13.3777 } } } },
      { value: 'site-7', label: 'Depot 7', fields: { street: '7 Wharf Road', city: 'Nelson', region: 'Nelson', postcode: '7010', country: 'New Zealand', lat: '-41.27', lng: '173.28' } },
    ] }
  })
  await input(h).fill('anything')
  await page.waitForTimeout(500)
  await h.shadow('[role="option"]').nth(0).click()
  const legacy = await h.lastValue()
  assert(legacy.street === 'Unter den Linden 77' && legacy.country_code === 'DE' && legacy.lat === 52.5163 && legacy.lng === 13.3777 && legacy.place_id === 'legacy1', `legacy shape (${JSON.stringify(legacy)})`)
  await input(h).fill('anything else')
  await page.waitForTimeout(500)
  await h.shadow('[role="option"]').nth(1).click()
  const flat = await h.lastValue()
  assert(flat.formatted === '7 Wharf Road, Nelson, Nelson 7010, New Zealand' && flat.lat === -41.27 && flat.place_id === 'site-7', `flat fields (${JSON.stringify(flat)})`)

  // Manual entry builds formatted.
  await h.mount({ value: null })
  await h.shadow('button:has-text("Enter the address manually")').click()
  await page.keyboard.type('12 High Street')
  await h.shadow('#m-city').fill('Dunedin')
  await h.shadow('#m-postcode').fill('9016')
  const manual = await h.lastValue()
  assert(manual.formatted === '12 High Street, Dunedin, 9016' && manual.street === '12 High Street' && manual.lat === null, `manual value (${JSON.stringify(manual)})`)
  assert((await validity(h)).valid === true, 'manual entry is valid')
  await h.shot('manual')

  // Read-only: the formatted address as text, no input.
  await h.mount({ value: sampleValue, readonly: true })
  assert((await h.shadow('input').count()) === 0, 'no inputs when read-only')
  assert((await h.shadow('.readonly').textContent()).includes('1 Queen Street'), 'shows the formatted address')
}
