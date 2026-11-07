/*! UserTasks action ut_math 1.0.0 */

// packages/action/src/index.ts
function defineAction(definition) {
  if (!definition || typeof definition !== "object" || !definition.operations || typeof definition.operations !== "object") {
    throw new Error("defineAction({ operations: { id: fn } })");
  }
  return definition;
}

// gallery/actions/shared/inputs.ts
var isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isBlank = (value) => value === void 0 || value === null || typeof value === "string" && value.trim() === "";
var show = (value) => {
  let s;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};
function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const s = value.trim().replace(/,(?=\d{3}(?:\D|$))/g, "").replace(/^\+/, "");
    if (s === "") return null;
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return NaN;
    return Number(s);
  }
  if (value === void 0 || value === null) return null;
  return NaN;
}
function optNum(inputs, name, opts = {}) {
  const raw = inputs[name];
  let n = isBlank(raw) ? null : toNumber(raw);
  if (n === null) n = opts.default ?? null;
  if (n === null) return null;
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${show(raw)}")`);
  if (opts.integer && !Number.isInteger(n)) throw new Error(`${name} must be a whole number (got ${n})`);
  if (opts.min !== void 0 && n < opts.min) throw new Error(`${name} must be at least ${opts.min} (got ${n})`);
  if (opts.max !== void 0 && n > opts.max) throw new Error(`${name} must be at most ${opts.max} (got ${n})`);
  return n;
}
function num(inputs, name, opts = {}) {
  const n = optNum(inputs, name, opts);
  if (n === null) throw new Error(`${name} is required`);
  return n;
}
function str(inputs, name, opts = {}) {
  const raw = inputs[name];
  let s;
  if (raw === void 0 || raw === null) s = opts.default ?? "";
  else if (typeof raw === "string") s = raw;
  else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
  else s = JSON.stringify(raw);
  if (opts.trim !== false) s = s.trim();
  if (s === "" && opts.default !== void 0 && raw !== "") s = opts.default;
  if (opts.required && s === "") throw new Error(`${name} is required`);
  if (opts.max !== void 0 && s.length > opts.max) throw new Error(`${name} is longer than ${opts.max} characters`);
  return s;
}
function choice(inputs, name, options, dflt) {
  const raw = inputs[name];
  if (isBlank(raw)) return dflt;
  const s = String(raw).trim();
  const hit = options.find((o) => o === s) ?? options.find((o) => o.toLowerCase() === s.toLowerCase());
  if (!hit) throw new Error(`${name} must be one of ${options.join(", ")} (got "${show(raw)}")`);
  return hit;
}
function list(inputs, name, opts = {}) {
  const raw = inputs[name];
  if (isBlank(raw)) {
    if (opts.required) throw new Error(`${name} is required (a list)`);
    return [];
  }
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed;
      } catch {
      }
      throw new Error(`${name} is not a valid JSON list`);
    }
    return s.split(/\r?\n|,/).map((p) => p.trim()).filter(Boolean);
  }
  throw new Error(`${name} must be a list (got ${typeof raw})`);
}
function obj(inputs, name, opts = {}) {
  const raw = inputs[name];
  if (isBlank(raw)) {
    if (opts.required) throw new Error(`${name} is required (an object)`);
    return {};
  }
  if (isPlainObject(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (isPlainObject(parsed)) return parsed;
    } catch {
    }
  }
  throw new Error(`${name} must be an object`);
}
function clean(n, digits = 15) {
  if (!Number.isFinite(n) || n === 0) return n === 0 ? 0 : n;
  const r = Number(n.toPrecision(digits));
  return r === 0 ? 0 : r;
}
function getPath(source, path) {
  if (!path) return source;
  if (isPlainObject(source) && Object.prototype.hasOwnProperty.call(source, path)) return source[path];
  let cur = source;
  for (const part of splitPath(path)) {
    if (cur === null || cur === void 0) return void 0;
    if (typeof part === "number") {
      if (!Array.isArray(cur)) return void 0;
      cur = cur[part < 0 ? cur.length + part : part];
    } else if (isPlainObject(cur) || Array.isArray(cur)) {
      cur = Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : void 0;
    } else {
      return void 0;
    }
  }
  return cur;
}
function splitPath(path) {
  const out = [];
  const re = /([^.[\]]+)|\[(-?\d+)\]|\[(?:"([^"]*)"|'([^']*)')\]/g;
  let m;
  while (m = re.exec(path)) {
    if (m[1] !== void 0) out.push(m[1]);
    else if (m[2] !== void 0) out.push(Number(m[2]));
    else out.push(m[3] ?? m[4] ?? "");
  }
  return out;
}

