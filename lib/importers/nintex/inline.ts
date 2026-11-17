/**
 * Nintex inline functions (`fn-Replace(…)`, `fn-FormatDate(…)` …) → native
 * UserTasks expressions (`{{=REPLACE(…)}}`, lib/expression-functions.ts).
 *
 * Nintex writes arguments as raw text separated by commas (no quotes),
 * possibly with inserted references ({WorkflowVariable:X}) and nested
 * functions. Each argument becomes a quoted literal, a {{reference}}, a
 * nested expression, or CONCAT(…) of those. Functions with no native
 * equivalent (fn-XPath …) are left as written and reported.
 */

type Fn = { name: string; args?: (args: string[]) => string[] | null }

/** .NET date format → FORMAT_DATE tokens (YYYY MM DD HH mm ss MMMM MMM dddd ddd). */
export function dotnetDateFormat(raw: string): { format: string; exact: boolean } {
  const std: Record<string, string> = { d: 'MM/dd/yyyy', D: 'dddd, MMMM dd, yyyy', f: 'dddd, MMMM dd, yyyy HH:mm', F: 'dddd, MMMM dd, yyyy HH:mm:ss', g: 'MM/dd/yyyy HH:mm', G: 'MM/dd/yyyy HH:mm:ss', M: 'MMMM dd', m: 'MMMM dd', s: 'yyyy-MM-ddTHH:mm:ss', t: 'HH:mm', T: 'HH:mm:ss', y: 'MMMM yyyy', Y: 'MMMM yyyy', u: 'yyyy-MM-dd HH:mm:ssZ' }
  const f = std[raw.trim()] ?? raw
  let exact = !std[raw.trim()] || ['s', 't', 'T'].includes(raw.trim())
  const out = f.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|fff|ff|f|K|zzz|zz|z/g, (tok) => {
    switch (tok) {
      case 'yyyy': return 'YYYY'
      case 'MMMM': case 'MMM': case 'MM': case 'dddd': case 'ddd': case 'HH': case 'mm': case 'ss': return tok
      case 'dd': return 'DD'
      case 'd': exact = false; return 'DD'
      case 'M': exact = false; return 'MM'
      case 'H': case 'hh': case 'h': exact = false; return 'HH'
      case 'm': exact = false; return 'mm'
      case 's': exact = false; return 'ss'
      case 'yy': exact = false; return 'YYYY'
      default: exact = false; return ''
    }
  })
  return { format: out, exact }
}

const FUNCTIONS: Record<string, Fn> = {
  replace: { name: 'REPLACE' }, trim: { name: 'TRIM' }, length: { name: 'LENGTH' }, toupper: { name: 'UPPER' }, tolower: { name: 'LOWER' },
  substring: { name: 'SUBSTRING' }, remove: { name: 'REMOVE' }, insert: { name: 'INSERT' }, padleft: { name: 'PAD_LEFT' }, padright: { name: 'PAD_RIGHT' },
  isnullorempty: { name: 'IS_EMPTY' }, xmldecode: { name: 'XML_DECODE' }, xmlencode: { name: 'XML_ENCODE' }, htmldecode: { name: 'XML_DECODE' }, htmlencode: { name: 'XML_ENCODE' },
  currency: { name: 'FORMAT_CURRENCY' }, round: { name: 'ROUND' }, abs: { name: 'ABS' }, max: { name: 'MAX' }, min: { name: 'MIN' }, mod: { name: 'MOD' }, power: { name: 'POWER' },
  floor: { name: 'FLOOR' }, ceiling: { name: 'CEILING' }, sum: { name: 'SUM' }, average: { name: 'AVG' }, count: { name: 'COUNT' }, newguid: { name: 'GUID' }, if: { name: 'IF' },
  formatdate: { name: 'FORMAT_DATE' }, adddays: { name: 'ADD_DAYS' }, addmonths: { name: 'ADD_MONTHS' }, addyears: { name: 'ADD_YEARS' }, addhours: { name: 'ADD_HOURS' }, addminutes: { name: 'ADD_MINUTES' },
  datediffdays: { name: 'DATE_DIFF', args: (a) => [a[0], a[1], '"days"'] }, datediffhours: { name: 'DATE_DIFF', args: (a) => [a[0], a[1], '"hours"'] },
  datediffminutes: { name: 'DATE_DIFF', args: (a) => [a[0], a[1], '"minutes"'] }, datediffweeks: { name: 'DATE_DIFF', args: (a) => [a[0], a[1], '"weeks"'] },
  contains: { name: 'CONTAINS' }, startswith: { name: 'STARTS_WITH' }, endswith: { name: 'ENDS_WITH' }, titlecase: { name: 'PROPER' }, normalizespace: { name: 'NORMALIZE_SPACE' },
}

