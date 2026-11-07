/**
 * Unit conversion tables. Each unit has a factor to its category's base unit
 * (metre, kilogram, litre, square metre, metre per second, byte, second);
 * temperature is converted through kelvin. US customary volumes are the US
 * liquid measures; `_uk` units are imperial.
 */

interface UnitDef { category: string; factor: number; names: string[] }

const U = (category: string, factor: number, ...names: string[]): UnitDef => ({ category, factor, names })

const UNITS: UnitDef[] = [
  // length (m)
  U('length', 1e-9, 'nm', 'nanometre', 'nanometer'),
  U('length', 1e-6, 'um', 'µm', 'micrometre', 'micrometer', 'micron'),
  U('length', 1e-3, 'mm', 'millimetre', 'millimeter'),
  U('length', 1e-2, 'cm', 'centimetre', 'centimeter'),
  U('length', 1, 'm', 'metre', 'meter'),
  U('length', 1e3, 'km', 'kilometre', 'kilometer'),
  U('length', 0.0254, 'in', 'inch', 'inches'),
  U('length', 0.3048, 'ft', 'foot', 'feet'),
  U('length', 0.9144, 'yd', 'yard', 'yards'),
  U('length', 1609.344, 'mi', 'mile', 'miles'),
  U('length', 1852, 'nmi', 'nautical_mile', 'nautical mile'),
  // mass (kg)
  U('mass', 1e-6, 'mg', 'milligram'),
  U('mass', 1e-3, 'g', 'gram'),
  U('mass', 1, 'kg', 'kilogram'),
  U('mass', 1000, 't', 'tonne', 'metric_ton'),
  U('mass', 0.028349523125, 'oz', 'ounce'),
  U('mass', 0.45359237, 'lb', 'lbs', 'pound'),
  U('mass', 6.35029318, 'st', 'stone'),
  U('mass', 907.18474, 'ton_us', 'short_ton'),
  U('mass', 1016.0469088, 'ton_uk', 'long_ton'),
  // volume (L)
  U('volume', 1e-3, 'ml', 'mL', 'millilitre', 'milliliter'),
  U('volume', 1e-2, 'cl', 'cL', 'centilitre', 'centiliter'),
  U('volume', 1, 'l', 'L', 'litre', 'liter'),
  U('volume', 1000, 'm3', 'm³', 'cubic_metre', 'cubic_meter'),
  U('volume', 0.001, 'cm3', 'cm³', 'cc'),
  U('volume', 0.00492892159375, 'tsp', 'teaspoon'),
  U('volume', 0.01478676478125, 'tbsp', 'tablespoon'),
  U('volume', 0.0295735295625, 'floz', 'fl_oz', 'fluid_ounce'),
  U('volume', 0.2365882365, 'cup'),
  U('volume', 0.473176473, 'pt', 'pint'),
  U('volume', 0.946352946, 'qt', 'quart'),
  U('volume', 3.785411784, 'gal', 'gallon'),
  U('volume', 0.56826125, 'pt_uk', 'imperial_pint'),
  U('volume', 4.54609, 'gal_uk', 'imperial_gallon'),
  U('volume', 0.016387064, 'in3', 'in³', 'cubic_inch'),
  U('volume', 28.316846592, 'ft3', 'ft³', 'cubic_foot'),
  // area (m²)
  U('area', 1e-6, 'mm2', 'mm²'),
  U('area', 1e-4, 'cm2', 'cm²'),
  U('area', 1, 'm2', 'm²', 'square_metre', 'square_meter', 'sqm'),
  U('area', 1e6, 'km2', 'km²', 'square_kilometre', 'square_kilometer'),
  U('area', 1e4, 'ha', 'hectare', 'hectares'),
  U('area', 4046.8564224, 'ac', 'acre', 'acres'),
  U('area', 0.00064516, 'in2', 'in²', 'square_inch'),
  U('area', 0.09290304, 'ft2', 'ft²', 'square_foot', 'square_feet', 'sqft'),
  U('area', 0.83612736, 'yd2', 'yd²', 'square_yard'),
  U('area', 2589988.110336, 'mi2', 'mi²', 'square_mile'),
  // speed (m/s)
  U('speed', 1, 'm/s', 'mps', 'metres_per_second', 'meters_per_second'),
  U('speed', 1000 / 3600, 'km/h', 'kph', 'kmh', 'kilometres_per_hour', 'kilometers_per_hour'),
  U('speed', 1609.344 / 3600, 'mph', 'mi/h', 'miles_per_hour'),
  U('speed', 1852 / 3600, 'kn', 'kt', 'knot', 'knots'),
  U('speed', 0.3048, 'ft/s', 'fps', 'feet_per_second'),
  // data size (byte)
  U('data', 1 / 8, 'bit', 'b'),
  U('data', 1, 'B', 'byte', 'bytes'),
  U('data', 1e3, 'kB', 'KB', 'kilobyte'),
  U('data', 1e6, 'MB', 'megabyte'),
  U('data', 1e9, 'GB', 'gigabyte'),
  U('data', 1e12, 'TB', 'terabyte'),
  U('data', 1e15, 'PB', 'petabyte'),
  U('data', 1024, 'KiB', 'kibibyte'),
  U('data', 1024 ** 2, 'MiB', 'mebibyte'),
  U('data', 1024 ** 3, 'GiB', 'gibibyte'),
  U('data', 1024 ** 4, 'TiB', 'tebibyte'),
  U('data', 1024 ** 5, 'PiB', 'pebibyte'),
  U('data', 1e3 / 8, 'kb', 'kbit', 'kilobit'),
  U('data', 1e6 / 8, 'Mb', 'Mbit', 'megabit'),
  U('data', 1e9 / 8, 'Gb', 'Gbit', 'gigabit'),
  // time (s)
  U('time', 1e-3, 'ms', 'millisecond', 'milliseconds'),
  U('time', 1, 's', 'sec', 'second', 'seconds'),
  U('time', 60, 'min', 'minute', 'minutes'),
  U('time', 3600, 'h', 'hr', 'hour', 'hours'),
  U('time', 86400, 'd', 'day', 'days'),
  U('time', 604800, 'wk', 'week', 'weeks'),
  U('time', 2629746, 'mo', 'month', 'months'),
  U('time', 31556952, 'yr', 'y', 'year', 'years'),
  // temperature (special)
  U('temperature', 1, 'C', '°C', 'celsius'),
  U('temperature', 1, 'F', '°F', 'fahrenheit'),
  U('temperature', 1, 'K', 'kelvin'),
]

