/**
 * ut_text — Text toolkit: slugs, case conversion, templates, truncation,
 * extraction, fuzzy matching, counts and masking. Pure computation.
 */

import { defineAction } from '@usertasks/action'
import { bool, choice, getPath, isPlainObject, list, num, obj, str, text, type Inputs } from '../../shared/inputs'
import { jaroWinkler, levenshtein } from './similarity'

const MAX_TEXT = 1_000_000

// ── Words ───────────────────────────────────────────────────────────────────

const SPECIAL_LATIN: Record<string, string> = {
  ß: 'ss', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', þ: 'th', Þ: 'TH', ð: 'd', Ð: 'D', ı: 'i',
}

/** Strip accents (é → e) and spell out a few letters NFKD does not decompose. */
function asciiFold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ßæÆœŒøØđĐłŁþÞðÐı]/g, (ch) => SPECIAL_LATIN[ch] ?? ch)
}

/** Split identifiers and phrases into words: "parseHTTPResponse v2" → parse, HTTP, Response, v2. */
function words(s: string): string[] {
  return s
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)

const MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'off', 'on', 'per', 'to', 'up', 'via', 'with', 'from', 'into', 'over'])

function titleCase(s: string): string {
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu
  const matches = [...s.matchAll(re)]
  let out = ''
  let last = 0
  matches.forEach((m, i) => {
    const w = m[0]
    const lower = w.toLowerCase()
    const first = i === 0
    const final = i === matches.length - 1
    // Keep acronyms (NASA, HR) and minor words in the middle of a title.
    const next = w.length > 1 && w === w.toUpperCase() && /\p{Lu}/u.test(w) ? w : !first && !final && MINOR_WORDS.has(lower) ? lower : cap(w)
    out += s.slice(last, m.index) + next
    last = m.index! + w.length
  })
  return out + s.slice(last)
}

function sentenceCase(s: string): string {
  let start = true
  let out = ''
  for (const ch of s.toLowerCase()) {
    if (start && /\p{L}/u.test(ch)) {
      out += ch.toUpperCase()
      start = false
    } else {
      out += ch
      if (/[.!?]/.test(ch)) start = true
      else if (/\p{N}/u.test(ch)) start = false
    }
  }
  return out.replace(/\bi\b/g, 'I')
}

const CASES = ['camel', 'pascal', 'snake', 'kebab', 'constant', 'title', 'sentence', 'upper', 'lower'] as const

function changeCase(s: string, kind: (typeof CASES)[number]): string {
  const ws = words(s)
  switch (kind) {
    case 'camel': return ws.map((w, i) => (i === 0 ? w.toLowerCase() : cap(w))).join('')
    case 'pascal': return ws.map(cap).join('')
    case 'snake': return ws.map((w) => w.toLowerCase()).join('_')
    case 'kebab': return ws.map((w) => w.toLowerCase()).join('-')
    case 'constant': return ws.map((w) => w.toUpperCase()).join('_')
    case 'title': return titleCase(s)
    case 'sentence': return sentenceCase(s)
    case 'upper': return s.toUpperCase()
    case 'lower': return s.toLowerCase()
  }
}

// ── Template ────────────────────────────────────────────────────────────────

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

// ── Operations ──────────────────────────────────────────────────────────────

