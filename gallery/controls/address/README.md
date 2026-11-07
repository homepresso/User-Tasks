# Address

`<ut-address>` — an address search field. Suggestions come from the field's **lookup source** (the
server calls it), and the chosen suggestion is stored as a structured address with coordinates.

## Value

Type `json`, or empty (`null`):

```json
{ "formatted": "1 Queen Street, Auckland CBD, Auckland 1010, New Zealand",
  "street": "1 Queen Street", "city": "Auckland", "region": "Auckland", "postcode": "1010",
  "country": "New Zealand", "country_code": "NZ", "lat": -36.8441486, "lng": 174.7671598,
  "place_id": "ChIJLWl7ckhIDW0RRhZBrhyJUBE" }
```

Parts are strings or `null`; `lat` / `lng` numbers or `null` (manual entry has no coordinates).
The schema requires `formatted` (1–500 characters) and bounds every part. Read-only views show
`{{value.formatted}}`.

Text typed but not chosen from the list makes the field invalid: "Choose an address from the list
(or enter it manually)".

Suggestions are parsed from:

- **Google Places API (New)**: `formattedAddress`, `addressComponents[] { longText, shortText, types }`,
  `location { latitude, longitude }`, `id`;
- **legacy Places / Geocoding**: `formatted_address`, `address_components[] { long_name, short_name, types }`,
  `geometry.location { lat, lng }`, `place_id`;
- **flat fields** (other providers, a data table of sites): `street`, `city`, `region`, `postcode`,
  `country`, `country_code`, `lat`, `lng` (and common synonyms such as `postal_code`, `state`, `latitude`).
  A named row (e.g. "Depot 7") shows its name with the address below.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Placeholder (`placeholder`) | text | Start typing an address | |
| Search after (`min_chars`) | number 1–20 | 3 | characters |
| Wait after typing (`debounce_ms`) | number 0–2000 | 350 | ms |
| Allow manual entry (`allow_manual`) | yes / no | yes | "Enter the address manually": street, city, region, postcode, country |
| Show address details (`show_details`) | yes / no | no | The parsed parts and coordinates under the field |
| Country hint (`country_hint`) | text | — | Appended to each search as ", New Zealand" |

## Keyboard and screen readers

An ARIA 1.2 combobox: the input has `role="combobox"`, `aria-expanded`, `aria-controls` (the
listbox) and `aria-activedescendant`; suggestions are `role="option"`. Down / Up move, Enter
chooses, Escape closes the list (a second Escape clears the text), Tab leaves. "N addresses found",
"No matches" and errors are announced in a polite live region; a spinner shows while searching. The
clear button is labelled "Clear the address".

## Capabilities

`lookup` only: `request('lookup', { query })` goes to the UserTasks server, which runs the field's
configured lookup source and returns the configured item fields. No network access from the
control.

## Security / setup

No Google API key ever reaches the browser. The form runs controls in a sandboxed frame with an
opaque origin and no referrer, so referrer-restricted browser keys cannot work, and an unrestricted
key in the page would be exposed. Instead the key lives in an integration on the server:

- **Integration** "Google Places API (New)": REST, `https://places.googleapis.com`, API key in the
  `X-Goog-Api-Key` header (you enter it when installing). Restrict the key to Places API (New).
- **API reference** "Places text search (addresses)": `POST /v1/places:searchText`, header
  `X-Goog-FieldMask: places.id,places.formattedAddress,places.addressComponents,places.location`,
  body `{"textQuery":"{{query}}","maxResultCount":5}`.
- **Field lookup**: source = that reference, `query` = `{{search}}`, results path `places`,
  display fields `formattedAddress`, `addressComponents`, `location`, value field `id`,
  min 3 characters, 400 ms debounce, 5 results, 300 s cache.
- **Sample form** "Address and location (sample)": Address plus a Map whose Location follows it.
- **Map control** (`ut-map`): the sample form uses it, so it is installed with this package. It needs network access to `tile.openstreetmap.org`; the install wizard lists that host, and the map stays blank until an admin approves it in **Extensibility → Form controls**.

Google bills Text Search per request; the cache and the minimum length keep the count down.
Check Google's terms for displaying and storing Places data.

Bundles Lit 3.3.3 (BSD-3-Clause).