const EXACT = new Map<string, UnitDef>()
const LOWER = new Map<string, UnitDef | null>()
for (const def of UNITS) {
  for (const name of def.names) {
    EXACT.set(name, def)
    const lower = name.toLowerCase()
    const existing = LOWER.get(lower)
    // A lowercase spelling shared by two units (mb: megabyte or megabit) is ambiguous.
    LOWER.set(lower, existing === undefined || existing === def ? def : null)
  }
}

export function findUnit(raw: string): UnitDef {
  const s = raw.trim().replace(/\s+/g, ' ')
  const lower = s.toLowerCase()
  const candidates = [s, s.replace(/ /g, '_')]
  for (const c of candidates) {
    const exact = EXACT.get(c)
    if (exact) return exact
  }
  const lowers = [lower, lower.replace(/ /g, '_'), ...(lower.length > 2 && lower.endsWith('s') ? [lower.slice(0, -1)] : [])]
  for (const c of lowers) {
    if (!LOWER.has(c)) continue
    const def = LOWER.get(c)
    if (def === null) throw new Error(`Unit "${raw}" is ambiguous: use the exact symbol (e.g. MB for megabytes, Mb for megabits)`)
    return def!
  }
  throw new Error(`Unknown unit "${raw}"`)
}

const toKelvin = (v: number, unit: string) => (unit === 'C' ? v + 273.15 : unit === 'F' ? (v - 32) * 5 / 9 + 273.15 : v)
const fromKelvin = (k: number, unit: string) => (unit === 'C' ? k - 273.15 : unit === 'F' ? (k - 273.15) * 9 / 5 + 32 : k)

export function convertUnits(value: number, fromRaw: string, toRaw: string): { result: number; category: string; from_unit: string; to_unit: string } {
  const from = findUnit(fromRaw)
  const to = findUnit(toRaw)
  if (from.category !== to.category) throw new Error(`Cannot convert ${from.category} (${from.names[0]}) to ${to.category} (${to.names[0]})`)
  let result: number
  if (from.category === 'temperature') {
    const k = toKelvin(value, from.names[0])
    if (k < -1e-9) throw new Error('The temperature is below absolute zero')
    result = fromKelvin(k, to.names[0])
  } else {
    result = value * from.factor / to.factor
  }
  return { result: Number(result.toPrecision(12)) || 0, category: from.category, from_unit: from.names[0], to_unit: to.names[0] }
}

export const UNIT_CATEGORIES = ['length', 'mass', 'volume', 'temperature', 'area', 'speed', 'data', 'time']
