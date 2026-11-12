/**
 * A small build-time syntax highlighter for docs code blocks. Docs pages are
 * statically rendered, so this runs on the server and ships no client code;
 * the output is a list of tokens the CodeBlock renders as spans
 * (`.docs-tok-*` colours in components/docs/docs.css).
 *
 * It colours the languages the docs actually use (shell, JSON, TS/JS, SQL,
 * YAML, INI/.env, PowerShell, Python) with a handful of regex rules each,
 * tolerant of odd input: anything a rule does not match stays plain text.
 */

export type TokenKind = 'comment' | 'string' | 'number' | 'keyword' | 'key' | 'variable' | 'flag' | 'command' | 'punct' | 'literal'

export interface CodeToken {
  text: string
  kind?: TokenKind
}

type Rule = [RegExp, TokenKind | ((match: RegExpExecArray, atLineStart: boolean) => TokenKind | undefined)]

const STRING_DQ = /"(?:[^"\\\n]|\\.)*"?/y
const STRING_SQ = /'(?:[^'\\\n]|\\.)*'?/y
const NUMBER = /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/iy

const SHELL_RULES: Rule[] = [
  [/(?<=^|\s)#(?!!)[^\n]*/y, 'comment'],
  [STRING_SQ, 'string'],
  [/"(?:[^"\\]|\\.)*"?/y, 'string'],
  [/\$\{[^}\n]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$\(|\$[0-9@#?*!$-]/y, 'variable'],
  [/(?<=^|\s)--?[A-Za-z][\w-]*(?:=)?/y, 'flag'],
  [/\b(?:if|then|else|elif|fi|for|in|do|done|while|case|esac|export|function|return|local|sudo|set|unset)\b/y, 'keyword'],
  [/[A-Za-z_][A-Za-z0-9_]*(?==)/y, 'key'],
  [/[A-Za-z0-9_./~@:+-]+/y, (_match, atStart) => (atStart ? 'command' : undefined)],
  [/\|\||&&|[|;&<>\\]/y, 'punct'],
]

const JSON_RULES: Rule[] = [
  [/\/\/[^\n]*/y, 'comment'],
  [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, 'key'],
  [STRING_DQ, 'string'],
  [NUMBER, 'number'],
  [/\b(?:true|false|null)\b/y, 'literal'],
  [/[{}[\],:]/y, 'punct'],
]

const JS_RULES: Rule[] = [
  [/\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'comment'],
  [STRING_SQ, 'string'],
  [STRING_DQ, 'string'],
  [/`(?:[^`\\]|\\.)*`?/y, 'string'],
  [/\b(?:import|from|export|default|const|let|var|function|return|async|await|if|else|for|of|in|new|try|catch|finally|throw|type|interface|extends|implements|class|as|typeof|keyof|while|switch|case|break)\b/y, 'keyword'],
  [/\b(?:true|false|null|undefined|this)\b/y, 'literal'],
  [NUMBER, 'number'],
  [/[A-Za-z_$][\w$]*(?=\s*:(?!:))/y, 'key'],
  [/[{}()[\];,.:=<>+\-*/!?&|]+/y, 'punct'],
]

const SQL_RULES: Rule[] = [
  [/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, 'comment'],
  [STRING_SQ, 'string'],
  [/\b(?:select|from|where|and|or|not|insert|into|values|update|set|delete|create|alter|drop|table|index|view|function|returns|language|as|on|join|left|right|inner|outer|group|by|order|limit|offset|having|grant|revoke|to|with|begin|end|commit|rollback|extension|if|exists|is|null|primary|key|references|default|unique|cascade|security|definer|policy|using|for|all|schema|role|in|case|when|then|else|distinct|count|returning)\b/iy, 'keyword'],
  [NUMBER, 'number'],
  [/[(),;.*=<>]/y, 'punct'],
]

const YAML_RULES: Rule[] = [
  [/#[^\n]*/y, 'comment'],
  [/(?<=^\s*(?:-\s+)?)[A-Za-z0-9_.\-/"']+(?=\s*:(?:\s|$))/my, 'key'],
  [STRING_DQ, 'string'],
  [STRING_SQ, 'string'],
  [/\b(?:true|false|null|yes|no|on|off)\b/y, 'literal'],
  [NUMBER, 'number'],
  [/\$\{[^}\n]*\}/y, 'variable'],
  [/[:\-|>[\]{},]/y, 'punct'],
]

const INI_RULES: Rule[] = [
  [/[#;][^\n]*/y, 'comment'],
  [/\[[^\]\n]*\]/y, 'keyword'],
  [/(?<=^\s*)[A-Za-z0-9_.-]+(?=\s*=)/my, 'key'],
  [STRING_DQ, 'string'],
  [STRING_SQ, 'string'],
  [/\$\{[^}\n]*\}/y, 'variable'],
  [/=/y, 'punct'],
]

const POWERSHELL_RULES: Rule[] = [
  [/#[^\n]*/y, 'comment'],
  [STRING_DQ, 'string'],
  [STRING_SQ, 'string'],
  [/\$[A-Za-z_][\w:]*/y, 'variable'],
  [/(?<=^|\s)-[A-Za-z][\w-]*/y, 'flag'],
  [/[A-Za-z0-9_./~@:\\-]+/y, (_match, atStart) => (atStart ? 'command' : undefined)],
  [/[|;&<>`]/y, 'punct'],
]