export interface InlineResult { text: string; translated: number; unsupported: string[]; approximate: string[] }

/** Split a function's argument text on top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0, brace = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === '{') brace++
    else if (ch === '}') brace--
    if (ch === ',' && depth === 0 && brace === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}

/** The index just after the parenthesis that closes the one at `open`, or -1. */
function closing(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') { depth--; if (depth === 0) return i + 1 }
  }
  return -1
}

/**
 * Translate every fn-…(…) in a Nintex text. `ref` turns one inserted
 * reference ({WorkflowVariable:X} …) into a UserTasks {{…}} reference.
 */
export function translateInline(text: string, ref: (token: string) => string): InlineResult {
  const res: InlineResult = { text: '', translated: 0, unsupported: [], approximate: [] }
  const quote = (s: string) => JSON.stringify(s)
  // One argument → an expression operand.
  const operand = (raw: string): string => {
    const parts: string[] = []
    let rest = raw
    while (rest.length) {
      const fn = /fn-([A-Za-z]+)\(/.exec(rest)
      const tok = /\{[A-Za-z]+:[^}]+\}/.exec(rest)
      const next = [fn, tok].filter(Boolean).sort((a, b) => a!.index - b!.index)[0]
      if (!next) { parts.push(quote(rest)); break }
      if (next.index > 0) parts.push(quote(rest.slice(0, next.index)))
      if (next === tok) {
        const r = ref(next[0])
        parts.push(/^\{\{[^{}]+\}\}$/.test(r) ? r : quote(r))
        rest = rest.slice(next.index + next[0].length)
      } else {
        const open = next.index + next[0].length - 1
        const end = closing(rest, open)
        if (end < 0) { parts.push(quote(rest.slice(next.index))); break }
        parts.push(call(next[1], rest.slice(open + 1, end - 1)) ?? quote(rest.slice(next.index, end)))
        rest = rest.slice(end)
      }
    }
    const trimmed = parts.filter((p) => p !== '""')
    return trimmed.length === 0 ? '""' : trimmed.length === 1 ? trimmed[0] : `CONCAT(${trimmed.join(', ')})`
  }
  const call = (name: string, argText: string): string | null => {
    const def = FUNCTIONS[name.toLowerCase()]
    if (!def) { res.unsupported.push(`fn-${name}`); return null }
    const args = argText.trim() === '' ? [] : splitArgs(argText)
    // Replace keeps spaces in its arguments (they may be what is replaced); others are trimmed.
    let ops = args.map((a) => operand(def.name === 'REPLACE' ? a : a.trim()))
    if (def.name === 'FORMAT_DATE' && args[1] !== undefined && !/\{|fn-/.test(args[1])) {
      const { format, exact } = dotnetDateFormat(args[1].trim())
      if (!exact) res.approximate.push(`fn-FormatDate format "${args[1].trim()}"`)
      ops = [ops[0], quote(format)]
    }
    if (def.args) ops = def.args(ops) ?? ops
    res.translated += 1
    return `${def.name}(${ops.join(', ')})`
  }
  let rest = text
  while (rest.length) {
    const m = /fn-([A-Za-z]+)\(/.exec(rest)
    if (!m) { res.text += rest; break }
    res.text += rest.slice(0, m.index)
    const open = m.index + m[0].length - 1
    const end = closing(rest, open)
    if (end < 0) { res.text += rest.slice(m.index); break }
    const expr = call(m[1], rest.slice(open + 1, end - 1))
    res.text += expr ? `{{=${expr}}}` : rest.slice(m.index, end)
    rest = rest.slice(end)
  }
  return res
}
