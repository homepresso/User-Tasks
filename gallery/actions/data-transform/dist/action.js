/*! UserTasks action ut_data 1.0.0 */

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
function strList(inputs, name, opts = {}) {
  return list(inputs, name, opts).filter((v) => !isBlank(v)).map((v) => typeof v === "string" ? v.trim() : typeof v === "object" ? JSON.stringify(v) : String(v));
}
function json(inputs, name) {
  const raw = inputs[name];
  if (typeof raw === "string") {
    const s = raw.trim();
    if (/^[[{]/.test(s)) {
      try {
        return JSON.parse(s);
      } catch {
      }
    }
  }
  return raw ?? null;
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

// gallery/actions/data-transform/src/csv.ts
function parseCsv(input, delimiter) {
  const text2 = input.charCodeAt(0) === 65279 ? input.slice(1) : input;
  const rows2 = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  let fieldStarted = false;
  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    rows2.push(row);
    row = [];
  };
  while (i < text2.length) {
    const ch = text2[i];
    if (quoted) {
      if (ch === '"') {
        if (text2[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (text2.startsWith(delimiter, i)) {
      endField();
      i += delimiter.length;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRow();
      i += ch === "\r" && text2[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i++;
  }
  if (quoted) throw new Error("The CSV has an unclosed quote");
  if (field !== "" || fieldStarted || row.length > 0) endRow();
  return rows2;
}
function sniffDelimiter(text2) {
  const firstLine = text2.split(/\r?\n/, 1)[0] ?? "";
  const unquoted = firstLine.replace(/"[^"]*"/g, "");
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "	", "|"]) {
    const count = unquoted.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}
function csvField(value, delimiter, escapeFormulas) {
  let s = value === null || value === void 0 ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (escapeFormulas && typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function inferValue(s) {
  if (s === "") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && (Number.isSafeInteger(n) || !/^-?\d+$/.test(s))) return n;
  }
  const lower = s.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return s;
}

// gallery/actions/data-transform/src/action.ts
var MAX_ITEMS = 1e5;
function rows(inputs, name = "items") {
  const raw = list(inputs, name, { required: true });
  if (raw.length > MAX_ITEMS) throw new Error(`${name}: at most ${MAX_ITEMS} items`);
  return raw.map((item, i) => {
    if (!isPlainObject(item)) throw new Error(`${name}[${i}] is not an object (expected a list of objects)`);
    return item;
  });
}
function setPath(target, path, value) {
  const parts = path.split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cur[parts[i]];
    if (!isPlainObject(next)) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}
function parsePath(path) {
  let p = path.trim();
  if (p === "$" || p === "") return [];
  if (p.startsWith("$.")) p = p.slice(2);
  else if (p.startsWith("$[")) p = p.slice(1);
  const segs = [];
  const re = /\.?([^.[\]]+)|\[(\*|-?\d+)\]|\[(?:"([^"]*)"|'([^']*)')\]/gy;
  let m;
  let last = 0;
  while (last < p.length && (m = re.exec(p))) {
    last = re.lastIndex;
    if (m[1] !== void 0) segs.push(m[1] === "*" ? { kind: "all" } : { kind: "key", key: m[1] });
    else if (m[2] !== void 0) segs.push(m[2] === "*" ? { kind: "all" } : { kind: "index", index: Number(m[2]) });
    else segs.push({ kind: "key", key: m[3] ?? m[4] ?? "" });
  }
  if (last !== p.length) throw new Error(`path "${path}" is not valid near "${p.slice(last, last + 15)}"`);
  return segs;
}
function selectPath(source, path) {
  const segs = parsePath(path);
  let current = [source];
  let wildcard = false;
  for (const seg of segs) {
    const next = [];
    for (const v of current) {
      if (seg.kind === "all") {
        if (Array.isArray(v)) next.push(...v);
        else if (isPlainObject(v)) next.push(...Object.values(v));
      } else if (seg.kind === "index") {
        if (Array.isArray(v)) {
          const item = v[seg.index < 0 ? v.length + seg.index : seg.index];
          if (item !== void 0) next.push(item);
        }
      } else if ((isPlainObject(v) || Array.isArray(v)) && Object.prototype.hasOwnProperty.call(v, seg.key)) {
        next.push(v[seg.key]);
      }
    }
    if (seg.kind === "all") wildcard = true;
    current = next;
  }
  return { values: current, wildcard };
}
var numeric = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = toNumber(v);
    return n !== null && Number.isFinite(n) ? n : null;
  }
  return null;
};
var isEmpty = (v) => v === null || v === void 0 || typeof v === "string" && v.trim() === "" || Array.isArray(v) && v.length === 0 || isPlainObject(v) && Object.keys(v).length === 0;
var asText = (v, caseSensitive) => {
  const s = v === null || v === void 0 ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return caseSensitive ? s : s.toLowerCase();
};
function compareValues(a, b, type = "auto") {
  const ae = isEmpty(a);
  const be = isEmpty(b);
  if (ae || be) return ae && be ? 0 : ae ? 1 : -1;
  if (type === "number" || type === "auto") {
    const x2 = numeric(a);
    const y2 = numeric(b);
    if (x2 !== null && y2 !== null) return x2 - y2;
    if (type === "number") return x2 === null ? y2 === null ? 0 : 1 : -1;
  }
  if (type === "date") {
    const x2 = Date.parse(String(a));
    const y2 = Date.parse(String(b));
    if (!Number.isNaN(x2) && !Number.isNaN(y2)) return x2 - y2;
  }
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  const x = asText(a, false);
  const y = asText(b, false);
  return x < y ? -1 : x > y ? 1 : 0;
}
var OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with", "in", "not_in", "empty", "not_empty"];
var OPERATOR_ALIASES = {
  "=": "eq",
  "==": "eq",
  equals: "eq",
  "!=": "ne",
  "<>": "ne",
  not_equals: "ne",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
  is_empty: "empty",
  is_not_empty: "not_empty"
};
function parseConditions(inputs) {
  return list(inputs, "conditions", { required: true }).map((c, i) => {
    if (!isPlainObject(c)) throw new Error(`conditions[${i}] must be an object like { "field": "status", "operator": "eq", "value": "open" }`);
    const field = String(c.field ?? "").trim();
    if (!field) throw new Error(`conditions[${i}].field is required`);
    const rawOp = String(c.operator ?? "eq").trim().toLowerCase();
    const operator = OPERATORS.includes(rawOp) ? rawOp : OPERATOR_ALIASES[rawOp];
    if (!operator) throw new Error(`conditions[${i}].operator must be one of ${OPERATORS.join(", ")}`);
    return { field, operator, value: c.value };
  });
}
function listOf(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map((s) => s.trim());
  return [v];
}
function test(row, c, caseSensitive) {
  const actual = getPath(row, c.field);
  const eq = (a, b) => {
    const x = numeric(a);
    const y = numeric(b);
    if (x !== null && y !== null) return x === y;
    if (isEmpty(a) && isEmpty(b)) return true;
    return asText(a, caseSensitive) === asText(b, caseSensitive);
  };
  switch (c.operator) {
    case "eq":
      return eq(actual, c.value);
    case "ne":
      return !eq(actual, c.value);
    case "gt":
      return !isEmpty(actual) && compareValues(actual, c.value) > 0;
    case "gte":
      return !isEmpty(actual) && compareValues(actual, c.value) >= 0;
    case "lt":
      return !isEmpty(actual) && compareValues(actual, c.value) < 0;
    case "lte":
      return !isEmpty(actual) && compareValues(actual, c.value) <= 0;
    case "contains":
    case "not_contains": {
      const has = Array.isArray(actual) ? actual.some((v) => eq(v, c.value)) : asText(actual, caseSensitive).includes(asText(c.value, caseSensitive));
      return c.operator === "contains" ? has : !has;
    }
    case "starts_with":
      return asText(actual, caseSensitive).startsWith(asText(c.value, caseSensitive));
    case "ends_with":
      return asText(actual, caseSensitive).endsWith(asText(c.value, caseSensitive));
    case "in":
      return listOf(c.value).some((v) => eq(actual, v));
    case "not_in":
      return !listOf(c.value).some((v) => eq(actual, v));
    case "empty":
      return isEmpty(actual);
    case "not_empty":
      return !isEmpty(actual);
  }
}
var AGG_OPS = ["count", "count_distinct", "sum", "avg", "min", "max", "first", "last", "list"];
function parseAggregates(inputs) {
  const raw = list(inputs, "aggregates");
  const out = raw.map((a, i) => {
    let op = "";
    let field = "";
    let as = "";
    if (isPlainObject(a)) {
      op = String(a.op ?? a.operation ?? a.function ?? "").trim().toLowerCase();
      field = String(a.field ?? "").trim();
      as = String(a.as ?? a.name ?? "").trim();
    } else {
      const m = /^\s*([a-z_]+)\s*(?:[:(]\s*([^)\s]+?)\s*\)?)?\s*(?:as\s+(\S+))?\s*$/i.exec(String(a));
      if (!m) throw new Error(`aggregates[${i}]: write it as op:field (sum:amount) or { "op": "sum", "field": "amount" }`);
      op = m[1].toLowerCase();
      field = m[2] ?? "";
      as = m[3] ?? "";
    }
    if (op === "average" || op === "mean") op = "avg";
    if (!AGG_OPS.includes(op)) throw new Error(`aggregates[${i}]: op must be one of ${AGG_OPS.join(", ")}`);
    if (op !== "count" && !field) throw new Error(`aggregates[${i}]: ${op} needs a field`);
    return { op, field, as: as || (op === "count" && !field ? "count" : `${op}_${field.replace(/\W+/g, "_")}`) };
  });
  return out;
}
function aggregate(group, agg) {
  const values = agg.field ? group.map((r) => getPath(r, agg.field)) : group;
  const present = values.filter((v) => !isEmpty(v));
  switch (agg.op) {
    case "count":
      return agg.field ? present.length : group.length;
    case "count_distinct":
      return new Set(present.map((v) => JSON.stringify(v))).size;
    case "first":
      return values.find((v) => v !== void 0) ?? null;
    case "last":
      return [...values].reverse().find((v) => v !== void 0) ?? null;
    case "list":
      return present;
    default: {
      const nums = present.map((v) => numeric(v)).filter((n) => n !== null);
      if (agg.op === "sum") return clean(nums.reduce((s, n) => s + n, 0));
      if (nums.length === 0) return null;
      if (agg.op === "avg") return clean(nums.reduce((s, n) => s + n, 0) / nums.length);
      if (agg.op === "min") return Math.min(...nums);
      return Math.max(...nums);
    }
  }
}
var keyOf = (row, fields, caseSensitive = true) => JSON.stringify(fields.map((f) => {
  const v = getPath(row, f);
  return typeof v === "string" && !caseSensitive ? v.toLowerCase() : v ?? null;
}));
var action_default = defineAction({
  operations: {
    select(inputs) {
      const data = json(inputs, "data");
      const path = str(inputs, "path", { required: true });
      const { values, wildcard } = selectPath(data, path);
      const value = wildcard ? values : values.length ? values[0] : null;
      return { value: value === void 0 ? null : value, values, found: values.length > 0, count: values.length };
    },
    map(inputs) {
      const items = rows(inputs);
      const keepOther = bool(inputs, "keep_other_fields", false);
      const specs = list(inputs, "fields", { required: true }).map((spec, i) => {
        if (isPlainObject(spec)) {
          const from2 = String(spec.from ?? spec.field ?? "").trim();
          if (!from2) throw new Error(`fields[${i}].from is required`);
          return { from: from2, to: String(spec.to ?? spec.as ?? from2).trim(), dflt: spec.default };
        }
        const m = /^\s*(.+?)\s+(?:as|->|=>)\s+(.+?)\s*$/i.exec(String(spec));
        const from = (m ? m[1] : String(spec)).trim();
        if (!from) throw new Error(`fields[${i}] is empty`);
        return { from, to: (m ? m[2] : from).trim(), dflt: void 0 };
      });
      const out = items.map((row) => {
        const next = keepOther ? { ...row } : {};
        for (const s of specs) {
          if (keepOther && s.from !== s.to && Object.prototype.hasOwnProperty.call(next, s.from)) delete next[s.from];
          const v = getPath(row, s.from);
          setPath(next, s.to, v === void 0 ? s.dflt ?? null : v);
        }
        return next;
      });
      return { items: out, count: out.length };
    },
    filter(inputs) {
      const items = rows(inputs);
      const conditions = parseConditions(inputs);
      const combine = choice(inputs, "combine", ["all", "any"], "all");
      const caseSensitive = bool(inputs, "case_sensitive", false);
      const kept = items.filter((row) => combine === "all" ? conditions.every((c) => test(row, c, caseSensitive)) : conditions.some((c) => test(row, c, caseSensitive)));
      return { items: kept, count: kept.length, removed: items.length - kept.length };
    },
    sort(inputs) {
      const items = rows(inputs);
      const keys = list(inputs, "keys", { required: true }).map((k, i) => {
        let field = "";
        let direction = "asc";
        let type = "auto";
        if (isPlainObject(k)) {
          field = String(k.field ?? "").trim();
          direction = String(k.direction ?? "asc").toLowerCase();
          type = String(k.type ?? "auto").toLowerCase();
        } else {
          const parts = String(k).trim().split(/\s+/);
          field = parts[0] ?? "";
          if (field.startsWith("-")) {
            field = field.slice(1);
            direction = "desc";
          }
          if (parts[1]) direction = parts[1].toLowerCase();
          if (parts[2]) type = parts[2].toLowerCase();
        }
        if (!field) throw new Error(`keys[${i}]: a field is required`);
        if (direction !== "asc" && direction !== "desc") throw new Error(`keys[${i}]: direction must be asc or desc`);
        if (!["auto", "number", "text", "date"].includes(type)) throw new Error(`keys[${i}]: type must be auto, number, text or date`);
        return { field, desc: direction === "desc", type };
      });
      const indexed = items.map((row, i) => ({ row, i }));
      indexed.sort((a, b) => {
        for (const k of keys) {
          const av = getPath(a.row, k.field);
          const bv = getPath(b.row, k.field);
          if (isEmpty(av) || isEmpty(bv)) {
            const c2 = compareValues(av, bv);
            if (c2 !== 0) return c2;
            continue;
          }
          const c = k.type === "text" ? compareValues(asText(av, false), asText(bv, false), "text") : compareValues(av, bv, k.type);
          if (c !== 0) return k.desc ? -c : c;
        }
        return a.i - b.i;
      });
      return { items: indexed.map((x) => x.row), count: indexed.length };
    },
    group(inputs) {
      const items = rows(inputs);
      const by = strList(inputs, "group_by", { required: true });
      const aggs = parseAggregates(inputs);
      const groups = /* @__PURE__ */ new Map();
      for (const row of items) {
        const key = keyOf(row, by);
        const g = groups.get(key);
        if (g) g.push(row);
        else groups.set(key, [row]);
      }
      const out = [...groups.values()].map((g) => {
        const row = {};
        for (const f of by) setPath(row, f, getPath(g[0], f) ?? null);
        if (!aggs.some((a) => a.as === "count")) row.count = g.length;
        for (const a of aggs) row[a.as] = aggregate(g, a);
        return row;
      });
      return { groups: out, count: out.length };
    },
    pivot(inputs) {
      const items = rows(inputs);
      const rowFields = strList(inputs, "rows", { required: true });
      const column = str(inputs, "column", { required: true });
      const valueField = str(inputs, "value");
      const op = choice(inputs, "aggregate", ["sum", "count", "avg", "min", "max", "first", "last"], "sum");
      if (op !== "count" && !valueField) throw new Error(`value is required for ${op}`);
      const fill = inputs.fill === void 0 ? null : json(inputs, "fill");
      const columns = [];
      const table = /* @__PURE__ */ new Map();
      for (const row of items) {
        const raw = getPath(row, column);
        const col = isEmpty(raw) ? "(blank)" : asText(raw, true);
        if (!columns.includes(col)) columns.push(col);
        const key = keyOf(row, rowFields);
        let entry = table.get(key);
        if (!entry) {
          entry = { first: row, cells: /* @__PURE__ */ new Map() };
          table.set(key, entry);
        }
        const cell = entry.cells.get(col);
        if (cell) cell.push(row);
        else entry.cells.set(col, [row]);
      }
      const agg = { op, field: op === "count" ? "" : valueField, as: "v" };
      const out = [...table.values()].map(({ first, cells }) => {
        const row = {};
        for (const f of rowFields) setPath(row, f, getPath(first, f) ?? null);
        for (const col of columns) {
          const cell = cells.get(col);
          row[col] = cell ? aggregate(cell, agg) : fill;
        }
        return row;
      });
      return { items: out, columns, count: out.length };
    },
    unpivot(inputs) {
      const items = rows(inputs);
      const keep = strList(inputs, "keep_fields");
      const only = strList(inputs, "columns");
      const nameField = str(inputs, "name_field", { default: "name" });
      const valueField = str(inputs, "value_field", { default: "value" });
      const skipEmpty = bool(inputs, "skip_empty", false);
      if (nameField === valueField) throw new Error("name_field and value_field must differ");
      const out = [];
      for (const row of items) {
        const cols = only.length ? only : Object.keys(row).filter((k) => !keep.includes(k));
        for (const col of cols) {
          const v = getPath(row, col);
          if (skipEmpty && isEmpty(v)) continue;
          const next = {};
          for (const k of keep) setPath(next, k, getPath(row, k) ?? null);
          next[nameField] = col;
          next[valueField] = v === void 0 ? null : v;
          out.push(next);
        }
      }
      return { items: out, count: out.length };
    },
    dedupe(inputs) {
      const items = list(inputs, "items", { required: true });
      if (items.length > MAX_ITEMS) throw new Error(`items: at most ${MAX_ITEMS} items`);
      const fields = strList(inputs, "fields");
      const keep = choice(inputs, "keep", ["first", "last"], "first");
      const caseSensitive = bool(inputs, "case_sensitive", true);
      const keyFor = (item) => {
        if (fields.length && isPlainObject(item)) return keyOf(item, fields, caseSensitive);
        const s = JSON.stringify(item ?? null);
        return caseSensitive ? s : s.toLowerCase();
      };
      const seen = /* @__PURE__ */ new Map();
      items.forEach((item, i) => {
        const k = keyFor(item);
        if (keep === "last" || !seen.has(k)) seen.set(k, i);
      });
      const keepIdx = new Set(seen.values());
      const out = items.filter((_, i) => keepIdx.has(i));
      return { items: out, count: out.length, removed: items.length - out.length };
    },
    join(inputs) {
      const left = rows(inputs, "left");
      const right = rows(inputs, "right");
      const leftKeys = strList(inputs, "left_key", { required: true });
      const rightKeysRaw = strList(inputs, "right_key");
      const rightKeys = rightKeysRaw.length ? rightKeysRaw : leftKeys;
      if (leftKeys.length !== rightKeys.length) throw new Error("left_key and right_key must name the same number of fields");
      const type = choice(inputs, "type", ["inner", "left", "right", "full"], "inner");
      const prefix = str(inputs, "right_prefix");
      const caseSensitive = bool(inputs, "case_sensitive", true);
      const norm = (row, keys) => JSON.stringify(keys.map((k) => {
        const v = getPath(row, k);
        if (v === null || v === void 0) return null;
        const s = typeof v === "number" ? String(v) : asText(v, caseSensitive);
        return s;
      }));
      const index = /* @__PURE__ */ new Map();
      right.forEach((r, i) => {
        const k = norm(r, rightKeys);
        const list2 = index.get(k);
        if (list2) list2.push(i);
        else index.set(k, [i]);
      });
      const leftFields = /* @__PURE__ */ new Set();
      for (const l of left) for (const k of Object.keys(l)) leftFields.add(k);
      const merge = (l, r) => {
        const out2 = l ? { ...l } : {};
        if (!l && r) rightKeys.forEach((rk, i) => {
          out2[leftKeys[i]] = getPath(r, rk) ?? null;
        });
        if (r) {
          for (const [k, v] of Object.entries(r)) {
            if (!prefix && rightKeys.includes(k) && leftKeys[rightKeys.indexOf(k)] === k) continue;
            const name = prefix ? `${prefix}${k}` : leftFields.has(k) ? `right_${k}` : k;
            out2[name] = v;
          }
        }
        return out2;
      };
      const out = [];
      const usedRight = /* @__PURE__ */ new Set();
      let unmatchedLeft = 0;
      for (const l of left) {
        const k = norm(l, leftKeys);
        const hasKey = !JSON.parse(k).every((v) => v === null);
        const matches = hasKey ? index.get(k) ?? [] : [];
        if (matches.length) {
          for (const i of matches) {
            usedRight.add(i);
            out.push(merge(l, right[i]));
          }
        } else {
          unmatchedLeft++;
          if (type === "left" || type === "full") out.push(merge(l, null));
        }
      }
      const unmatchedRight = right.length - usedRight.size;
      if (type === "right" || type === "full") {
        right.forEach((r, i) => {
          if (!usedRight.has(i)) out.push(merge(null, r));
        });
      }
      return { items: out, count: out.length, unmatched_left: unmatchedLeft, unmatched_right: unmatchedRight };
    },
    csv_to_json(inputs) {
      const csv = text(inputs, "csv", { required: true, max: 5e6 });
      const rawDelim = str(inputs, "delimiter", { default: "auto", trim: false });
      const named = { auto: "", comma: ",", semicolon: ";", tab: "	", "\\t": "	", pipe: "|" };
      let delimiter = rawDelim in named ? named[rawDelim] : rawDelim;
      if (!delimiter) delimiter = sniffDelimiter(csv);
      if (delimiter.length > 3 || /["\r\n]/.test(delimiter)) throw new Error("delimiter must be 1–3 characters other than quotes and line breaks");
      const header = bool(inputs, "header", true);
      const infer = bool(inputs, "infer_types", true);
      const trim = bool(inputs, "trim", true);
      let table = parseCsv(csv, delimiter);
      table = table.filter((r) => !(r.length === 1 && r[0].trim() === ""));
      if (table.length > MAX_ITEMS + 1) throw new Error(`The CSV has more than ${MAX_ITEMS} rows`);
      const width = table.reduce((w, r) => Math.max(w, r.length), 0);
      let columns;
      if (header && table.length) {
        const seen = /* @__PURE__ */ new Map();
        columns = Array.from({ length: width }, (_, i) => {
          let name = (table[0][i] ?? "").trim() || `column_${i + 1}`;
          const n = seen.get(name) ?? 0;
          seen.set(name, n + 1);
          if (n) name = `${name}_${n + 1}`;
          return name;
        });
        table = table.slice(1);
      } else {
        columns = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
      }
      const items = table.map((r) => {
        const row = {};
        columns.forEach((c, i) => {
          let cell = r[i] ?? "";
          if (trim) cell = cell.trim();
          row[c] = infer ? inferValue(cell) : cell;
        });
        return row;
      });
      return { items, columns, count: items.length };
    },
    json_to_csv(inputs) {
      const items = rows(inputs);
      const delimiterRaw = str(inputs, "delimiter", { default: ",", trim: false });
      const delimiter = delimiterRaw === "tab" || delimiterRaw === "\\t" ? "	" : delimiterRaw;
      if (!delimiter || delimiter.length > 3 || /["\r\n]/.test(delimiter)) throw new Error("delimiter must be 1–3 characters other than quotes and line breaks");
      const header = bool(inputs, "header", true);
      const eol = choice(inputs, "line_ending", ["crlf", "lf"], "crlf") === "crlf" ? "\r\n" : "\n";
      const escapeFormulas = bool(inputs, "escape_formulas", true);
      const specs = strList(inputs, "columns").map((c) => {
        const m = /^\s*(.+?)\s+as\s+(.+?)\s*$/i.exec(c);
        return m ? { field: m[1], title: m[2] } : { field: c, title: c };
      });
      if (!specs.length) {
        const seen = [];
        for (const row of items) for (const k of Object.keys(row)) if (!seen.includes(k)) seen.push(k);
        specs.push(...seen.map((k) => ({ field: k, title: k })));
      }
      const lines = [];
      if (header) lines.push(specs.map((s) => csvField(s.title, delimiter, false)).join(delimiter));
      for (const row of items) lines.push(specs.map((s) => csvField(getPath(row, s.field), delimiter, escapeFormulas)).join(delimiter));
      return { csv: lines.length ? lines.join(eol) + eol : "", columns: specs.map((s) => s.title), count: items.length };
    }
  }
});
export {
  action_default as default
};