export default defineAction({
  operations: {
    slugify(inputs: Inputs) {
      const value = text(inputs, 'text', { required: true, max: MAX_TEXT })
      const separator = str(inputs, 'separator', { default: '-', trim: false })
      if (separator.length > 3 || /[\p{L}\p{N}]/u.test(separator)) throw new Error('separator must be up to 3 punctuation characters (e.g. - or _)')
      const lowercase = bool(inputs, 'lowercase', true)
      const maxLength = num(inputs, 'max_length', { integer: true, min: 0, max: 1000, default: 0 })
      let folded = asciiFold(value).replace(/&/g, ' and ').replace(/[''’]/g, '')
      if (lowercase) folded = folded.toLowerCase()
      let slug = folded.split(/[^A-Za-z0-9]+/).filter(Boolean).join(separator)
      if (maxLength > 0 && slug.length > maxLength) {
        slug = slug.slice(0, maxLength)
        // Cut at a separator rather than mid-word when one is close.
        const cut = separator ? slug.lastIndexOf(separator) : -1
        if (cut > maxLength / 2) slug = slug.slice(0, cut)
        while (separator && slug.endsWith(separator)) slug = slug.slice(0, -separator.length)
      }
      return { slug }
    },

    change_case(inputs: Inputs) {
      const value = text(inputs, 'text', { max: MAX_TEXT })
      const kind = choice(inputs, 'case', CASES, 'snake')
      return { result: changeCase(value, kind) }
    },

    template(inputs: Inputs) {
      const template = text(inputs, 'template', { required: true, max: MAX_TEXT })
      const data = obj(inputs, 'data')
      const missingMode = choice(inputs, 'missing', ['keep', 'blank', 'error'] as const, 'keep')
      const missing: string[] = []
      let replaced = 0
      const result = template.replace(/\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g, (whole, path: string, fallback: string | undefined) => {
        const value = getPath(data, path)
        if (value === undefined || value === null || value === '') {
          if (fallback !== undefined) {
            replaced++
            return fallback
          }
          if (value === undefined) {
            if (!missing.includes(path)) missing.push(path)
            if (missingMode === 'keep') return whole
            return ''
          }
          replaced++
          return ''
        }
        replaced++
        return stringify(value)
      })
      if (missingMode === 'error' && missing.length) throw new Error(`No value for ${missing.map((m) => `{{${m}}}`).join(', ')}`)
      return { result, missing, replaced }
    },

    truncate(inputs: Inputs) {
      const value = text(inputs, 'text', { max: MAX_TEXT })
      const length = num(inputs, 'length', { integer: true, min: 1, max: 1_000_000 })
      const by = choice(inputs, 'by', ['chars', 'words'] as const, 'chars')
      const rawEllipsis = inputs.ellipsis === undefined || inputs.ellipsis === null ? '…' : String(inputs.ellipsis)
      const ellipsis = rawEllipsis.trim().toLowerCase() === 'none' ? '' : rawEllipsis
      const preserveWords = bool(inputs, 'preserve_words', true)
      if (by === 'words') {
        const tokens = value.trim().split(/\s+/).filter(Boolean)
        if (tokens.length <= length) return { result: value, truncated: false }
        return { result: tokens.slice(0, length).join(' ').replace(/[\s,;:.\-\u2013\u2014]+$/u, '') + ellipsis, truncated: true }
      }
      const chars = Array.from(value)
      if (chars.length <= length) return { result: value, truncated: false }
      const room = Math.max(0, length - Array.from(ellipsis).length)
      let cut = chars.slice(0, room).join('')
      if (preserveWords && room > 0 && /[\p{L}\p{N}]/u.test(chars[room] ?? '')) {
        const space = cut.search(/\s\S*$/)
        if (space > room / 2) cut = cut.slice(0, space)
      }
      cut = cut.replace(/[\s,;:.\-\u2013\u2014]+$/u, '')
      return { result: cut + ellipsis, truncated: true }
    },

    extract_between(inputs: Inputs) {
      const value = text(inputs, 'text', { max: MAX_TEXT })
      const start = str(inputs, 'start', { trim: false })
      const end = str(inputs, 'end', { trim: false })
      if (!start && !end) throw new Error('Set a start marker, an end marker or both')
      const all = bool(inputs, 'all', false)
      const includeMarkers = bool(inputs, 'include_markers', false)
      const caseSensitive = bool(inputs, 'case_sensitive', true)
      const trim = bool(inputs, 'trim', true)
      const hay = caseSensitive ? value : value.toLowerCase()
      const s = caseSensitive ? start : start.toLowerCase()
      const e = caseSensitive ? end : end.toLowerCase()
      const matches: string[] = []
      let from = 0
      while (from <= value.length) {
        const i = s ? hay.indexOf(s, from) : from
        if (i < 0) break
        const contentStart = i + s.length
        const j = e ? hay.indexOf(e, contentStart) : value.length
        if (j < 0) break
        let m = includeMarkers ? value.slice(i, j + e.length) : value.slice(contentStart, j)
        if (trim) m = m.trim()
        matches.push(m)
        if (!all || !s) break
        from = j + Math.max(e.length, 1)
      }
      return { value: matches[0] ?? '', matches, count: matches.length, found: matches.length > 0 }
    },

    similarity(inputs: Inputs) {
      const caseSensitive = bool(inputs, 'case_sensitive', false)
      const norm = (s: string) => {
        const t = s.trim().replace(/\s+/g, ' ')
        return caseSensitive ? t : t.toLowerCase()
      }
      const a = norm(text(inputs, 'value', { required: true, max: 10_000 }))
      const bRaw = inputs.compare_to
      const hasB = bRaw !== undefined && bRaw !== null && String(bRaw) !== ''
      const candidates = list(inputs, 'candidates').map((c) => (isPlainObject(c) || Array.isArray(c) ? JSON.stringify(c) : String(c ?? '')))
      if (!hasB && candidates.length === 0) throw new Error('Set compare_to, candidates or both')
      if (candidates.length > 10_000) throw new Error('candidates: at most 10,000 entries')
      const threshold = num(inputs, 'threshold', { min: 0, max: 1, default: 0.8 })
      const method = choice(inputs, 'method', ['jaro_winkler', 'levenshtein'] as const, 'jaro_winkler')
      const levSim = (x: string, y: string) => {
        const max = Math.max(Array.from(x).length, Array.from(y).length)
        return max === 0 ? 1 : 1 - levenshtein(x, y) / max
      }
      const score = (x: string, y: string) => (method === 'levenshtein' ? levSim(x, y) : jaroWinkler(x, y))
      const r4 = (n: number) => Math.round(n * 10000) / 10000
      let distance: number | null = null
      let similarity: number | null = null
      let jw: number | null = null
      if (hasB) {
        const b = norm(String(bRaw))
        if (b.length > 10_000) throw new Error('compare_to is longer than 10,000 characters')
        distance = levenshtein(a, b)
        similarity = r4(levSim(a, b))
        jw = r4(jaroWinkler(a, b))
      }
      let bestIndex = -1
      let bestScore = 0
      candidates.forEach((c, i) => {
        const sc = score(a, norm(c))
        if (sc > bestScore) { bestScore = sc; bestIndex = i }
      })
      const pairScore = hasB ? (method === 'levenshtein' ? similarity! : jw!) : 0
      const matched = candidates.length ? bestScore >= threshold : pairScore >= threshold
      return {
        distance,
        similarity,
        jaro_winkler: jw,
        best_match: bestIndex >= 0 ? candidates[bestIndex] : null,
        best_score: candidates.length ? r4(bestScore) : null,
        best_index: bestIndex,
        matched,
      }
    },

    word_count(inputs: Inputs) {
      const value = text(inputs, 'text', { max: MAX_TEXT })
      const wpm = num(inputs, 'words_per_minute', { integer: true, min: 50, max: 1000, default: 200 })
      const wordMatches = value.match(/[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu) ?? []
      const chars = Array.from(value)
      const sentences = value.split(/(?<=[.!?…])\s+|\n\s*\n/u).filter((s) => /[\p{L}\p{N}]/u.test(s)).length
      const paragraphs = value.split(/\r?\n\s*\r?\n/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length
      return {
        words: wordMatches.length,
        characters: chars.length,
        characters_no_spaces: chars.filter((c) => !/\s/u.test(c)).length,
        sentences,
        paragraphs,
        reading_minutes: wordMatches.length === 0 ? 0 : Math.max(1, Math.ceil(wordMatches.length / wpm)),
      }
    },

    mask(inputs: Inputs) {
      const value = text(inputs, 'value', { max: 100_000 })
      const mode = choice(inputs, 'mode', ['keep_last', 'keep_first', 'email', 'all'] as const, 'keep_last')
      const keep = num(inputs, 'keep', { integer: true, min: 0, max: 1000, default: 4 })
      const maskChar = Array.from(str(inputs, 'mask_char', { default: '*', trim: false }))[0] ?? '*'
      const preserve = bool(inputs, 'preserve_separators', true)
      const isSep = (c: string) => preserve && /[\s\-./()+]/.test(c)
      const maskRun = (chars: string[], keepFirst: number, keepLast: number) => {
        const idx = chars.map((c, i) => (isSep(c) ? -1 : i)).filter((i) => i >= 0)
        const keepSet = new Set([...idx.slice(0, keepFirst), ...(keepLast > 0 ? idx.slice(-keepLast) : [])])
        // Never reveal everything: keep at most half of the maskable characters.
        if (keepSet.size >= idx.length && idx.length > 0) {
          keepSet.clear()
          const half = Math.floor(idx.length / 2)
          const kept = keepFirst > 0 ? idx.slice(0, half) : half > 0 ? idx.slice(-half) : []
          for (const i of kept) keepSet.add(i)
        }
        return chars.map((c, i) => (isSep(c) || keepSet.has(i) ? c : maskChar)).join('')
      }
      if (mode === 'email') {
        const at = value.lastIndexOf('@')
        if (at <= 0) throw new Error('value is not an email address')
        const local = Array.from(value.slice(0, at))
        const masked = local.length <= 1 ? maskChar : local[0] + maskChar.repeat(Math.max(3, local.length - 1))
        return { masked: masked + value.slice(at) }
      }
      const chars = Array.from(value)
      if (mode === 'all') return { masked: chars.map((c) => (isSep(c) ? c : maskChar)).join('') }
      return { masked: mode === 'keep_last' ? maskRun(chars, 0, keep) : maskRun(chars, keep, 0) }
    },
  },
})
