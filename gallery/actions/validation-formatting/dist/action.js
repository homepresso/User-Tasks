/*! UserTasks action ut_validate 1.0.0 */

// packages/action/src/index.ts
function defineAction(definition) {
  if (!definition || typeof definition !== "object" || !definition.operations || typeof definition.operations !== "object") {
    throw new Error("defineAction({ operations: { id: fn } })");
  }
  return definition;
}

// lib/documents/pii/validators.ts
var digitsOf = (s) => s.replace(/\D/g, "");
var allSame = (d) => /^(\d)\1*$/.test(d);
function luhn(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
function ibanValid(raw) {
  const s = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}
function cardIssuer(raw) {
  const d = digitsOf(raw);
  if (d.length < 12 || d.length > 19 || !luhn(d) || allSame(d)) return null;
  const n = d.length;
  const p2 = Number(d.slice(0, 2));
  const p3 = Number(d.slice(0, 3));
  const p4 = Number(d.slice(0, 4));
  const p6 = Number(d.slice(0, 6));
  if (d[0] === "4" && (n === 13 || n === 16 || n === 19)) return "visa";
  if ((p2 >= 51 && p2 <= 55 || p6 >= 222100 && p6 <= 272099) && n === 16) return "mastercard";
  if ((p2 === 34 || p2 === 37) && n === 15) return "amex";
  if ((p4 === 6011 || p2 === 65 || p3 >= 644 && p3 <= 649) && n >= 16 && n <= 19) return "discover";
  if (p4 >= 3528 && p4 <= 3589 && n >= 16 && n <= 19) return "jcb";
  if ((p3 >= 300 && p3 <= 305 || p2 === 36 || p2 === 38 || p2 === 39) && n >= 14 && n <= 19) return "diners";
  if (p2 === 62 && n >= 16 && n <= 19) return "unionpay";
  if ((p2 === 50 || p2 >= 56 && p2 <= 69) && n >= 12 && n <= 19) return "maestro";
  return null;
}
function usSsnValid(raw) {
  const d = digitsOf(raw);
  if (d.length !== 9 || allSame(d)) return false;
  const area = Number(d.slice(0, 3));
  if (area === 0 || area === 666 || area >= 900) return false;
  if (d.slice(3, 5) === "00" || d.slice(5) === "0000") return false;
  return d !== "123456789" && d !== "987654321";
}
function ukNinoValid(raw) {
  const s = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(s)) return false;
  return !["BG", "GB", "KN", "NK", "NT", "TN", "ZZ"].includes(s.slice(0, 2));
}
function caSinValid(raw) {
  const d = digitsOf(raw);
  return d.length === 9 && d[0] !== "0" && d[0] !== "8" && !allSame(d) && luhn(d);
}
function auTfnValid(raw) {
  const d = digitsOf(raw);
  if (allSame(d)) return false;
  const w = d.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : d.length === 8 ? [10, 7, 8, 4, 6, 3, 5, 1] : null;
  if (!w) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) sum += Number(d[i]) * w[i];
  return sum % 11 === 0;
}
function nzIrdValid(raw) {
  const d = digitsOf(raw);
  if (d.length !== 8 && d.length !== 9) return false;
  const n = Number(d);
  if (n < 1e7 || n > 15e7) return false;
  const padded = d.padStart(9, "0");
  const base = padded.slice(0, 8);
  const given = Number(padded[8]);
  const calc = (w) => {
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += Number(base[i]) * w[i];
    const rem = sum % 11;
    return rem === 0 ? 0 : 11 - rem;
  };
  let check = calc([3, 2, 7, 6, 5, 4, 3, 2]);
  if (check === 10) check = calc([7, 4, 3, 2, 5, 2, 7, 6]);
  return check !== 10 && check === given;
}
var NHI_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ";
var nhiValue = (ch) => /\d/.test(ch) ? Number(ch) : NHI_ALPHA.indexOf(ch) + 1;
function nzNhiValid(raw) {
  const s = raw.toUpperCase();
  const weights = [7, 6, 5, 4, 3, 2];
  if (/^[A-HJ-NP-Z]{3}\d{4}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += nhiValue(s[i]) * weights[i];
    const rem = sum % 11;
    if (rem === 0) return false;
    const check = (11 - rem) % 10;
    return check === Number(s[6]);
  }
  if (/^[A-HJ-NP-Z]{3}\d{2}[A-HJ-NP-Z]{2}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += nhiValue(s[i]) * weights[i];
    const rem = sum % 23;
    if (rem === 0) return false;
    return NHI_ALPHA[23 - rem - 1] === s[6];
  }
  return false;
}
function deTaxIdValid(raw) {
  const d = digitsOf(raw);
  if (d.length !== 11 || d[0] === "0") return false;
  const counts = /* @__PURE__ */ new Map();
  for (const ch of d.slice(0, 10)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const repeated = [...counts.values()].filter((c) => c > 1);
  if (repeated.length !== 1 || repeated[0] > 3) return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (Number(d[i]) + product) % 10;
    if (sum === 0) sum = 10;
    product = sum * 2 % 11;
  }
  let check = 11 - product;
  if (check === 10) check = 0;
  return check === Number(d[10]);
}
function frNirValid(raw) {
  const s = raw.replace(/[\s.-]/g, "").toUpperCase();
  const m = /^([12])(\d{2})(0[1-9]|1[0-2]|[2-9]\d)(\d{2}|2A|2B)(\d{3})(\d{3})(\d{2})$/.exec(s);
  if (!m) return false;
  const body = (m[1] + m[2] + m[3] + m[4] + m[5] + m[6]).replace("2A", "19").replace("2B", "18");
  const key = 97 - Number(BigInt(body) % BigInt(97));
  return key === Number(m[7]);
}
var DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
function esDniValid(raw) {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(s);
  if (!m) return false;
  if (m[1] && m[2].length !== 7) return false;
  if (!m[1] && m[2].length !== 8) return false;
  const n = Number((m[1] ? String("XYZ".indexOf(m[1])) : "") + m[2]);
  return DNI_LETTERS[n % 23] === m[3];
}
var CF_ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
function itFiscalCodeValid(raw) {
  const s = raw.toUpperCase();
  if (!/^[A-Z]{6}[\dLMNP-V]{2}[A-EHLMPR-T][\dLMNP-V]{2}[A-Z][\dLMNP-V]{3}[A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = s[i];
    sum += i % 2 === 0 ? CF_ODD[ch] : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + sum % 26) === s[15];
}
function nlBsnValid(raw) {
  const d = digitsOf(raw);
  if (d.length !== 9 || allSame(d)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * (9 - i);
  sum -= Number(d[8]);
  return sum % 11 === 0 && sum !== 0;
}
var V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
];
var V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
];
function verhoeff(digits) {
  let c = 0;
  const r = digits.split("").reverse();
  for (let i = 0; i < r.length; i++) c = V_D[c][V_P[i % 8][Number(r[i])]];
  return c === 0;
}
function aadhaarValid(raw) {
  const d = digitsOf(raw);
  return d.length === 12 && /^[2-9]/.test(d) && !allSame(d) && verhoeff(d);
}
function sgNricValid(raw) {
  const s = raw.toUpperCase();
  const m = /^([STFGM])(\d{7})([A-Z])$/.exec(s);
  if (!m) return false;
  if (m[1] === "M") return true;
  const w = [2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(m[2][i]) * w[i];
  if (m[1] === "T" || m[1] === "G") sum += 4;
  const table = m[1] === "S" || m[1] === "T" ? "JZIHGFEDCBA" : "XWUTRQPNMLK";
  return table[sum % 11] === m[3];
}
var ISO_COUNTRIES = new Set("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(" "));
function bicValid(raw) {
  const s = raw.toUpperCase();
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(s) && ISO_COUNTRIES.has(s.slice(4, 6));
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
function bool(inputs, name, dflt) {
  const raw = inputs[name];
  if (isBlank(raw)) return dflt;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (["true", "yes", "1", "on", "y"].includes(s)) return true;
  if (["false", "no", "0", "off", "n"].includes(s)) return false;
  throw new Error(`${name} must be true or false (got "${show(raw)}")`);
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

// gallery/actions/validation-formatting/src/tables.ts
var IBAN_LENGTHS = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20
};
var spaceBefore = (n) => (s) => `${s.slice(0, s.length - n)} ${s.slice(s.length - n)}`;
var dashAt = (i) => (s) => `${s.slice(0, i)}-${s.slice(i)}`;
var POSTCODES = {
  US: { re: /^\d{5}(\d{4})?$/, format: (s) => s.length === 9 ? dashAt(5)(s) : s, example: "94105 or 94105-1234" },
  GB: { re: /^(GIR0AA|[A-PR-UWYZ](\d[A-HJKPSTUW]?|\d\d|[A-HK-Y]\d[ABEHMNPRV-Y]?|[A-HK-Y]\d\d)\d[ABD-HJLNP-UW-Z]{2})$/, format: spaceBefore(3), example: "SW1A 1AA" },
  CA: { re: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/, format: spaceBefore(3), example: "K1A 0B1" },
  AU: { re: /^(0[289]\d{2}|[1-9]\d{3})$/, example: "2000" },
  NZ: { re: /^\d{4}$/, example: "6011" },
  DE: { re: /^(0[1-9]|[1-9]\d)\d{3}$/, example: "10115" },
  FR: { re: /^(0[1-9]|[1-8]\d|9[0-8])\d{3}$/, example: "75008" },
  NL: { re: /^[1-9]\d{3}(?!SA|SD|SS)[A-Z]{2}$/, format: spaceBefore(2), example: "1012 AB" },
  BE: { re: /^[1-9]\d{3}$/, example: "1000" },
  AT: { re: /^[1-9]\d{3}$/, example: "1010" },
  CH: { re: /^[1-9]\d{3}$/, example: "8001" },
  IE: { re: /^[AC-FHKNPRTV-Y]\d{2}[0-9AC-FHKNPRTV-Y]{4}$|^D6W[0-9AC-FHKNPRTV-Y]{4}$/, format: (s) => `${s.slice(0, 3)} ${s.slice(3)}`, example: "D02 X285" },
  ES: { re: /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/, example: "28013" },
  IT: { re: /^\d{5}$/, example: "00184" },
  PT: { re: /^[1-9]\d{6}$/, format: dashAt(4), example: "1000-001" },
  SE: { re: /^[1-9]\d{4}$/, format: spaceBefore(2), example: "114 55" },
  NO: { re: /^\d{4}$/, example: "0150" },
  DK: { re: /^[1-9]\d{3}$/, example: "1050" },
  FI: { re: /^\d{5}$/, example: "00100" },
  PL: { re: /^\d{5}$/, format: dashAt(2), example: "00-950" },
  JP: { re: /^\d{7}$/, format: dashAt(3), example: "100-0001" },
  IN: { re: /^[1-9]\d{5}$/, example: "110001" },
  SG: { re: /^\d{6}$/, example: "018956" },
  BR: { re: /^\d{8}$/, format: dashAt(5), example: "01310-100" },
  MX: { re: /^\d{5}$/, example: "06500" },
  ZA: { re: /^\d{4}$/, example: "8001" }
};
var CALLING_CODES = {
  US: "1",
  CA: "1",
  GB: "44",
  IE: "353",
  AU: "61",
  NZ: "64",
  DE: "49",
  FR: "33",
  NL: "31",
  BE: "32",
  LU: "352",
  AT: "43",
  CH: "41",
  IT: "39",
  ES: "34",
  PT: "351",
  SE: "46",
  NO: "47",
  DK: "45",
  FI: "358",
  IS: "354",
  PL: "48",
  CZ: "420",
  SK: "421",
  HU: "36",
  RO: "40",
  BG: "359",
  GR: "30",
  TR: "90",
  IL: "972",
  AE: "971",
  SA: "966",
  QA: "974",
  EG: "20",
  ZA: "27",
  NG: "234",
  KE: "254",
  IN: "91",
  PK: "92",
  BD: "880",
  LK: "94",
  SG: "65",
  MY: "60",
  TH: "66",
  VN: "84",
  PH: "63",
  ID: "62",
  CN: "86",
  HK: "852",
  TW: "886",
  JP: "81",
  KR: "82",
  MX: "52",
  BR: "55",
  AR: "54",
  CL: "56",
  CO: "57",
  PE: "51",
  UA: "380",
  RU: "7",
  FJ: "679"
};
var NO_TRUNK_PREFIX = /* @__PURE__ */ new Set(["1", "39", "34", "351", "30", "45", "47", "352", "354", "420", "421", "852", "65", "974", "966", "971", "7"]);
var ALL_CODES = new Set(Object.values(CALLING_CODES));
function splitCallingCode(digits) {
  for (const len of [1, 2, 3]) {
    const code = digits.slice(0, len);
    if (ALL_CODES.has(code)) return { code, national: digits.slice(len) };
  }
  return null;
}
function countriesForCode(code) {
  return Object.entries(CALLING_CODES).filter(([, c]) => c === code).map(([iso]) => iso);
}

// gallery/actions/validation-formatting/src/action.ts
var ok = (normalized, details = {}) => ({ valid: true, normalized, reason: "", details });
var bad = (reason, normalized = "", details = {}) => ({ valid: false, normalized, reason, details });
var TYPES = ["iban", "bic", "card", "email", "phone", "postcode", "national_id"];
var ID_TYPES = ["us_ssn", "uk_nino", "ca_sin", "au_tfn", "nz_ird", "nz_nhi", "de_tax_id", "fr_nir", "es_dni", "it_fiscal_code", "nl_bsn", "in_aadhaar", "sg_nric"];
function validateIban(raw) {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return bad("An IBAN starts with a 2-letter country code and 2 check digits, then letters and digits", s);
  const country = s.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (!expected) return bad(`${country} does not use IBANs (or is not a known IBAN country)`, s);
  if (s.length !== expected) return bad(`A ${country} IBAN has ${expected} characters, this has ${s.length}`, s);
  if (!ibanValid(s)) return bad("The check digits do not match (mod 97)", s);
  return ok(s, { country, check_digits: s.slice(2, 4), bban: s.slice(4), formatted: s.replace(/(.{4})(?=.)/g, "$1 ") });
}
function validateBic(raw) {
  const s = raw.replace(/\s/g, "").toUpperCase();
  if (!bicValid(s)) return bad("A BIC is 8 or 11 characters: 4-letter bank code, 2-letter country, 2-character location, optional 3-character branch", s);
  return ok(s, { bank_code: s.slice(0, 4), country: s.slice(4, 6), location: s.slice(6, 8), branch: s.length === 11 ? s.slice(8) : "XXX", primary_office: s.length === 8 || s.endsWith("XXX"), test_bic: s[7] === "0" });
}
function validateCard(raw) {
  if (/[^\d\s-]/.test(raw.trim())) return bad("A card number has only digits, spaces and dashes");
  const d = digitsOf(raw);
  if (d.length < 12 || d.length > 19) return bad(`A card number has 12–19 digits, this has ${d.length}`, d);
  if (/^(\d)\1+$/.test(d)) return bad("All digits are the same", d);
  if (!luhn(d)) return bad("The check digit is wrong (Luhn)", d);
  return ok(d, { issuer: cardIssuer(d) ?? "unknown", length: d.length, last4: d.slice(-4), masked: `${"*".repeat(d.length - 4)}${d.slice(-4)}` });
}
function validateEmail(raw) {
  const s = raw.trim();
  const at = s.lastIndexOf("@");
  if (at < 1 || at === s.length - 1) return bad("An email address needs a name, @ and a domain", s);
  const local = s.slice(0, at);
  const domain = s.slice(at + 1).toLowerCase();
  const normalized = `${local}@${domain}`;
  if (s.length > 254) return bad("An email address has at most 254 characters", normalized);
  if (local.length > 64) return bad("The part before @ has at most 64 characters", normalized);
  if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return bad("The part before @ has a character that is not allowed, or a misplaced dot", normalized);
  const labels = domain.split(".");
  if (labels.length < 2) return bad("The domain needs a dot (example.com)", normalized);
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) && !/^xn--[a-z0-9-]+$/.test(label)) return bad(`The domain part "${label.slice(0, 30)}" is not valid`, normalized);
  }
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return bad("The top-level domain must be letters (e.g. .com, .nz)", normalized);
  return ok(normalized, { local, domain, tld });
}
function callingCodeOf(country) {
  const c = country.trim().replace(/^\+/, "").toUpperCase();
  if (!c) return "";
  if (/^\d{1,3}$/.test(c)) return c;
  const code = CALLING_CODES[c];
  if (!code) throw new Error(`country "${country}" is not a known ISO country code (use e.g. NZ, or a calling code such as 64)`);
  return code;
}
function parsePhone(raw, country) {
  const s = raw.trim();
  if (!s) return bad("No phone number");
  if (/[^\d\s()+.\-/]/.test(s.replace(/\s*(?:ext\.?|x)\s*\d+$/i, ""))) return bad("A phone number has only digits, spaces, + ( ) - . and /");
  const main = s.replace(/\s*(?:ext\.?|x)\s*\d+$/i, "");
  let digits = digitsOf(main);
  let code = "";
  let national = "";
  if (main.startsWith("+") || main.startsWith("00")) {
    if (main.startsWith("00")) digits = digits.slice(2);
    const split = splitCallingCode(digits);
    if (split) ({ code, national } = split);
    else {
      code = "";
      national = digits;
    }
  } else {
    code = callingCodeOf(country);
    if (!code) return bad("Without + and a country code, set the default country (e.g. NZ or 64)", digits);
    national = digits;
    if (!NO_TRUNK_PREFIX.has(code) && national.startsWith("0")) national = national.slice(1);
    if (code === "1" && national.length === 11 && national.startsWith("1")) national = national.slice(1);
  }
  const all = code + national;
  if (all.length < 8 || all.length > 15) return bad(`An international number has 8–15 digits, this has ${all.length}`, `+${all}`);
  if (code === "1" && national.length !== 10) return bad("A North American number has 10 digits after +1", `+${all}`);
  return { code, national, e164: `+${all}` };
}
function validatePhone(raw, country) {
  const p = parsePhone(raw, country);
  if ("valid" in p) return p;
  return ok(p.e164, { country_code: p.code, national_number: p.national, countries: countriesForCode(p.code), international: formatPhoneParts(p, "international"), national: formatPhoneParts(p, "national") });
}
function groupNational(n) {
  if (n.length <= 4) return [n];
  if (n.length <= 7) return [n.slice(0, n.length - 4), n.slice(-4)];
  const head = n.length - 7;
  return [n.slice(0, head), n.slice(head, head + 3), n.slice(-4)];
}
function formatPhoneParts(p, style) {
  if (style === "e164") return p.e164;
  if (p.code === "1" && p.national.length === 10) {
    const [a, b, c] = [p.national.slice(0, 3), p.national.slice(3, 6), p.national.slice(6)];
    return style === "national" ? `(${a}) ${b}-${c}` : `+1 ${a} ${b} ${c}`;
  }
  const groups = groupNational(p.national);
  if (style === "international") return [`+${p.code}`, ...groups].join(" ").trim();
  const trunk = p.code && !NO_TRUNK_PREFIX.has(p.code) ? "0" : "";
  return [trunk + groups[0], ...groups.slice(1)].join(" ");
}
function validatePostcode(raw, country) {
  const c = country.trim().toUpperCase();
  if (!c) return bad("Set the country for postcode validation (e.g. GB, US, NZ)");
  const rule = POSTCODES[c === "UK" ? "GB" : c];
  if (!rule) throw new Error(`Postcodes for "${country}" are not supported (supported: ${Object.keys(POSTCODES).join(", ")})`);
  const compact = raw.toUpperCase().replace(/[\s-]/g, "");
  if (!rule.re.test(compact)) return bad(`Not a valid ${c} postcode (for example ${rule.example})`, compact);
  return ok(rule.format ? rule.format(compact) : compact, { country: c === "UK" ? "GB" : c });
}
var ID_RULES = {
  us_ssn: { check: usSsnValid, normalize: digitsOf, format: (d) => `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`, name: "US Social Security number" },
  uk_nino: { check: ukNinoValid, normalize: (s) => s.replace(/\s/g, "").toUpperCase(), format: (s) => s.replace(/^(..)(..)(..)(..)(.)$/, "$1 $2 $3 $4 $5"), name: "UK National Insurance number" },
  ca_sin: { check: caSinValid, normalize: digitsOf, format: (d) => `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`, name: "Canadian Social Insurance Number" },
  au_tfn: { check: auTfnValid, normalize: digitsOf, format: (d) => d.replace(/(\d{3})(?=\d)/g, "$1 "), name: "Australian Tax File Number" },
  nz_ird: { check: nzIrdValid, normalize: (s) => digitsOf(s).padStart(9, "0"), format: (d) => `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, name: "New Zealand IRD number" },
  nz_nhi: { check: nzNhiValid, normalize: (s) => s.replace(/\s/g, "").toUpperCase(), name: "New Zealand NHI number" },
  de_tax_id: { check: deTaxIdValid, normalize: digitsOf, format: (d) => `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`, name: "German tax ID (Steuer-ID)" },
  fr_nir: { check: frNirValid, normalize: (s) => s.replace(/[\s.-]/g, "").toUpperCase(), format: (s) => s.replace(/^(.)(..)(..)(..)(...)(...)(..)$/, "$1 $2 $3 $4 $5 $6 $7"), name: "French social security number (NIR)" },
  es_dni: { check: esDniValid, normalize: (s) => s.replace(/[\s-]/g, "").toUpperCase(), name: "Spanish DNI / NIE" },
  it_fiscal_code: { check: itFiscalCodeValid, normalize: (s) => s.replace(/\s/g, "").toUpperCase(), name: "Italian fiscal code (codice fiscale)" },
  nl_bsn: { check: nlBsnValid, normalize: (s) => digitsOf(s).padStart(9, "0"), name: "Dutch citizen service number (BSN)" },
  in_aadhaar: { check: aadhaarValid, normalize: digitsOf, format: (d) => `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`, name: "Indian Aadhaar number" },
  sg_nric: { check: sgNricValid, normalize: (s) => s.replace(/\s/g, "").toUpperCase(), name: "Singapore NRIC / FIN" }
};
function validateNationalId(raw, idType) {
  const type = idType.trim().toLowerCase();
  if (!type) return bad("Set id_type for national_id (e.g. us_ssn, uk_nino, nz_ird)");
  const rule = ID_RULES[type];
  if (!rule) throw new Error(`id_type must be one of ${ID_TYPES.join(", ")}`);
  const normalized = rule.normalize(raw);
  if (!rule.check(normalized)) return bad(`Not a valid ${rule.name} (format or check digit)`, normalized, { id_type: type });
  return ok(normalized, { id_type: type, name: rule.name, formatted: rule.format ? rule.format(normalized) : normalized });
}
function validateOne(type, value, opts) {
  if (!value.trim()) return bad("No value");
  if (value.length > 500) return bad("The value is longer than 500 characters");
  switch (type) {
    case "iban":
      return validateIban(value);
    case "bic":
      return validateBic(value);
    case "card":
      return validateCard(value);
    case "email":
      return validateEmail(value);
    case "phone":
      return validatePhone(value, opts.country);
    case "postcode":
      return validatePostcode(value, opts.country);
    case "national_id":
      return validateNationalId(value, opts.id_type);
  }
}
function locale(inputs) {
  const l = str(inputs, "locale", { default: "en-US" });
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(l)) throw new Error(`locale "${l.slice(0, 20)}" is not a BCP 47 tag such as en-US or de-DE`);
  return l;
}
function currencyCode(inputs, required) {
  const c = str(inputs, "currency").toUpperCase();
  if (!c) {
    if (required) throw new Error("currency is required (an ISO 4217 code such as USD, EUR, NZD)");
    return "";
  }
  if (!/^[A-Z]{3}$/.test(c)) throw new Error(`currency "${c.slice(0, 10)}" must be a 3-letter ISO 4217 code such as USD`);
  return c;
}
function fractionOptions(inputs) {
  const min = optNum(inputs, "minimum_fraction_digits", { integer: true, min: 0, max: 20 });
  const max = optNum(inputs, "maximum_fraction_digits", { integer: true, min: 0, max: 20 });
  if (min !== null && max !== null && min > max) throw new Error("minimum_fraction_digits cannot be more than maximum_fraction_digits");
  return { ...min !== null ? { minimumFractionDigits: min } : {}, ...max !== null ? { maximumFractionDigits: max } : {} };
}
function numberSymbols(ctx, loc) {
  const sample = ctx.intl.formatNumber(-12345.6, loc, { useGrouping: true, minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const digits = ctx.intl.formatNumber(1234567890, loc, { useGrouping: false });
  const ds = Array.from(digits);
  const map = [ds[9], ds[0], ds[1], ds[2], ds[3], ds[4], ds[5], ds[6], ds[7], ds[8]];
  const chars = Array.from(sample);
  const isDigit = (c) => map.includes(c);
  const firstDigit = chars.findIndex(isDigit);
  const minus = chars.slice(0, firstDigit).join("").trim() || "-";
  const body = chars.slice(firstDigit);
  const lastDigitIdx = body.length - 1;
  const decimal = body[lastDigitIdx - 1];
  const groupChars = body.slice(2, body.length - 5).join("");
  return { group: groupChars, decimal, digits: map, minus };
}
var action_default = defineAction({
  operations: {
    validate(inputs) {
      const type = choice(inputs, "type", TYPES, "email");
      const value = str(inputs, "value", { trim: false });
      return validateOne(type, value, { country: str(inputs, "country"), id_type: str(inputs, "id_type") });
    },
    validate_many(inputs) {
      const items = list(inputs, "items", { required: true });
      if (items.length > 1e4) throw new Error("items: at most 10,000");
      const defaultCountry = str(inputs, "country");
      const results = items.map((item, i) => {
        if (!isPlainObject(item)) throw new Error(`items[${i}] must be an object like { "type": "email", "value": "a@b.co" }`);
        const type = String(item.type ?? "").trim().toLowerCase();
        if (!TYPES.includes(type)) throw new Error(`items[${i}].type must be one of ${TYPES.join(", ")}`);
        const value = item.value === null || item.value === void 0 ? "" : String(item.value);
        const r = validateOne(type, value, { country: String(item.country ?? defaultCountry), id_type: String(item.id_type ?? "") });
        return { ...item.name !== void 0 ? { name: String(item.name) } : {}, type, value, valid: r.valid, normalized: r.normalized, reason: r.reason };
      });
      const validCount = results.filter((r) => r.valid).length;
      return { results, all_valid: validCount === results.length, valid_count: validCount, invalid_count: results.length - validCount };
    },
    format_number(inputs, ctx) {
      const value = num(inputs, "value");
      const loc = locale(inputs);
      const style = choice(inputs, "style", ["decimal", "percent", "currency"], "decimal");
      const currency = currencyCode(inputs, style === "currency");
      const notation = choice(inputs, "notation", ["standard", "compact", "scientific", "engineering"], "standard");
      const options = {
        style,
        notation,
        useGrouping: bool(inputs, "use_grouping", true),
        ...fractionOptions(inputs),
        ...style === "currency" ? { currency } : {}
      };
      return { formatted: ctx.intl.formatNumber(value, loc, options) };
    },
    format_currency(inputs, ctx) {
      const value = num(inputs, "value");
      const currency = currencyCode(inputs, true);
      const loc = locale(inputs);
      const display = choice(inputs, "display", ["symbol", "narrowSymbol", "code", "name"], "symbol");
      const accounting = bool(inputs, "accounting", false);
      const formatted = ctx.intl.formatNumber(value, loc, { style: "currency", currency, currencyDisplay: display, ...accounting ? { currencySign: "accounting" } : {}, ...fractionOptions(inputs) });
      return { formatted, currency };
    },
    parse_number(inputs, ctx) {
      const raw = str(inputs, "text", { required: true, max: 200 });
      const loc = locale(inputs);
      const sym = numberSymbols(ctx, loc);
      let s = raw;
      sym.digits.forEach((d, i) => {
        if (d !== String(i)) s = s.split(d).join(String(i));
      });
      let negative = false;
      if (/^\(.*\)$/.test(s.trim())) {
        negative = true;
        s = s.trim().slice(1, -1);
      }
      const percent = /[%\u066a]/.test(s);
      s = s.replace(/[%\u066a]/g, "");
      if (/^[\s\p{Sc}\p{L}.]*[-\u2212\u2012\u2013]/u.test(s) || /[-\u2212]\s*[\p{Sc}\p{L}]*\s*$/u.test(s) || sym.minus !== "-" && s.includes(sym.minus)) negative = true;
      s = s.replace(/^([\s\p{Sc}\p{L}.]*)[-\u2212\u2012\u2013+]/u, "$1").replace(/[-\u2212](\s*[\p{Sc}\p{L}]*\s*)$/u, "$1");
      if (sym.minus !== "-") s = s.split(sym.minus).join("");
      s = s.replace(/\p{Sc}/gu, "").trim().replace(/^[\p{L}.]+\s*/u, "").replace(/\s*\p{L}+\.?$/u, "").replace(/[\s\u00a0\u202f]/g, "");
      const group = sym.group.replace(/[\s\u00a0\u202f]/g, "");
      const decimalAt = s.indexOf(sym.decimal);
      if (group && decimalAt >= 0 && s.indexOf(group, decimalAt + 1) > decimalAt) return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group };
      if (group && s.includes(group)) {
        const intPart = decimalAt >= 0 ? s.slice(0, decimalAt) : s;
        const parts = intPart.split(group);
        const wellFormed = /^\d{1,3}$/.test(parts[0]) && parts.slice(1, -1).every((p) => /^\d{2,3}$/.test(p)) && /^\d{3}$/.test(parts[parts.length - 1]);
        if (!wellFormed) return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group };
        s = s.split(group).join("");
      }
      s = s.replace(/['’]/g, "");
      if (sym.decimal !== ".") {
        if (s.includes(".") && group !== ".") return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group };
        s = s.split(sym.decimal).join(".");
      }
      const ok2 = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s);
      if (!ok2) return { value: null, valid: false, decimal_separator: sym.decimal, group_separator: sym.group };
      let value = Number(s);
      if (percent) value = Number((value / 100).toPrecision(15));
      if (negative) value = -value;
      return { value: value === 0 ? 0 : value, valid: true, decimal_separator: sym.decimal, group_separator: sym.group };
    },
    format_phone(inputs) {
      const value = str(inputs, "value", { required: true, max: 100 });
      const country = str(inputs, "country");
      const style = choice(inputs, "format", ["e164", "international", "national"], "international");
      const p = parsePhone(value, country);
      if ("valid" in p) return { formatted: "", e164: "", valid: false, reason: p.reason };
      return { formatted: formatPhoneParts(p, style), e164: p.e164, valid: true, reason: "" };
    }
  }
});
export {
  action_default as default
};
