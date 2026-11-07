/*! UserTasks action ut_text 1.0.0 */

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
function text(inputs, name, opts = {}) {
  return str(inputs, name, { ...opts, trim: false });
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

// gallery/actions/text-toolkit/src/similarity.ts
function levenshtein(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = new Array(y.length + 1);
  let cur = new Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    ;
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}
function jaro(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0 && y.length === 0) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(x.length, y.length) / 2) - 1);
  const xm = new Array(x.length).fill(false);
  const ym = new Array(y.length).fill(false);
  let matches = 0;
  for (let i = 0; i < x.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(y.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (!ym[j] && x[i] === y[j]) {
        xm[i] = true;
        ym[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < x.length; i++) {
    if (!xm[i]) continue;
    while (!ym[k]) k++;
    if (x[i] !== y[k]) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  return (matches / x.length + matches / y.length + (matches - t) / matches) / 3;
}
function jaroWinkler(a, b) {
  const j = jaro(a, b);
  const x = Array.from(a);
  const y = Array.from(b);
  let prefix = 0;
  while (prefix < 4 && prefix < x.length && prefix < y.length && x[prefix] === y[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

// gallery/actions/text-toolkit/src/action.ts
var MAX_TEXT = 1e6;
var SPECIAL_LATIN = {
  ß: "ss",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ł: "l",
  Ł: "L",
  þ: "th",
  Þ: "TH",
  ð: "d",
  Ð: "D",
  ı: "i"
};
function asciiFold(s) {
  return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[ßæÆœŒøØđĐłŁþÞðÐı]/g, (ch) => SPECIAL_LATIN[ch] ?? ch);
}
function words(s) {
  return s.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2").replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
var cap = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
var MINOR_WORDS = /* @__PURE__ */ new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "off", "on", "per", "to", "up", "via", "with", "from", "into", "over"]);
function titleCase(s) {
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
  const matches = [...s.matchAll(re)];
  let out = "";
  let last = 0;
  matches.forEach((m, i) => {
    const w = m[0];
    const lower = w.toLowerCase();
    const first = i === 0;
    const final = i === matches.length - 1;
    const next = w.length > 1 && w === w.toUpperCase() && /\p{Lu}/u.test(w) ? w : !first && !final && MINOR_WORDS.has(lower) ? lower : cap(w);
    out += s.slice(last, m.index) + next;
    last = m.index + w.length;
  });
  return out + s.slice(last);
}
function sentenceCase(s) {
  let start = true;
  let out = "";
  for (const ch of s.toLowerCase()) {
    if (start && /\p{L}/u.test(ch)) {
      out += ch.toUpperCase();
      start = false;
    } else {
      out += ch;
      if (/[.!?]/.test(ch)) start = true;
      else if (/\p{N}/u.test(ch)) start = false;
    }
  }
  return out.replace(/\bi\b/g, "I");
}
var CASES = ["camel", "pascal", "snake", "kebab", "constant", "title", "sentence", "upper", "lower"];
function changeCase(s, kind) {
  const ws = words(s);
  switch (kind) {
    case "camel":
      return ws.map((w, i) => i === 0 ? w.toLowerCase() : cap(w)).join("");
    case "pascal":
      return ws.map(cap).join("");
    case "snake":
      return ws.map((w) => w.toLowerCase()).join("_");
    case "kebab":
      return ws.map((w) => w.toLowerCase()).join("-");
    case "constant":
      return ws.map((w) => w.toUpperCase()).join("_");
    case "title":
      return titleCase(s);
    case "sentence":
      return sentenceCase(s);
    case "upper":
      return s.toUpperCase();
    case "lower":
      return s.toLowerCase();
  }
}
function stringify(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
var action_default = defineAction({
  operations: {
    slugify(inputs) {
      const value = text(inputs, "text", { required: true, max: MAX_TEXT });
      const separator = str(inputs, "separator", { default: "-", trim: false });
      if (separator.length > 3 || /[\p{L}\p{N}]/u.test(separator)) throw new Error("separator must be up to 3 punctuation characters (e.g. - or _)");
      const lowercase = bool(inputs, "lowercase", true);
      const maxLength = num(inputs, "max_length", { integer: true, min: 0, max: 1e3, default: 0 });
      let folded = asciiFold(value).replace(/&/g, " and ").replace(/[''’]/g, "");
      if (lowercase) folded = folded.toLowerCase();
      let slug = folded.split(/[^A-Za-z0-9]+/).filter(Boolean).join(separator);
      if (maxLength > 0 && slug.length > maxLength) {
        slug = slug.slice(0, maxLength);
        const cut = separator ? slug.lastIndexOf(separator) : -1;
        if (cut > maxLength / 2) slug = slug.slice(0, cut);
        while (separator && slug.endsWith(separator)) slug = slug.slice(0, -separator.length);
      }
      return { slug };
    },
    change_case(inputs) {
      const value = text(inputs, "text", { max: MAX_TEXT });
      const kind = choice(inputs, "case", CASES, "snake");
      return { result: changeCase(value, kind) };
    },
    template(inputs) {
      const template = text(inputs, "template", { required: true, max: MAX_TEXT });
      const data = obj(inputs, "data");
      const missingMode = choice(inputs, "missing", ["keep", "blank", "error"], "keep");
      const missing = [];
      let replaced = 0;
      const result = template.replace(/\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g, (whole, path, fallback) => {
        const value = getPath(data, path);
        if (value === void 0 || value === null || value === "") {
          if (fallback !== void 0) {
            replaced++;
            return fallback;
          }
          if (value === void 0) {
            if (!missing.includes(path)) missing.push(path);
            if (missingMode === "keep") return whole;
            return "";
          }
          replaced++;
          return "";
        }
        replaced++;
        return stringify(value);
      });
      if (missingMode === "error" && missing.length) throw new Error(`No value for ${missing.map((m) => `{{${m}}}`).join(", ")}`);
      return { result, missing, replaced };
    },
    truncate(inputs) {
      const value = text(inputs, "text", { max: MAX_TEXT });
      const length = num(inputs, "length", { integer: true, min: 1, max: 1e6 });
      const by = choice(inputs, "by", ["chars", "words"], "chars");
      const rawEllipsis = inputs.ellipsis === void 0 || inputs.ellipsis === null ? "…" : String(inputs.ellipsis);
      const ellipsis = rawEllipsis.trim().toLowerCase() === "none" ? "" : rawEllipsis;
      const preserveWords = bool(inputs, "preserve_words", true);
      if (by === "words") {
        const tokens = value.trim().split(/\s+/).filter(Boolean);
        if (tokens.length <= length) return { result: value, truncated: false };
        return { result: tokens.slice(0, length).join(" ").replace(/[\s,;:.\-\u2013\u2014]+$/u, "") + ellipsis, truncated: true };
      }
      const chars = Array.from(value);
      if (chars.length <= length) return { result: value, truncated: false };
      const room = Math.max(0, length - Array.from(ellipsis).length);
      let cut = chars.slice(0, room).join("");
      if (preserveWords && room > 0 && /[\p{L}\p{N}]/u.test(chars[room] ?? "")) {
        const space = cut.search(/\s\S*$/);
        if (space > room / 2) cut = cut.slice(0, space);
      }
      cut = cut.replace(/[\s,;:.\-\u2013\u2014]+$/u, "");
      return { result: cut + ellipsis, truncated: true };
    },
    extract_between(inputs) {
      const value = text(inputs, "text", { max: MAX_TEXT });
      const start = str(inputs, "start", { trim: false });
      const end = str(inputs, "end", { trim: false });
      if (!start && !end) throw new Error("Set a start marker, an end marker or both");
      const all = bool(inputs, "all", false);
      const includeMarkers = bool(inputs, "include_markers", false);
      const caseSensitive = bool(inputs, "case_sensitive", true);
      const trim = bool(inputs, "trim", true);
      const hay = caseSensitive ? value : value.toLowerCase();
      const s = caseSensitive ? start : start.toLowerCase();
      const e = caseSensitive ? end : end.toLowerCase();
      const matches = [];
      let from = 0;
      while (from <= value.length) {
        const i = s ? hay.indexOf(s, from) : from;
        if (i < 0) break;
        const contentStart = i + s.length;
        const j = e ? hay.indexOf(e, contentStart) : value.length;
        if (j < 0) break;
        let m = includeMarkers ? value.slice(i, j + e.length) : value.slice(contentStart, j);
        if (trim) m = m.trim();
        matches.push(m);
        if (!all || !s) break;
        from = j + Math.max(e.length, 1);
      }
      return { value: matches[0] ?? "", matches, count: matches.length, found: matches.length > 0 };
    },
    similarity(inputs) {
      const caseSensitive = bool(inputs, "case_sensitive", false);
      const norm = (s) => {
        const t = s.trim().replace(/\s+/g, " ");
        return caseSensitive ? t : t.toLowerCase();
      };
      const a = norm(text(inputs, "value", { required: true, max: 1e4 }));
      const bRaw = inputs.compare_to;
      const hasB = bRaw !== void 0 && bRaw !== null && String(bRaw) !== "";
      const candidates = list(inputs, "candidates").map((c) => isPlainObject(c) || Array.isArray(c) ? JSON.stringify(c) : String(c ?? ""));
      if (!hasB && candidates.length === 0) throw new Error("Set compare_to, candidates or both");
      if (candidates.length > 1e4) throw new Error("candidates: at most 10,000 entries");
      const threshold = num(inputs, "threshold", { min: 0, max: 1, default: 0.8 });
      const method = choice(inputs, "method", ["jaro_winkler", "levenshtein"], "jaro_winkler");
      const levSim = (x, y) => {
        const max = Math.max(Array.from(x).length, Array.from(y).length);
        return max === 0 ? 1 : 1 - levenshtein(x, y) / max;
      };
      const score = (x, y) => method === "levenshtein" ? levSim(x, y) : jaroWinkler(x, y);
      const r4 = (n) => Math.round(n * 1e4) / 1e4;
      let distance = null;
      let similarity = null;
      let jw = null;
      if (hasB) {
        const b = norm(String(bRaw));
        if (b.length > 1e4) throw new Error("compare_to is longer than 10,000 characters");
        distance = levenshtein(a, b);
        similarity = r4(levSim(a, b));
        jw = r4(jaroWinkler(a, b));
      }
      let bestIndex = -1;
      let bestScore = 0;
      candidates.forEach((c, i) => {
        const sc = score(a, norm(c));
        if (sc > bestScore) {
          bestScore = sc;
          bestIndex = i;
        }
      });
      const pairScore = hasB ? method === "levenshtein" ? similarity : jw : 0;
      const matched = candidates.length ? bestScore >= threshold : pairScore >= threshold;
      return {
        distance,
        similarity,
        jaro_winkler: jw,
        best_match: bestIndex >= 0 ? candidates[bestIndex] : null,
        best_score: candidates.length ? r4(bestScore) : null,
        best_index: bestIndex,
        matched
      };
    },
    word_count(inputs) {
      const value = text(inputs, "text", { max: MAX_TEXT });
      const wpm = num(inputs, "words_per_minute", { integer: true, min: 50, max: 1e3, default: 200 });
      const wordMatches = value.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu) ?? [];
      const chars = Array.from(value);
      const sentences = value.split(/(?<=[.!?…])\s+|\n\s*\n/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length;
      const paragraphs = value.split(/\r?\n\s*\r?\n/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
      return {
        words: wordMatches.length,
        characters: chars.length,
        characters_no_spaces: chars.filter((c) => !/\s/u.test(c)).length,
        sentences,
        paragraphs,
        reading_minutes: wordMatches.length === 0 ? 0 : Math.max(1, Math.ceil(wordMatches.length / wpm))
      };
    },
    mask(inputs) {
      const value = text(inputs, "value", { max: 1e5 });
      const mode = choice(inputs, "mode", ["keep_last", "keep_first", "email", "all"], "keep_last");
      const keep = num(inputs, "keep", { integer: true, min: 0, max: 1e3, default: 4 });
      const maskChar = Array.from(str(inputs, "mask_char", { default: "*", trim: false }))[0] ?? "*";
      const preserve = bool(inputs, "preserve_separators", true);
      const isSep = (c) => preserve && /[\s\-./()+]/.test(c);
      const maskRun = (chars2, keepFirst, keepLast) => {
        const idx = chars2.map((c, i) => isSep(c) ? -1 : i).filter((i) => i >= 0);
        const keepSet = /* @__PURE__ */ new Set([...idx.slice(0, keepFirst), ...keepLast > 0 ? idx.slice(-keepLast) : []]);
        if (keepSet.size >= idx.length && idx.length > 0) {
          keepSet.clear();
          const half = Math.floor(idx.length / 2);
          const kept = keepFirst > 0 ? idx.slice(0, half) : half > 0 ? idx.slice(-half) : [];
          for (const i of kept) keepSet.add(i);
        }
        return chars2.map((c, i) => isSep(c) || keepSet.has(i) ? c : maskChar).join("");
      };
      if (mode === "email") {
        const at = value.lastIndexOf("@");
        if (at <= 0) throw new Error("value is not an email address");
        const local = Array.from(value.slice(0, at));
        const masked = local.length <= 1 ? maskChar : local[0] + maskChar.repeat(Math.max(3, local.length - 1));
        return { masked: masked + value.slice(at) };
      }
      const chars = Array.from(value);
      if (mode === "all") return { masked: chars.map((c) => isSep(c) ? c : maskChar).join("") };
      return { masked: mode === "keep_last" ? maskRun(chars, 0, keep) : maskRun(chars, keep, 0) };
    }
  }
});
export {
  action_default as default
};
