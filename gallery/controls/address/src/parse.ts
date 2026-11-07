/**
 * Address parsing for <ut-address>: turn a lookup item into the stored
 * address. Accepts Google Places API (New) items, the legacy Places /
 * Geocoding shape and flat fields (other providers, a data table of sites).
 */

export interface AddressValue {
  formatted: string
  street: string | null
  city: string | null
  region: string | null
  postcode: string | null
  country: string | null
  country_code: string | null
  lat: number | null
  lng: number | null
  place_id: string | null
}

export const ADDRESS_PARTS = ['street', 'city', 'region', 'postcode', 'country'] as const
export type AddressPart = (typeof ADDRESS_PARTS)[number]

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, max = 200): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function num(v: unknown, limit: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && Math.abs(n) <= limit ? Math.round(n * 1e7) / 1e7 : null
}

function first(rec: Rec, keys: string[]): unknown {
  for (const k of keys) {
    const v = rec[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}

interface Component { long: string; short: string; types: string[] }

function components(raw: unknown): Component[] {
  if (!Array.isArray(raw)) return []
  const out: Component[] = []
  for (const c of raw) {
    if (!isRec(c)) continue
    const long = str(c.longText ?? c.long_name ?? c.name) ?? ''
    const short = str(c.shortText ?? c.short_name) ?? long
    const types = Array.isArray(c.types) ? c.types.filter((t): t is string => typeof t === 'string') : []
    if (long || short) out.push({ long, short, types })
  }
  return out
}

/** Countries that write the street name before the number. */
const ROUTE_FIRST = new Set(['DE', 'AT', 'CH', 'NL', 'BE', 'IT', 'ES', 'PT', 'PL', 'CZ', 'SK', 'DK', 'SE', 'NO', 'FI', 'IS', 'HU', 'HR', 'SI', 'RS', 'BR', 'AR', 'MX', 'CL', 'CO', 'TR', 'GR', 'RO', 'BG', 'LT', 'LV', 'EE'])

function fromComponents(list: Component[]): Partial<AddressValue> {
  const get = (type: string, short = false) => {
    const c = list.find((x) => x.types.includes(type))
    return c ? (short ? c.short : c.long) || null : null
  }
  const countryCode = get('country', true)
  const number = get('street_number')
  const route = get('route')
  const sub = get('subpremise')
  let street: string | null = null
  if (route) {
    const num = sub && number ? `${sub}/${number}` : number
    street = num ? (countryCode && ROUTE_FIRST.has(countryCode.toUpperCase()) ? `${route} ${num}` : `${num} ${route}`) : route
  } else street = get('premise') ?? get('point_of_interest') ?? null
  return {
    street,
    city: get('locality') ?? get('postal_town') ?? get('sublocality') ?? get('sublocality_level_1') ?? get('administrative_area_level_2'),
    region: get('administrative_area_level_1'),
    postcode: get('postal_code'),
    country: get('country'),
    country_code: countryCode ? countryCode.toUpperCase().slice(0, 3) : null,
  }
}

/** One line from the parts (manual entry, or a provider without a formatted address). */
export function formatParts(parts: Partial<Record<AddressPart, string | null>>): string {
  const regionLine = [parts.region, parts.postcode].filter(Boolean).join(' ')
  return [parts.street, parts.city, regionLine, parts.country].map((s) => (s ?? '').trim()).filter(Boolean).join(', ')
}

/** A lookup item (`{ value, label, description?, fields }`) → the stored address, or null. */
export function addressFromItem(item: unknown): AddressValue | null {
  if (!isRec(item)) return null
  const f: Rec = isRec(item.fields) ? item.fields : isRec(item.data) ? item.data : item
  const list = components(first(f, ['addressComponents', 'address_components']))
  const parsed = list.length ? fromComponents(list) : {}

  const loc = first(f, ['location', 'geometry'])
  let lat: unknown
  let lng: unknown
  if (isRec(loc)) {
    const point = isRec(loc.location) ? loc.location : loc
    lat = first(point, ['latitude', 'lat'])
    lng = first(point, ['longitude', 'lng', 'lon'])
  }
  lat ??= first(f, ['lat', 'latitude'])
  lng ??= first(f, ['lng', 'lon', 'long', 'longitude'])

  const flat = (keys: string[]) => str(first(f, keys))
  const out: AddressValue = {
    formatted: '',
    street: parsed.street ?? flat(['street', 'address_line1', 'line1', 'address1', 'street_address']),
    city: parsed.city ?? flat(['city', 'locality', 'town', 'suburb']),
    region: parsed.region ?? flat(['region', 'state', 'province', 'county']),
    postcode: parsed.postcode ?? flat(['postcode', 'postal_code', 'zip', 'zip_code', 'postalCode']),
    country: parsed.country ?? flat(['country', 'country_name']),
    country_code: parsed.country_code ?? (flat(['country_code', 'countryCode'])?.toUpperCase().slice(0, 3) ?? null),
    lat: num(lat, 90),
    lng: num(lng, 180),
    place_id: str(first(f, ['id', 'place_id', 'placeId']), 300) ?? str(item.value, 300),
  }
  const label = typeof item.label === 'string' && item.label.trim() && !/^[[{]/.test(item.label.trim()) ? item.label.trim().slice(0, 500) : null
  const formatted = str(first(f, ['formattedAddress', 'formatted_address', 'formatted', 'address', 'full_address']), 500)
    ?? (formatParts(out) || null)
    ?? label
  if (!formatted) return null
  out.formatted = formatted
  return out
}

/** A stored value (anything the host gives us) → a clean address, or null. */
export function coerceAddress(value: unknown): AddressValue | null {
  if (typeof value === 'string') {
    const s = value.trim()
    return s ? { formatted: s.slice(0, 500), street: null, city: null, region: null, postcode: null, country: null, country_code: null, lat: null, lng: null, place_id: null } : null
  }
  if (!isRec(value)) return null
  if (typeof value.formatted === 'string') {
    const pick = (k: string) => str(value[k])
    return {
      formatted: value.formatted.trim().slice(0, 500),
      street: pick('street'), city: pick('city'), region: pick('region'), postcode: pick('postcode'), country: pick('country'),
      country_code: pick('country_code'), lat: num(value.lat, 90), lng: num(value.lng, 180), place_id: str(value.place_id, 300),
    }
  }
  return addressFromItem({ fields: value })
}