// gallery/actions/math-statistics/src/expression.ts
var MAX_LENGTH = 4e3;
var MAX_DEPTH = 64;
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const numMatch = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (numMatch) {
      tokens.push({ t: "num", v: Number(numMatch[0]), at: i });
      i += numMatch[0].length;
      continue;
    }
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i));
    if (nameMatch) {
      tokens.push({ t: "name", v: nameMatch[0], at: i });
      i += nameMatch[0].length;
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      tokens.push({ t: "op", v: ch, at: i });
      i++;
      continue;
    }
    if (ch === "×" || ch === "÷" || ch === "−") {
      tokens.push({ t: "op", v: ch === "×" ? "*" : ch === "÷" ? "/" : "-", at: i });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at position ${i + 1}`);
  }
  return tokens;
}
var FUNCTIONS = {
  abs: { min: 1, max: 1, fn: Math.abs },
  floor: { min: 1, max: 1, fn: Math.floor },
  ceil: { min: 1, max: 1, fn: Math.ceil },
  sqrt: {
    min: 1,
    max: 1,
    fn: (x) => {
      if (x < 0) throw new Error("sqrt of a negative number");
      return Math.sqrt(x);
    }
  },
  round: {
    min: 1,
    max: 2,
    fn: (x, d = 0) => {
      if (!Number.isInteger(d)) throw new Error("round(x, decimals): decimals must be a whole number");
      const f = Math.pow(10, d);
      const v = Math.abs(x) * f;
      return Math.sign(x) * Math.round(Number(v.toPrecision(15))) / f;
    }
  },
  min: { min: 1, max: 100, fn: (...a) => Math.min(...a) },
  max: { min: 1, max: 100, fn: (...a) => Math.max(...a) },
  pow: { min: 2, max: 2, fn: (a, b) => Math.pow(a, b) },
  log: {
    min: 1,
    max: 2,
    fn: (x, base = 10) => {
      if (x <= 0) throw new Error("log of zero or a negative number");
      if (base <= 0 || base === 1) throw new Error("log base must be positive and not 1");
      return base === 10 ? Math.log10(x) : Math.log(x) / Math.log(base);
    }
  },
  ln: {
    min: 1,
    max: 1,
    fn: (x) => {
      if (x <= 0) throw new Error("ln of zero or a negative number");
      return Math.log(x);
    }
  },
  exp: { min: 1, max: 1, fn: Math.exp },
  sin: { min: 1, max: 1, fn: Math.sin },
  cos: { min: 1, max: 1, fn: Math.cos },
  tan: { min: 1, max: 1, fn: Math.tan }
};
var CONSTANTS = { pi: Math.PI, e: Math.E };
function evaluateExpression(expression, variables) {
  if (expression.length > MAX_LENGTH) throw new Error(`expression is longer than ${MAX_LENGTH} characters`);
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error("expression is empty");
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek()?.t === "op" && peek().v === v;
  const where = () => peek() ? `at position ${peek().at + 1}` : "at the end";
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`Expected "${v}" ${where()}`);
    pos++;
  };
  const enter = () => {
    if (++depth > MAX_DEPTH) throw new Error("expression is nested too deeply");
  };
  const variable = (name) => {
    let raw = getPath(variables, name);
    if (raw === void 0) {
      const lower = name.toLowerCase();
      if (lower in CONSTANTS) return CONSTANTS[lower];
      throw new Error(`Unknown variable "${name}"`);
    }
    if (raw === null || raw === "") throw new Error(`Variable "${name}" is empty`);
    if (typeof raw === "boolean") raw = raw ? 1 : 0;
    const n = toNumber(raw);
    if (n === null || !Number.isFinite(n)) throw new Error(`Variable "${name}" is not a number`);
    return n;
  };
  function additive() {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].v;
      const right = term();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function term() {
    let left = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = tokens[pos++].v;
      const right = unary();
      if ((op === "/" || op === "%") && right === 0) throw new Error("Division by zero");
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  }
  function unary() {
    if (isOp("-") || isOp("+")) {
      const op = tokens[pos++].v;
      enter();
      const v = unary();
      depth--;
      return op === "-" ? -v : v;
    }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp("^")) {
      pos++;
      enter();
      const exponent = unary();
      depth--;
      return Math.pow(base, exponent);
    }
    return base;
  }
  function primary() {
    const tok = peek();
    if (!tok) throw new Error("expression ended unexpectedly");
    if (tok.t === "num") {
      pos++;
      return tok.v;
    }
    if (tok.t === "name") {
      pos++;
      if (isOp("(")) {
        const fname = tok.v.toLowerCase();
        const spec = FUNCTIONS[fname];
        if (!spec) throw new Error(`Unknown function "${tok.v}" (use ${Object.keys(FUNCTIONS).join(", ")})`);
        pos++;
        enter();
        const args = [];
        if (!isOp(")")) {
          args.push(additive());
          while (isOp(",")) {
            pos++;
            args.push(additive());
          }
        }
        expect(")");
        depth--;
        if (args.length < spec.min || args.length > spec.max) {
          throw new Error(`${fname}() takes ${spec.min === spec.max ? spec.min : `${spec.min} to ${spec.max}`} argument${spec.max === 1 ? "" : "s"}`);
        }
        return spec.fn(...args);
      }
      return variable(tok.v);
    }
    if (tok.v === "(") {
      pos++;
      enter();
      const v = additive();
      expect(")");
      depth--;
      return v;
    }
    throw new Error(`Unexpected "${tok.v}" ${where()}`);
  }
  const result = additive();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].t === "num" ? String(tokens[pos].v) : tokens[pos].v}" ${where()}`);
  if (!Number.isFinite(result)) throw new Error("The result is not a finite number");
  return result;
}

