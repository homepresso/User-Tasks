/**
 * Copyable shell snippets must paste cleanly into an interactive zsh, the
 * default macOS shell. zsh only treats `#` as a comment in scripts, or with
 * `setopt interactive_comments`: pasted, a comment line fails with
 * "command not found: #" and a trailing `# …` with "bad pattern: #" (or is
 * passed to the command as arguments). So no comment lines and no trailing
 * comments: explanations go in the prose or caption around the snippet.
 *
 * Checked: every <Snippet> on the public site (components/marketing,
 * components/gallery; the code resolved from the source, interpolations as
 * placeholders), the use-case snippets, the shell code blocks (bash, sh,
 * shell, zsh, console) of every docs page, and the README's Quick start.
 *
 * Opt-out: a block whose first line is a shebang (`#!/bin/sh`) is a script
 * file to save and run, not to paste, and may keep its comments.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ALL_DOC_PAGES } from '@/lib/docs/registry'
import { parseMarkdown } from '@/lib/docs/markdown'
import { USE_CASES } from '@/lib/use-cases'

const ROOT = path.resolve(__dirname, '..')
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'shell-session'])

/**
 * The lines with a `#` comment: a `#` at the start of a word (line start or
 * after whitespace, `;`, `&`, `|`, `(`), outside quotes and heredoc bodies.
 * Quotes may span lines (a JSON body in -d '…').
 */
function shellCommentLines(code: string): string[] {
  const lines = code.split('\n')
  const found: string[] = []
  let quote: "'" | '"' | null = null
  let heredoc: string | null = null
  for (const line of lines) {
    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null
      continue
    }
    let comment = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quote === "'") {
        if (ch === "'") quote = null
        continue
      }
      if (ch === '\\') {
        i++
        continue
      }
      if (quote === '"') {
        if (ch === '"') quote = null
        continue
      }
      if (ch === "'" || ch === '"') {
        quote = ch
        continue
      }
      if (ch === '#' && (i === 0 || /[\s;&|(]/.test(line[i - 1]))) {
        comment = true
        break
      }
    }
    if (comment) found.push(line)
    const start = !quote && /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (start) heredoc = start[2]
  }
  return found
}

const isScriptFile = (code: string) => code.trimStart().startsWith('#!')

// ── <Snippet> in the site's components, resolved statically ──────────────────

const PLACEHOLDER = 'X'

type Resolved = { code: string } | { dynamic: string }

function snippetsInFile(file: string): Array<{ where: string; language: string } & Resolved> {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = new Map<string, ts.Node>()
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !declarations.has(node.name.text)) declarations.set(node.name.text, node.initializer)
    if (ts.isFunctionDeclaration(node) && node.name && !declarations.has(node.name.text)) declarations.set(node.name.text, node)
    ts.forEachChild(node, collect)
  }
  collect(source)

  /** The value an expression evaluates to, as an expression to resolve further (or a string). */
  const resolve = (node: ts.Node | undefined, depth = 0): string | null => {
    if (!node || depth > 12) return null
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return resolve(node.expression, depth + 1)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    // `cond ? \`…\` : null`: the snippet shown when there is one.
    if (ts.isConditionalExpression(node)) return resolve(node.whenTrue, depth + 1) ?? resolve(node.whenFalse, depth + 1)
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => PLACEHOLDER + span.literal.text).join('')
    if (ts.isIdentifier(node)) return resolve(declarations.get(node.text), depth + 1)
    if (ts.isArrowFunction(node)) return ts.isBlock(node.body) ? resolve(returned(node.body), depth + 1) : resolve(node.body, depth + 1)
    if (ts.isFunctionDeclaration(node)) return node.body ? resolve(returned(node.body), depth + 1) : null
    if (ts.isCallExpression(node)) return resolve(node.expression, depth + 1)
    if (ts.isPropertyAccessExpression(node)) {
      const target = objectOf(node.expression, depth + 1)
      const prop = target?.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === node.name.text)
      if (!prop) return null
      if (ts.isPropertyAssignment(prop)) return resolve(prop.initializer, depth + 1)
      if (ts.isShorthandPropertyAssignment(prop)) return resolve(findLocal(prop, prop.name.text), depth + 1)
      if (ts.isMethodDeclaration(prop) && prop.body) return resolve(returned(prop.body), depth + 1)
    }
    return null
  }
  const returned = (body: ts.Block) => body.statements.find(ts.isReturnStatement)?.expression
  /** A shorthand property's variable: the nearest declaration in the enclosing function. */
  const findLocal = (from: ts.Node, name: string): ts.Node | undefined => {
    let fn: ts.Node | undefined = from
    while (fn && !ts.isFunctionLike(fn)) fn = fn.parent
    let found: ts.Node | undefined
    const visit = (n: ts.Node) => {
      if (!found && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) found = n.initializer
      ts.forEachChild(n, visit)
    }
    if (fn) visit(fn)
    return found ?? declarations.get(name)
  }
  const objectOf = (node: ts.Node, depth: number): ts.ObjectLiteralExpression | null => {
    if (depth > 12) return null
    if (ts.isObjectLiteralExpression(node)) return node
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return objectOf(node.expression, depth + 1)
    if (ts.isIdentifier(node)) {
      const decl = declarations.get(node.text)
      return decl ? objectOf(decl, depth + 1) : null
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? declarations.get(node.expression.text) : undefined
      if (callee && (ts.isFunctionDeclaration(callee) || ts.isArrowFunction(callee)) && callee.body) {
        const value = ts.isBlock(callee.body) ? returned(callee.body) : callee.body
        return value ? objectOf(value, depth + 1) : null
      }
    }
    return null
  }

  const out: Array<{ where: string; language: string } & Resolved> = []
  const visit = (node: ts.Node) => {
    const tag = ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node) ? node : null
    if (tag && tag.tagName.getText(source) === 'Snippet') {
      const attr = (name: string) => tag.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === name)
      const lang = attr('language')?.initializer
      const language = !lang ? 'shell' : ts.isStringLiteral(lang) ? lang.text : 'dynamic'
      const init = attr('code')?.initializer
      const expr = init && ts.isJsxExpression(init) ? init.expression : init
      const where = `${path.relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(tag.getStart()).line + 1}`
      const code = resolve(expr)
      out.push(code === null ? { where, language, dynamic: expr?.getText(source) ?? '' } : { where, language, code })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

