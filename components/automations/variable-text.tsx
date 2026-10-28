'use client'

/**
 * Renders a string containing workflow variables and expressions as
 * styled "bubble" spans so they're visually obvious wherever they
 * appear in the UI.
 *
 * Recognises:
 *   {{variable_name}}      — plain variable (e.g. {{user.email}})
 *   {{= EXPRESSION }}      — computed expression (e.g. {{= UPPER(name) }})
 *
 * Use this anywhere a node config summary, log message, or preview
 * shows a user-facing string that might contain variables. Keeping
 * this in one component means every surface gets the same visual
 * language for free.
 */

import React from 'react'

interface VariableTextProps {
  text: string | null | undefined
  /** Optional className applied to the wrapping span */
  className?: string
  /** If true, wraps in a block-level display instead of inline */
  block?: boolean
  /** Truncate to N characters — shows a ellipsis after */
  maxLength?: number
}

// Matches both {{var.path}} and {{= FUNC(args) }} with balanced-brace awareness
// for the common case. We don't bother with nested {{ }} inside — the workflow
// expression parser handles that at runtime; here we just need to visually
// identify top-level tokens.
const TOKEN_RE = /\{\{\s*(=\s*)?([^{}]+?)\s*\}\}/g

export function VariableText({ text, className = '', block = false, maxLength }: VariableTextProps) {
  if (text == null) {
    return <span className={className} style={{ color: 'var(--theme-muted-text)' }}>—</span>
  }

  const display = typeof text === 'string' ? text : String(text)
  const truncated = maxLength && display.length > maxLength
    ? display.slice(0, maxLength) + '…'
    : display

  const parts = tokenize(truncated)
  const Tag = block ? 'div' : 'span'

  return (
    <Tag className={className}>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <React.Fragment key={i}>{part.value}</React.Fragment>
        }
        return (
          <VariablePill
            key={i}
            value={part.value}
            isExpression={part.isExpression}
          />
        )
      })}
    </Tag>
  )
}

interface Token {
  type: 'text' | 'variable'
  value: string
  isExpression?: boolean
}

function tokenize(text: string): Token[] {
  const parts: Token[] = []
  let lastIndex = 0
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    parts.push({
      type: 'variable',
      value: match[2],
      isExpression: !!match[1],
    })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return parts
}

/**
 * The visual bubble itself. Plain variables are teal (using the primary
 * theme color); expressions get a violet tint so users can tell at a
 * glance which kind of token is being used.
 */
function VariablePill({ value, isExpression }: { value: string; isExpression?: boolean }) {
  // Use rgba() directly in the border so we get a soft outline without
  // relying on a non-standard borderOpacity prop (which TS rejects).
  // Theme-aware violet (blends toward card text) so expressions read on both
  // light and fully-dark themes — matches variable-input.tsx.
  const bg = isExpression ? 'color-mix(in srgb, #7D5B7A 20%, transparent)' : 'var(--theme-primary-light)'
  const fg = isExpression ? 'color-mix(in srgb, #7D5B7A 55%, var(--theme-card-text))' : 'var(--theme-primary-text)'
  const border = isExpression ? 'color-mix(in srgb, #7D5B7A 45%, transparent)' : 'color-mix(in srgb, var(--theme-accent) 40%, transparent)'
  const label = isExpression ? `ƒ ${value}` : value
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded-md font-mono text-[10px] font-semibold align-middle whitespace-nowrap"
      style={{
        backgroundColor: bg,
        color: fg,
        border: `1px solid ${border}`,
        lineHeight: 1,
      }}
      title={isExpression ? `Expression: ${value}` : `Variable: ${value}`}
    >
      {label}
    </span>
  )
}