// gallery/actions/math-statistics/src/units.ts
var U = (category, factor, ...names) => ({ category, factor, names });
var UNITS = [
  // length (m)
  U("length", 1e-9, "nm", "nanometre", "nanometer"),
  U("length", 1e-6, "um", "µm", "micrometre", "micrometer", "micron"),
  U("length", 1e-3, "mm", "millimetre", "millimeter"),
  U("length", 0.01, "cm", "centimetre", "centimeter"),
  U("length", 1, "m", "metre", "meter"),
  U("length", 1e3, "km", "kilometre", "kilometer"),
  U("length", 0.0254, "in", "inch", "inches"),
  U("length", 0.3048, "ft", "foot", "feet"),
  U("length", 0.9144, "yd", "yard", "yards"),
  U("length", 1609.344, "mi", "mile", "miles"),
  U("length", 1852, "nmi", "nautical_mile", "nautical mile"),
  // mass (kg)
  U("mass", 1e-6, "mg", "milligram"),
  U("mass", 1e-3, "g", "gram"),
  U("mass", 1, "kg", "kilogram"),
  U("mass", 1e3, "t", "tonne", "metric_ton"),
  U("mass", 0.028349523125, "oz", "ounce"),
  U("mass", 0.45359237, "lb", "lbs", "pound"),
  U("mass", 6.35029318, "st", "stone"),
  U("mass", 907.18474, "ton_us", "short_ton"),
  U("mass", 1016.0469088, "ton_uk", "long_ton"),
  // volume (L)
  U("volume", 1e-3, "ml", "mL", "millilitre", "milliliter"),
  U("volume", 0.01, "cl", "cL", "centilitre", "centiliter"),
  U("volume", 1, "l", "L", "litre", "liter"),
  U("volume", 1e3, "m3", "m³", "cubic_metre", "cubic_meter"),
  U("volume", 1e-3, "cm3", "cm³", "cc"),
  U("volume", 0.00492892159375, "tsp", "teaspoon"),
  U("volume", 0.01478676478125, "tbsp", "tablespoon"),
  U("volume", 0.0295735295625, "floz", "fl_oz", "fluid_ounce"),
  U("volume", 0.2365882365, "cup"),
  U("volume", 0.473176473, "pt", "pint"),
  U("volume", 0.946352946, "qt", "quart"),
  U("volume", 3.785411784, "gal", "gallon"),
  U("volume", 0.56826125, "pt_uk", "imperial_pint"),
  U("volume", 4.54609, "gal_uk", "imperial_gallon"),
  U("volume", 0.016387064, "in3", "in³", "cubic_inch"),
  U("volume", 28.316846592, "ft3", "ft³", "cubic_foot"),
  // area (m²)
  U("area", 1e-6, "mm2", "mm²"),
  U("area", 1e-4, "cm2", "cm²"),
  U("area", 1, "m2", "m²", "square_metre", "square_meter", "sqm"),
  U("area", 1e6, "km2", "km²", "square_kilometre", "square_kilometer"),
  U("area", 1e4, "ha", "hectare", "hectares"),
  U("area", 4046.8564224, "ac", "acre", "acres"),
  U("area", 64516e-8, "in2", "in²", "square_inch"),
  U("area", 0.09290304, "ft2", "ft²", "square_foot", "square_feet", "sqft"),
  U("area", 0.83612736, "yd2", "yd²", "square_yard"),
  U("area", 2589988110336e-6, "mi2", "mi²", "square_mile"),
  // speed (m/s)
  U("speed", 1, "m/s", "mps", "metres_per_second", "meters_per_second"),
  U("speed", 1e3 / 3600, "km/h", "kph", "kmh", "kilometres_per_hour", "kilometers_per_hour"),
  U("speed", 1609.344 / 3600, "mph", "mi/h", "miles_per_hour"),
  U("speed", 1852 / 3600, "kn", "kt", "knot", "knots"),
  U("speed", 0.3048, "ft/s", "fps", "feet_per_second"),
  // data size (byte)
  U("data", 1 / 8, "bit", "b"),
  U("data", 1, "B", "byte", "bytes"),
  U("data", 1e3, "kB", "KB", "kilobyte"),
  U("data", 1e6, "MB", "megabyte"),
  U("data", 1e9, "GB", "gigabyte"),
  U("data", 1e12, "TB", "terabyte"),
  U("data", 1e15, "PB", "petabyte"),
  U("data", 1024, "KiB", "kibibyte"),
  U("data", 1024 ** 2, "MiB", "mebibyte"),
  U("data", 1024 ** 3, "GiB", "gibibyte"),
  U("data", 1024 ** 4, "TiB", "tebibyte"),
  U("data", 1024 ** 5, "PiB", "pebibyte"),
  U("data", 1e3 / 8, "kb", "kbit", "kilobit"),
  U("data", 1e6 / 8, "Mb", "Mbit", "megabit"),
  U("data", 1e9 / 8, "Gb", "Gbit", "gigabit"),
  // time (s)
  U("time", 1e-3, "ms", "millisecond", "milliseconds"),
  U("time", 1, "s", "sec", "second", "seconds"),
  U("time", 60, "min", "minute", "minutes"),
  U("time", 3600, "h", "hr", "hour", "hours"),
  U("time", 86400, "d", "day", "days"),
  U("time", 604800, "wk", "week", "weeks"),
  U("time", 2629746, "mo", "month", "months"),
  U("time", 31556952, "yr", "y", "year", "years"),
  // temperature (special)
  U("temperature", 1, "C", "°C", "celsius"),
  U("temperature", 1, "F", "°F", "fahrenheit"),
  U("temperature", 1, "K", "kelvin")
];
var EXACT = /* @__PURE__ */ new Map();
var LOWER = /* @__PURE__ */ new Map();
for (const def of UNITS) {
  for (const name of def.names) {
    EXACT.set(name, def);
    const lower = name.toLowerCase();
    const existing = LOWER.get(lower);
    LOWER.set(lower, existing === void 0 || existing === def ? def : null);
  }
}
function findUnit(raw) {
  const s = raw.trim().replace(/\s+/g, " ");
  const lower = s.toLowerCase();
  const candidates = [s, s.replace(/ /g, "_")];
  for (const c of candidates) {
    const exact = EXACT.get(c);
    if (exact) return exact;
  }
  const lowers = [lower, lower.replace(/ /g, "_"), ...lower.length > 2 && lower.endsWith("s") ? [lower.slice(0, -1)] : []];
  for (const c of lowers) {
    if (!LOWER.has(c)) continue;
    const def = LOWER.get(c);
    if (def === null) throw new Error(`Unit "${raw}" is ambiguous: use the exact symbol (e.g. MB for megabytes, Mb for megabits)`);
    return def;
  }
  throw new Error(`Unknown unit "${raw}"`);
}
var toKelvin = (v, unit) => unit === "C" ? v + 273.15 : unit === "F" ? (v - 32) * 5 / 9 + 273.15 : v;
var fromKelvin = (k, unit) => unit === "C" ? k - 273.15 : unit === "F" ? (k - 273.15) * 9 / 5 + 32 : k;
function convertUnits(value, fromRaw, toRaw) {
  const from = findUnit(fromRaw);
  const to = findUnit(toRaw);
  if (from.category !== to.category) throw new Error(`Cannot convert ${from.category} (${from.names[0]}) to ${to.category} (${to.names[0]})`);
  let result;
  if (from.category === "temperature") {
    const k = toKelvin(value, from.names[0]);
    if (k < -1e-9) throw new Error("The temperature is below absolute zero");
    result = fromKelvin(k, to.names[0]);
  } else {
    result = value * from.factor / to.factor;
  }
  return { result: Number(result.toPrecision(12)) || 0, category: from.category, from_unit: from.names[0], to_unit: to.names[0] };
}

