/*! UserTasks action ut_dates 1.0.0 */

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

// gallery/actions/date-business-calendar/src/calendar.ts
var DAY_MS = 864e5;
var WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
var dayNumber = ({ y, m, d }) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
function fromDayNumber(n) {
  const t = new Date(n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
var pad = (n, w = 2) => String(n).padStart(w, "0");
var isoDate = ({ y, m, d }) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
var isoDay = (n) => isoDate(fromDayNumber(n));
var isoWeekday = (n) => ((n + 3) % 7 + 7) % 7 + 1;
var daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function parseYmd(raw, name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) throw new Error(`${name} must be a date (YYYY-MM-DD), got "${raw.slice(0, 40)}"`);
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) throw new Error(`${name} is not a real date (${m[0]})`);
  return ymd;
}
function addMonths({ y, m, d }, months, day = d) {
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return { y: ny, m: nm, d: Math.min(day, daysInMonth(ny, nm)) };
}
var DAY_ALIASES = {
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7
};
function parseWeekday(raw, name) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (/^\d$/.test(s)) {
    const n = Number(s);
    if (n === 0 || n === 7) return 7;
    if (n >= 1 && n <= 6) return n;
  }
  const hit = DAY_ALIASES[s];
  if (!hit) throw new Error(`${name}: "${String(raw).slice(0, 20)}" is not a weekday (use Monday … Sunday)`);
  return hit;
}
function weekdaySet(inputs, name, dflt) {
  const raw = list(inputs, name);
  if (raw.length === 0) return new Set(dflt);
  return new Set(raw.map((v) => parseWeekday(v, name)));
}
function holidaySet(inputs, name = "holidays") {
  const out = /* @__PURE__ */ new Set();
  list(inputs, name).forEach((entry, i) => {
    if (isBlank(entry)) return;
    const raw = isPlainObject(entry) ? String(entry.date ?? "") : String(entry);
    out.add(dayNumber(parseYmd(raw, `${name}[${i}]`)));
  });
  return out;
}
function parseWorkingHours(raw) {
  const m = /^(\d{1,2}):(\d{2})\s*[-\u2013to]+\s*(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) throw new Error(`working_hours must look like 09:00-17:00 (got "${raw.slice(0, 30)}")`);
  const start = Number(m[1]) * 3600 + Number(m[2]) * 60;
  const end = Number(m[3]) * 3600 + Number(m[4]) * 60;
  if (Number(m[2]) > 59 || Number(m[4]) > 59 || start > 86400 || end > 86400 || start >= end) {
    throw new Error(`working_hours must be a start time before an end time within one day (got "${raw.slice(0, 30)}")`);
  }
  return [start, end];
}
function parseTimeOfDay(raw, name) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3] ?? 0) > 59) throw new Error(`${name} must be a time like 09:00 (got "${raw.slice(0, 20)}")`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}
function hms(seconds) {
  const s = Math.round(seconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
}
function offsetText(minutes) {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

// gallery/actions/date-business-calendar/src/action.ts
var MON_FRI = [1, 2, 3, 4, 5];
var SAT_SUN = [6, 7];
function zone(inputs, name = "time_zone") {
  return str(inputs, name, { default: "UTC" });
}
function localToUtc(ctx, day, sec, tz) {
  const extra = Math.floor(sec / 86400);
  const s = sec - extra * 86400;
  const local = `${isoDay(day + extra)}T${hms(s)}`;
  return Date.parse(ctx.intl.zonedToUtc(local, tz));
}
function momentOf(ctx, t, tz, dateOnly = false) {
  const p = ctx.intl.zonedParts(new Date(t).toISOString(), tz);
  return { t, day: dayNumber({ y: p.year, m: p.month, d: p.day }), sec: p.hour * 3600 + p.minute * 60 + p.second, offset: p.offset_minutes, dateOnly };
}
function parseMoment(ctx, raw, name, tz) {
  const s = raw.trim();
  if (!s) throw new Error(`${name} is required`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const day2 = dayNumber(parseYmd(s, name));
    return { ...momentOf(ctx, localToUtc(ctx, day2, 0, tz), tz), dateOnly: true };
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (!m) throw new Error(`${name} must be a date (YYYY-MM-DD) or date-time (ISO 8601, e.g. 2026-11-02T09:30:00Z), got "${s.slice(0, 40)}"`);
  parseYmd(m[1], name);
  if (Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59) throw new Error(`${name} has an invalid time`);
  if (m[5]) {
    const t = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (Number.isNaN(t)) throw new Error(`${name} is not a valid date-time`);
    return momentOf(ctx, t, tz);
  }
  const day = dayNumber(parseYmd(m[1], name));
  const sec = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0);
  return momentOf(ctx, localToUtc(ctx, day, sec, tz), tz);
}
function nowOrInput(ctx, inputs, name, tz) {
  const raw = str(inputs, name);
  return raw ? parseMoment(ctx, raw, name, tz) : momentOf(ctx, Date.now(), tz);
}
var iso = (t) => new Date(t).toISOString();
var localIso = (ctx, t, tz) => ctx.intl.zonedParts(iso(t), tz).iso;
function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
var action_default = defineAction({
  operations: {
    add_business_days(inputs) {
      const start = dayNumber(parseYmd(str(inputs, "date", { required: true }), "date"));
      const days = num(inputs, "days", { integer: true, min: -1e4, max: 1e4 });
      const weekend = weekdaySet(inputs, "weekend_days", SAT_SUN);
      if (weekend.size >= 7) throw new Error("weekend_days cannot be every day of the week");
      const holidays = holidaySet(inputs);
      const isBusiness = (n) => !weekend.has(isoWeekday(n)) && !holidays.has(n);
      let cur = start;
      const step = days < 0 ? -1 : 1;
      let remaining = Math.abs(days);
      let guard = 0;
      if (days === 0) {
        while (!isBusiness(cur)) {
          cur++;
          if (++guard > 3700) throw new Error("No business day within 10 years (check weekend_days and holidays)");
        }
      }
      while (remaining > 0) {
        cur += step;
        if (isBusiness(cur)) remaining--;
        if (++guard > 4e5) throw new Error("Too many holidays: no business days found");
      }
      return { date: isoDay(cur), weekday: WEEKDAY_NAMES[isoWeekday(cur) - 1], calendar_days: cur - start };
    },
    sla_due(inputs, ctx) {
      const tz = zone(inputs);
      const start = parseMoment(ctx, str(inputs, "start", { required: true }), "start", tz);
      const hours = num(inputs, "hours", { min: 0, max: 1e5 });
      const [ws, we] = parseWorkingHours(str(inputs, "working_hours", { default: "09:00-17:00" }));
      const workdays = weekdaySet(inputs, "working_days", MON_FRI);
      const holidays = holidaySet(inputs);
      let remaining = Math.round(hours * 3600);
      let day = start.day;
      let sec = start.sec;
      let guard = 0;
      for (; ; ) {
        if (workdays.has(isoWeekday(day)) && !holidays.has(day)) {
          if (sec < ws) sec = ws;
          if (sec < we) {
            const available = we - sec;
            if (remaining <= available) {
              sec += remaining;
              break;
            }
            remaining -= available;
          }
        }
        day++;
        sec = 0;
        if (++guard > 3700) throw new Error("No working time within 10 years (check working_days, working_hours and holidays)");
      }
      const due = localToUtc(ctx, day, sec, tz);
      const local = momentOf(ctx, due, tz);
      return {
        due: iso(due),
        due_local: localIso(ctx, due, tz),
        due_date: isoDay(local.day),
        start_local: localIso(ctx, start.t, tz),
        calendar_hours: Math.round((due - start.t) / 36e3) / 100
      };
    },
    duration(inputs, ctx) {
      const tz = zone(inputs);
      const a = parseMoment(ctx, str(inputs, "from", { required: true }), "from", tz);
      const b = nowOrInput(ctx, inputs, "to", tz);
      const weekend = weekdaySet(inputs, "weekend_days", SAT_SUN);
      const holidays = holidaySet(inputs);
      const sign = b.t < a.t ? -1 : 1;
      const [lo, hi] = sign < 0 ? [b, a] : [a, b];
      const elapsedMs = hi.t - lo.t;
      let toDay = hi.day;
      let rem = hi.sec - lo.sec;
      if (rem < 0) {
        toDay -= 1;
        rem += 86400;
      }
      const loYmd = fromDayNumber(lo.day);
      const toYmd = fromDayNumber(toDay);
      let months = (toYmd.y - loYmd.y) * 12 + (toYmd.m - loYmd.m);
      if (dayNumber(addMonths(loYmd, months)) > toDay) months -= 1;
      const afterMonths = dayNumber(addMonths(loYmd, months));
      const years = Math.floor(months / 12);
      const restMonths = months % 12;
      const restDays = toDay - afterMonths;
      const remHours = Math.floor(rem / 3600);
      const remMinutes = Math.floor(rem % 3600 / 60);
      let business = 0;
      for (let d = lo.day + 1; d <= hi.day; d++) {
        if (!weekend.has(isoWeekday(d)) && !holidays.has(d)) business++;
        if (d - lo.day > 4e5) throw new Error("The dates are too far apart");
      }
      const parts = [[years, "year"], [restMonths, "month"], [restDays, "day"], [remHours, "hour"], [remMinutes, "minute"]];
      const shown = parts.filter(([n]) => n > 0).slice(0, 3).map(([n, u]) => plural(n, u));
      const human = (sign < 0 && shown.length ? "-" : "") + (shown.length ? shown.join(", ") : "0 minutes");
      const s = (n) => n === 0 ? 0 : sign * n;
      return {
        days: s(toDay - lo.day),
        business_days: s(business),
        hours: s(Math.round(elapsedMs / 36e3) / 100),
        minutes: s(Math.floor(elapsedMs / 6e4)),
        human,
        age_years: s(years),
        age_months: s(restMonths),
        age_days: s(restDays)
      };
    },
    convert_timezone(inputs, ctx) {
      const fromZone = zone(inputs, "from_zone");
      const toZone = str(inputs, "to_zone", { required: true });
      const m = parseMoment(ctx, str(inputs, "datetime", { required: true }), "datetime", fromZone);
      const p = ctx.intl.zonedParts(iso(m.t), toZone);
      return {
        iso: iso(m.t),
        local: p.iso,
        local_date: p.iso.slice(0, 10),
        local_time: p.iso.slice(11, 16),
        weekday: WEEKDAY_NAMES[isoWeekday(dayNumber({ y: p.year, m: p.month, d: p.day })) - 1],
        offset: offsetText(p.offset_minutes),
        offset_minutes: p.offset_minutes
      };
    },
    next_occurrence(inputs, ctx) {
      const tz = zone(inputs);
      const frequency = choice(inputs, "frequency", ["daily", "weekly", "monthly", "yearly"], "weekly");
      const interval = num(inputs, "interval", { integer: true, min: 1, max: 1e3, default: 1 });
      const count = num(inputs, "count", { integer: true, min: 1, max: 100, default: 5 });
      const time = parseTimeOfDay(str(inputs, "time", { default: "09:00" }), "time");
      const after = nowOrInput(ctx, inputs, "after", tz);
      const startRaw = str(inputs, "start");
      const anchor = startRaw ? dayNumber(parseYmd(startRaw, "start")) : after.day;
      const anchorYmd = fromDayNumber(anchor);
      const excluded = holidaySet(inputs, "exclude_dates");
      const daysOfWeek = frequency === "weekly" ? weekdaySet(inputs, "days_of_week", [isoWeekday(anchor)]) : /* @__PURE__ */ new Set();
      const nthRaw = choice(inputs, "nth_week", ["none", "first", "second", "third", "fourth", "last"], "none");
      const nth = nthRaw !== "none" ? nthRaw === "last" ? -1 : ["first", "second", "third", "fourth"].indexOf(nthRaw) + 1 : 0;
      const nthWeekday = nth ? parseWeekday(str(inputs, "weekday", { required: true }), "weekday") : 0;
      const dom = optNum(inputs, "day_of_month", { integer: true, min: -1, max: 31 }) ?? anchorYmd.d;
      if (dom === 0) throw new Error("day_of_month must be 1–31, or -1 for the last day");
      const month = optNum(inputs, "month", { integer: true, min: 1, max: 12 }) ?? anchorYmd.m;
      const mondayOf = (n) => n - (isoWeekday(n) - 1);
      const dayMatches = (ymd, n) => {
        if (nth) {
          if (isoWeekday(n) !== nthWeekday) return false;
          if (nth > 0) return Math.ceil(ymd.d / 7) === nth;
          return ymd.d + 7 > daysInMonth(ymd.y, ymd.m);
        }
        const last = daysInMonth(ymd.y, ymd.m);
        return ymd.d === (dom === -1 ? last : Math.min(dom, last));
      };
      const matches = (n) => {
        if (n < anchor) return false;
        const ymd = fromDayNumber(n);
        switch (frequency) {
          case "daily":
            return (n - anchor) % interval === 0;
          case "weekly":
            return daysOfWeek.has(isoWeekday(n)) && (mondayOf(n) - mondayOf(anchor)) / 7 % interval === 0;
          case "monthly":
            return ((ymd.y - anchorYmd.y) * 12 + (ymd.m - anchorYmd.m)) % interval === 0 && dayMatches(ymd, n);
          case "yearly":
            return ymd.m === month && (ymd.y - anchorYmd.y) % interval === 0 && dayMatches(ymd, n);
        }
      };
      const occurrences = [];
      const local = [];
      const limit = 366 * 200;
      for (let n = Math.max(anchor, after.day), i = 0; occurrences.length < count && i < limit; n++, i++) {
        if (excluded.has(n) || !matches(n)) continue;
        const t = localToUtc(ctx, n, time, tz);
        if (t <= after.t) continue;
        occurrences.push(iso(t));
        local.push(localIso(ctx, t, tz));
      }
      return { next: occurrences[0] ?? null, next_local: local[0] ?? null, occurrences, occurrences_local: local };
    },
    fiscal_period(inputs, ctx) {
      const raw = str(inputs, "date");
      const ymd = raw ? parseYmd(raw, "date") : fromDayNumber(momentOf(ctx, Date.now(), zone(inputs)).day);
      const startMonth = num(inputs, "start_month", { integer: true, min: 1, max: 12, default: 7 });
      const naming = choice(inputs, "year_naming", ["end", "start"], "end");
      const offset = (ymd.m - startMonth + 12) % 12;
      const startYear = ymd.m >= startMonth ? ymd.y : ymd.y - 1;
      const fiscalYear = startMonth === 1 ? ymd.y : naming === "end" ? startYear + 1 : startYear;
      const quarter = Math.floor(offset / 3) + 1;
      const yearStart = { y: startYear, m: startMonth, d: 1 };
      const monthStart = (k) => dayNumber(addMonths(yearStart, k, 1));
      const today = dayNumber(ymd);
      return {
        fiscal_year: fiscalYear,
        quarter,
        period: offset + 1,
        label: `FY${fiscalYear} Q${quarter}`,
        period_label: `FY${fiscalYear} P${String(offset + 1).padStart(2, "0")}`,
        period_start: isoDay(monthStart(offset)),
        period_end: isoDay(monthStart(offset + 1) - 1),
        quarter_start: isoDay(monthStart((quarter - 1) * 3)),
        quarter_end: isoDay(monthStart(quarter * 3) - 1),
        year_start: isoDay(monthStart(0)),
        year_end: isoDay(monthStart(12) - 1),
        day_of_year: today - monthStart(0) + 1
      };
    }
  }
});
export {
  action_default as default
};