const SITE_DIRS = ['components/marketing', 'components/gallery']
const siteSnippets = SITE_DIRS.flatMap((dir) => readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith('.tsx'))
  .flatMap((f) => snippetsInFile(path.join(ROOT, dir, f))))

/** Snippets whose code is data, checked from that data below. */
const DYNAMIC_ALLOWED = new Set(['useCase.snippet.code'])

describe('copyable shell snippets paste into an interactive zsh', () => {
  it('the comment finder', () => {
    expect(shellCommentLines('npm run dev   # http://localhost:3000')).toHaveLength(1)
    expect(shellCommentLines('# a comment\nnpm install')).toEqual(['# a comment'])
    expect(shellCommentLines(`curl -d '{"a":"#1"}' "http://x/#frag" ${'$'}{#v} $#`)).toEqual([])
    expect(shellCommentLines(`curl -d '{\n  "note": "see # 2"\n}'`)).toEqual([])
    expect(shellCommentLines("cat > a.sh <<'EOF'\n# inside\nEOF\nls")).toEqual([])
    expect(shellCommentLines('echo \\# literal')).toEqual([])
  })

  it('finds the site snippets', () => {
    expect(siteSnippets.length).toBeGreaterThan(20)
    const unresolved = siteSnippets.filter((s) => 'dynamic' in s && !DYNAMIC_ALLOWED.has(s.dynamic))
    expect(unresolved.map((s) => `${s.where}: ${'dynamic' in s ? s.dynamic : ''}`)).toEqual([])
  })

  it('site <Snippet>s (marketing and gallery) have no # comments', () => {
    const bad = siteSnippets.flatMap((s) => ('code' in s && SHELL_LANGS.has(s.language) && !isScriptFile(s.code)
      ? shellCommentLines(s.code).map((line) => `${s.where}: ${line.trim()}`) : []))
    expect(bad).toEqual([])
  })

  it('use-case snippets have no # comments', () => {
    const bad = USE_CASES.flatMap((u) => (u.snippet && SHELL_LANGS.has(u.snippet.language) && !isScriptFile(u.snippet.code)
      ? shellCommentLines(u.snippet.code).map((line) => `${u.slug}: ${line.trim()}`) : []))
    expect(bad).toEqual([])
  })

  it('docs shell code blocks have no # comments', () => {
    let blocks = 0
    const bad = ALL_DOC_PAGES.flatMap((page) => parseMarkdown(page.body).flatMap((block) => {
      if (block.kind !== 'code' || !SHELL_LANGS.has(block.lang) || isScriptFile(block.code)) return []
      blocks++
      return shellCommentLines(block.code).map((line) => `/docs/${page.slug}: ${line.trim()}`)
    }))
    expect(blocks).toBeGreaterThan(20)
    expect(bad).toEqual([])
  })

  it("the README's Quick start has no # comments in its shell blocks", () => {
    const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8')
    const start = readme.search(/^## Quick start/m)
    expect(start).toBeGreaterThan(-1)
    const next = readme.slice(start + 1).search(/^## /m)
    const section = readme.slice(start, next < 0 ? undefined : start + 1 + next)
    const bad = parseMarkdown(section).flatMap((block) => (block.kind === 'code' && SHELL_LANGS.has(block.lang) && !isScriptFile(block.code)
      ? shellCommentLines(block.code).map((line) => line.trim()) : []))
    expect(bad).toEqual([])
  })
})