const PYTHON_RULES: Rule[] = [
  [/#[^\n]*/y, 'comment'],
  [/"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/y, 'string'],
  [STRING_DQ, 'string'],
  [STRING_SQ, 'string'],
  [/\b(?:import|from|def|return|if|elif|else|for|in|while|class|with|as|try|except|finally|raise|lambda|async|await|pass|not|and|or)\b/y, 'keyword'],
  [/\b(?:True|False|None|self)\b/y, 'literal'],
  [NUMBER, 'number'],
  [/[(){}[\],:.=]/y, 'punct'],
]

const LANGUAGES: Record<string, Rule[]> = {
  bash: SHELL_RULES, sh: SHELL_RULES, shell: SHELL_RULES, zsh: SHELL_RULES, console: SHELL_RULES, 'shell-session': SHELL_RULES,
  json: JSON_RULES, jsonc: JSON_RULES,
  ts: JS_RULES, tsx: JS_RULES, js: JS_RULES, jsx: JS_RULES, javascript: JS_RULES, typescript: JS_RULES, mjs: JS_RULES,
  sql: SQL_RULES, yaml: YAML_RULES, yml: YAML_RULES,
  ini: INI_RULES, env: INI_RULES, dotenv: INI_RULES, toml: INI_RULES, hcl: INI_RULES,
  powershell: POWERSHELL_RULES, ps1: POWERSHELL_RULES, bat: POWERSHELL_RULES,
  python: PYTHON_RULES, py: PYTHON_RULES,
}

/** Display names for the language label. */
const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'zsh', console: 'Console', json: 'JSON', jsonc: 'JSON', ts: 'TypeScript', tsx: 'TSX',
  js: 'JavaScript', jsx: 'JSX', javascript: 'JavaScript', typescript: 'TypeScript', sql: 'SQL', yaml: 'YAML', yml: 'YAML', ini: 'INI',
  env: '.env', dotenv: '.env', toml: 'TOML', hcl: 'HCL', powershell: 'PowerShell', bat: 'Batch', python: 'Python', py: 'Python',
  spl: 'SPL', cron: 'cron', text: 'Text',
}

export function languageLabel(lang: string): string {
  return LANGUAGE_LABELS[lang.toLowerCase()] ?? lang
}

export function isShellLanguage(lang: string): boolean {
  return LANGUAGES[lang.toLowerCase()] === SHELL_RULES
}

/** Tokenizes `code`; unknown languages come back as one plain token. */
export function highlight(code: string, lang: string): CodeToken[] {
  const rules = LANGUAGES[lang.toLowerCase()]
  if (!rules || code.length > 40_000) return [{ text: code }]
  const tokens: CodeToken[] = []
  let plain = ''
  let index = 0
  // A "command" is the first word of a shell line (or after a pipe / && / ;).
  let atCommand = true
  const flush = () => { if (plain) { tokens.push({ text: plain }); plain = '' } }
  while (index < code.length) {
    const char = code[index]
    if (char === '\n' || char === ' ' || char === '\t') {
      plain += char
      index++
      continue
    }
    let matched = false
    for (const [pattern, kind] of rules) {
      pattern.lastIndex = index
      const match = pattern.exec(code)
      if (!match || match[0].length === 0) continue
      const resolved = typeof kind === 'function' ? kind(match, atCommand) : kind
      flush()
      tokens.push(resolved ? { text: match[0], kind: resolved } : { text: match[0] })
      index += match[0].length
      matched = true
      break
    }
    if (!matched) {
      plain += char
      index++
    }
    const last = tokens[tokens.length - 1]
    if (matched && last) {
      if (last.kind === 'punct' && /^(?:\|\||&&|[|;&])$/.test(last.text)) atCommand = true
      else if (last.kind === 'keyword' && /^(?:sudo|then|do|else)$/.test(last.text)) atCommand = true
      else if (last.kind !== 'comment') atCommand = false
    }
    // A new line starts a new command unless the previous one ended with a continuation.
    if (code[index] === '\n') atCommand = !/\\\s*$/.test(code.slice(Math.max(0, index - 3), index))
  }
  flush()
  return tokens
}