// gallery/actions/math-statistics/src/action.ts
var ROUND_MODES = ["half_up", "half_even", "up", "down", "floor", "ceil"];
function shift(x, d) {
  const [mantissa, exponent] = String(x).split("e");
  return Number(`${mantissa}e${Number(exponent ?? 0) + d}`);
}
function roundTo(value, decimals, mode = "half_up") {
  const v = Number(value.toPrecision(15));
  const s = shift(Math.abs(v), decimals);
  const sign = v < 0 ? -1 : 1;
  const fl = Math.floor(s);
  const frac = s - fl;
  let r;
  switch (mode) {
    case "half_up":
      r = frac >= 0.5 ? fl + 1 : fl;
      break;
    case "half_even":
      r = frac > 0.5 ? fl + 1 : frac < 0.5 ? fl : fl % 2 === 0 ? fl : fl + 1;
      break;
    case "up":
      r = frac > 0 ? fl + 1 : fl;
      break;
    case "down":
      r = fl;
      break;
    case "floor":
      r = sign < 0 ? frac > 0 ? fl + 1 : fl : fl;
      break;
    case "ceil":
      r = sign < 0 ? fl : frac > 0 ? fl + 1 : fl;
      break;
  }
  const out = shift(sign * r, -decimals);
  return out === 0 ? 0 : out;
}
var money = (n) => roundTo(n, 2, "half_up");
function numbersOf(inputs) {
  const values = list(inputs, "values", { required: true });
  const field = str(inputs, "field");
  const out = [];
  values.forEach((item, index) => {
    let raw = item;
    if (field) {
      if (!isPlainObject(item)) throw new Error(`values[${index}] is not an object (field "${field}" was given)`);
      raw = getPath(item, field);
    } else if (isPlainObject(item)) {
      throw new Error(`values[${index}] is an object: set field to the property holding the number`);
    }
    if (isBlank(raw)) return;
    const n = toNumber(raw);
    if (n === null || !Number.isFinite(n)) throw new Error(`values[${index}]${field ? `.${field}` : ""} is not a number ("${String(raw).slice(0, 30)}")`);
    out.push(n);
  });
  return out;
}
function sum(values) {
  let s = 0;
  let c = 0;
  for (const v of values) {
    const t = s + v;
    c += Math.abs(s) >= Math.abs(v) ? s - t + v : v - t + s;
    s = t;
  }
  return s + c;
}
function percentileOf(sorted, p) {
  if (sorted.length === 1) return sorted[0];
  const rank = p / 100 * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
function parseDate(raw, name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) throw new Error(`${name} must be a date (YYYY-MM-DD)`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new Error(`${name} is not a real date (${raw.slice(0, 10)})`);
  return { y, m: mo, d };
}
function addMonths(start, months) {
  const total = start.y * 12 + (start.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(start.d, last);
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
var action_default = defineAction({
  operations: {
    evaluate(inputs) {
      const expression = str(inputs, "expression", { required: true });
      const variables = obj(inputs, "variables");
      const decimals = optNum(inputs, "decimals", { integer: true, min: 0, max: 15 });
      let result = clean(evaluateExpression(expression, variables));
      if (decimals !== null) result = roundTo(result, decimals);
      return { result };
    },
    round(inputs) {
      const value = num(inputs, "value");
      const decimals = optNum(inputs, "decimals", { integer: true, min: -15, max: 15, default: 0 });
      const mode = choice(inputs, "mode", ROUND_MODES, "half_up");
      return { result: roundTo(value, decimals, mode) };
    },
    stats(inputs) {
      const values = numbersOf(inputs);
      const kind = choice(inputs, "variance_type", ["sample", "population"], "sample");
      const n = values.length;
      if (n === 0) {
        return { count: 0, sum: 0, mean: null, min: null, max: null, median: null, mode: null, variance: null, stddev: null, range: null };
      }
      const sorted = [...values].sort((a, b) => a - b);
      const total = sum(values);
      const mean = total / n;
      const squares = sum(values.map((v) => (v - mean) ** 2));
      const variance = kind === "population" ? squares / n : n > 1 ? squares / (n - 1) : null;
      const counts = /* @__PURE__ */ new Map();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      let mode = null;
      let best = 1;
      for (const v of sorted) {
        const c = counts.get(v);
        if (c > best) {
          best = c;
          mode = v;
        }
      }
      return {
        count: n,
        sum: clean(total),
        mean: clean(mean),
        min: sorted[0],
        max: sorted[n - 1],
        median: clean(percentileOf(sorted, 50)),
        mode,
        variance: variance === null ? null : clean(variance),
        stddev: variance === null ? null : clean(Math.sqrt(variance)),
        range: clean(sorted[n - 1] - sorted[0])
      };
    },
    percentile(inputs) {
      const values = numbersOf(inputs);
      const p = num(inputs, "p", { min: 0, max: 100 });
      if (values.length === 0) throw new Error("values has no numbers");
      const sorted = [...values].sort((a, b) => a - b);
      return { value: clean(percentileOf(sorted, p)), count: values.length };
    },
    compound_interest(inputs) {
      const principal = num(inputs, "principal", { min: 0, default: 0 });
      const annualRate = num(inputs, "annual_rate", { min: -100, max: 1e3 });
      const years = num(inputs, "years", { integer: true, min: 1, max: 100 });
      const perYear = num(inputs, "compounds_per_year", { integer: true, min: 1, max: 365, default: 12 });
      const contribution = num(inputs, "contribution", { default: 0 });
      const timing = choice(inputs, "contribution_timing", ["end", "start"], "end");
      const r = annualRate / 100 / perYear;
      let balance = principal;
      let contributed = principal;
      const schedule = [];
      for (let year = 1; year <= years; year++) {
        let yearContrib = 0;
        let yearInterest = 0;
        for (let k = 0; k < perYear; k++) {
          if (timing === "start") {
            balance += contribution;
            yearContrib += contribution;
          }
          const interest = balance * r;
          balance += interest;
          yearInterest += interest;
          if (timing === "end") {
            balance += contribution;
            yearContrib += contribution;
          }
        }
        contributed += yearContrib;
        schedule.push({ year, contributions: money(yearContrib), interest: money(yearInterest), balance: money(balance) });
      }
      const futureValue = money(balance);
      return {
        future_value: futureValue,
        total_contributions: money(contributed),
        interest_earned: money(futureValue - contributed),
        schedule
      };
    },
    loan_schedule(inputs) {
      const principal = num(inputs, "principal", { min: 0.01 });
      const annualRate = num(inputs, "annual_rate", { min: 0, max: 100 });
      const n = num(inputs, "term_months", { integer: true, min: 1, max: 600 });
      const extra = num(inputs, "extra_payment", { min: 0, default: 0 });
      const startRaw = str(inputs, "start_date");
      const start = startRaw ? parseDate(startRaw, "start_date") : null;
      const r = annualRate / 100 / 12;
      const payment = money(r === 0 ? principal / n : principal * r / (1 - Math.pow(1 + r, -n)));
      const paymentC = Math.round(payment * 100);
      const extraC = Math.round(extra * 100);
      let balanceC = Math.round(principal * 100);
      let interestTotalC = 0;
      let paidTotalC = 0;
      const schedule = [];
      for (let period = 1; period <= n && balanceC > 0; period++) {
        const interestC = Math.round(balanceC * r);
        let principalC = paymentC - interestC + extraC;
        if (principalC >= balanceC || period === n) principalC = balanceC;
        if (principalC < 0) throw new Error("The payment does not cover the interest");
        const payC = principalC + interestC;
        balanceC -= principalC;
        interestTotalC += interestC;
        paidTotalC += payC;
        schedule.push({
          period,
          date: start ? addMonths(start, period - 1) : null,
          payment: payC / 100,
          principal: principalC / 100,
          interest: interestC / 100,
          balance: balanceC / 100
        });
      }
      const last = schedule[schedule.length - 1];
      return {
        payment,
        total_interest: interestTotalC / 100,
        total_paid: paidTotalC / 100,
        number_of_payments: schedule.length,
        payoff_date: last?.date ?? null,
        schedule
      };
    },
    convert_units(inputs) {
      const value = num(inputs, "value");
      const from = str(inputs, "from", { required: true });
      const to = str(inputs, "to", { required: true });
      return convertUnits(value, from, to);
    }
  }
});
export {
  action_default as default
};
