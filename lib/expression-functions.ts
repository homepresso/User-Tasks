/**
 * Inline expression functions for workflow fields.
 * Syntax: {{=FUNCTION_NAME(arg1, arg2, ...)}}
 * Arguments can contain {{variables}} which are resolved first.
 *
 * Inspired by K2 workflow functions — allows building expressions
 * directly in any field without needing separate workflow nodes.
 */

import { assertRegexInput, compileUserRegex } from './safe-regex'
import { isTruthyValue } from './conditions'

export interface FunctionDef {
  name: string
  category: 'text' | 'date' | 'math' | 'logical' | 'conversion' | 'list' | 'regex' | 'data' | 'file'
  description: string
  args: { name: string; type: string; optional?: boolean }[]
  example: string
  returnType: string
}

export const FUNCTION_CATALOG: FunctionDef[] = [
  // ─── Text ───
  { name: 'LEFT', category: 'text', description: 'Get characters from the left of a string', args: [{ name: 'text', type: 'string' }, { name: 'length', type: 'number' }], example: 'LEFT("Example", 2) → "Ex"', returnType: 'string' },
  { name: 'RIGHT', category: 'text', description: 'Get characters from the right of a string', args: [{ name: 'text', type: 'string' }, { name: 'length', type: 'number' }], example: 'RIGHT("Example", 3) → "ple"', returnType: 'string' },
  { name: 'MID', category: 'text', description: 'Get a substring starting at a position', args: [{ name: 'text', type: 'string' }, { name: 'start', type: 'number' }, { name: 'length', type: 'number', optional: true }], example: 'MID("Example", 3, 2) → "am"', returnType: 'string' },
  { name: 'LENGTH', category: 'text', description: 'Get the length of a string', args: [{ name: 'text', type: 'string' }], example: 'LENGTH("Hello") → 5', returnType: 'number' },
  { name: 'UPPER', category: 'text', description: 'Convert to uppercase', args: [{ name: 'text', type: 'string' }], example: 'UPPER("hello") → "HELLO"', returnType: 'string' },
  { name: 'LOWER', category: 'text', description: 'Convert to lowercase', args: [{ name: 'text', type: 'string' }], example: 'LOWER("HELLO") → "hello"', returnType: 'string' },
  { name: 'TRIM', category: 'text', description: 'Remove leading/trailing whitespace', args: [{ name: 'text', type: 'string' }], example: 'TRIM("  hi  ") → "hi"', returnType: 'string' },
  { name: 'REPLACE', category: 'text', description: 'Replace occurrences in a string', args: [{ name: 'text', type: 'string' }, { name: 'find', type: 'string' }, { name: 'replace', type: 'string' }], example: 'REPLACE("hello", "l", "r") → "herro"', returnType: 'string' },
  { name: 'FIND', category: 'text', description: 'Find position of substring (1-based, 0 if not found)', args: [{ name: 'text', type: 'string' }, { name: 'search', type: 'string' }], example: 'FIND("Example", "amp") → 3', returnType: 'number' },
  { name: 'CONTAINS', category: 'text', description: 'Check if string contains a substring', args: [{ name: 'text', type: 'string' }, { name: 'search', type: 'string' }], example: 'CONTAINS("hello", "ell") → true', returnType: 'boolean' },
  { name: 'CONCAT', category: 'text', description: 'Concatenate multiple values', args: [{ name: 'values', type: 'string...' }], example: 'CONCAT("a", " ", "b") → "a b"', returnType: 'string' },
  { name: 'JOIN', category: 'text', description: 'Join a list with a separator', args: [{ name: 'separator', type: 'string' }, { name: 'values', type: 'string...' }], example: 'JOIN(", ", "a", "b") → "a, b"', returnType: 'string' },
  { name: 'SPLIT', category: 'text', description: 'Split text into a list', args: [{ name: 'text', type: 'string' }, { name: 'separator', type: 'string' }], example: 'SPLIT("a;b;c", ";") → ["a","b","c"]', returnType: 'array' },
  { name: 'PAD_LEFT', category: 'text', description: 'Pad string on the left', args: [{ name: 'text', type: 'string' }, { name: 'length', type: 'number' }, { name: 'char', type: 'string', optional: true }], example: 'PAD_LEFT("5", 3, "0") → "005"', returnType: 'string' },
  { name: 'PAD_RIGHT', category: 'text', description: 'Pad string on the right', args: [{ name: 'text', type: 'string' }, { name: 'length', type: 'number' }, { name: 'char', type: 'string', optional: true }], example: 'PAD_RIGHT("5", 3, "0") → "500"', returnType: 'string' },
  { name: 'PROPER', category: 'text', description: 'Convert to title case', args: [{ name: 'text', type: 'string' }], example: 'PROPER("hello world") → "Hello World"', returnType: 'string' },
  { name: 'URL_ENCODE', category: 'text', description: 'URL-encode a string', args: [{ name: 'text', type: 'string' }], example: 'URL_ENCODE("a b") → "a%20b"', returnType: 'string' },
  { name: 'URL_DECODE', category: 'text', description: 'URL-decode a string', args: [{ name: 'text', type: 'string' }], example: 'URL_DECODE("a%20b") → "a b"', returnType: 'string' },

  // ─── Date & Time ───
  { name: 'NOW', category: 'date', description: 'Current date and time', args: [], example: 'NOW() → "2024-03-15T14:30:00"', returnType: 'string' },
  { name: 'TODAY', category: 'date', description: 'Current date (midnight)', args: [], example: 'TODAY() → "2024-03-15"', returnType: 'string' },
  { name: 'ADD_DAYS', category: 'date', description: 'Add days to a date', args: [{ name: 'date', type: 'string' }, { name: 'days', type: 'number' }], example: 'ADD_DAYS("2024-01-01", 7) → "2024-01-08"', returnType: 'string' },
  { name: 'ADD_HOURS', category: 'date', description: 'Add hours to a date/time', args: [{ name: 'date', type: 'string' }, { name: 'hours', type: 'number' }], example: 'ADD_HOURS(NOW(), 2)', returnType: 'string' },
  { name: 'ADD_MINUTES', category: 'date', description: 'Add minutes to a date/time', args: [{ name: 'date', type: 'string' }, { name: 'minutes', type: 'number' }], example: 'ADD_MINUTES(NOW(), 30)', returnType: 'string' },
  { name: 'SUBTRACT_DAYS', category: 'date', description: 'Subtract days from a date', args: [{ name: 'date', type: 'string' }, { name: 'days', type: 'number' }], example: 'SUBTRACT_DAYS("2024-01-08", 7) → "2024-01-01"', returnType: 'string' },
  { name: 'DAY_DIFF', category: 'date', description: 'Days between two dates', args: [{ name: 'date1', type: 'string' }, { name: 'date2', type: 'string' }], example: 'DAY_DIFF("2024-01-01", "2024-01-08") → 7', returnType: 'number' },
  { name: 'DAY', category: 'date', description: 'Get day of month', args: [{ name: 'date', type: 'string' }], example: 'DAY("2024-03-15") → 15', returnType: 'number' },
  { name: 'MONTH', category: 'date', description: 'Get month number', args: [{ name: 'date', type: 'string' }], example: 'MONTH("2024-03-15") → 3', returnType: 'number' },
  { name: 'YEAR', category: 'date', description: 'Get year', args: [{ name: 'date', type: 'string' }], example: 'YEAR("2024-03-15") → 2024', returnType: 'number' },
  { name: 'WEEKDAY', category: 'date', description: 'Get day of week name', args: [{ name: 'date', type: 'string' }], example: 'WEEKDAY("2024-03-15") → "Friday"', returnType: 'string' },
  { name: 'FORMAT_DATE', category: 'date', description: 'Format a date string', args: [{ name: 'date', type: 'string' }, { name: 'format', type: 'string' }], example: 'FORMAT_DATE(NOW(), "YYYY-MM-DD")', returnType: 'string' },
  { name: 'START_OF_MONTH', category: 'date', description: 'First day of the month', args: [{ name: 'date', type: 'string' }], example: 'START_OF_MONTH("2024-03-15") → "2024-03-01"', returnType: 'string' },
  { name: 'END_OF_MONTH', category: 'date', description: 'Last day of the month', args: [{ name: 'date', type: 'string' }], example: 'END_OF_MONTH("2024-03-15") → "2024-03-31"', returnType: 'string' },
  { name: 'TOMORROW', category: 'date', description: 'Tomorrow\'s date', args: [], example: 'TOMORROW() → "2024-03-16"', returnType: 'string' },
  { name: 'YESTERDAY', category: 'date', description: 'Yesterday\'s date', args: [], example: 'YESTERDAY() → "2024-03-14"', returnType: 'string' },

  // ─── Math ───
  { name: 'ABS', category: 'math', description: 'Absolute value', args: [{ name: 'number', type: 'number' }], example: 'ABS(-5) → 5', returnType: 'number' },
  { name: 'ROUND', category: 'math', description: 'Round to precision', args: [{ name: 'number', type: 'number' }, { name: 'digits', type: 'number', optional: true }], example: 'ROUND(1.567, 1) → 1.6', returnType: 'number' },
  { name: 'ROUND_UP', category: 'math', description: 'Round up (ceiling)', args: [{ name: 'number', type: 'number' }], example: 'ROUND_UP(1.1) → 2', returnType: 'number' },
  { name: 'ROUND_DOWN', category: 'math', description: 'Round down (floor)', args: [{ name: 'number', type: 'number' }], example: 'ROUND_DOWN(1.9) → 1', returnType: 'number' },
  { name: 'MIN', category: 'math', description: 'Minimum of values', args: [{ name: 'values', type: 'number...' }], example: 'MIN(3, 1, 5) → 1', returnType: 'number' },
  { name: 'MAX', category: 'math', description: 'Maximum of values', args: [{ name: 'values', type: 'number...' }], example: 'MAX(3, 1, 5) → 5', returnType: 'number' },
  { name: 'AVG', category: 'math', description: 'Average of values', args: [{ name: 'values', type: 'number...' }], example: 'AVG(2, 4, 6) → 4', returnType: 'number' },
  { name: 'SUM', category: 'math', description: 'Sum of values', args: [{ name: 'values', type: 'number...' }], example: 'SUM(1, 2, 3) → 6', returnType: 'number' },
  { name: 'POWER', category: 'math', description: 'Raise to a power', args: [{ name: 'base', type: 'number' }, { name: 'exponent', type: 'number' }], example: 'POWER(2, 3) → 8', returnType: 'number' },
  { name: 'SQRT', category: 'math', description: 'Square root', args: [{ name: 'number', type: 'number' }], example: 'SQRT(9) → 3', returnType: 'number' },
  { name: 'MOD', category: 'math', description: 'Modulo (remainder)', args: [{ name: 'number', type: 'number' }, { name: 'divisor', type: 'number' }], example: 'MOD(10, 3) → 1', returnType: 'number' },
  { name: 'RANDOM', category: 'math', description: 'Random number 0 to max', args: [{ name: 'max', type: 'number' }], example: 'RANDOM(100) → 42', returnType: 'number' },
  { name: 'FORMAT_NUMBER', category: 'math', description: 'Format number with decimals', args: [{ name: 'number', type: 'number' }, { name: 'decimals', type: 'number' }], example: 'FORMAT_NUMBER(1234.5, 2) → "1234.50"', returnType: 'string' },

  // ─── Logical ───
  { name: 'IF', category: 'logical', description: 'If condition then A else B. The condition can be a comparison (status == "open"); "false", "0", "" and missing values are false', args: [{ name: 'condition', type: 'any' }, { name: 'then', type: 'any' }, { name: 'else', type: 'any' }], example: 'IF(amount > 1000, "CFO", "Manager") → "CFO"', returnType: 'any' },
  { name: 'AND', category: 'logical', description: 'True if all values are true', args: [{ name: 'values', type: 'boolean...' }], example: 'AND(true, true) → true', returnType: 'boolean' },
  { name: 'OR', category: 'logical', description: 'True if any value is true', args: [{ name: 'values', type: 'boolean...' }], example: 'OR(true, false) → true', returnType: 'boolean' },
  { name: 'NOT', category: 'logical', description: 'Negate a boolean', args: [{ name: 'value', type: 'boolean' }], example: 'NOT(true) → false', returnType: 'boolean' },
  { name: 'COALESCE', category: 'logical', description: 'First non-empty value', args: [{ name: 'values', type: 'any...' }], example: 'COALESCE("", null, "hi") → "hi"', returnType: 'any' },
  { name: 'IS_EMPTY', category: 'logical', description: 'Check if value is empty/null', args: [{ name: 'value', type: 'any' }], example: 'IS_EMPTY("") → true', returnType: 'boolean' },

  // ─── Conversion ───
  { name: 'TO_STRING', category: 'conversion', description: 'Convert to string', args: [{ name: 'value', type: 'any' }], example: 'TO_STRING(123) → "123"', returnType: 'string' },
  { name: 'TO_NUMBER', category: 'conversion', description: 'Convert to number', args: [{ name: 'value', type: 'any' }], example: 'TO_NUMBER("42") → 42', returnType: 'number' },
  { name: 'TO_BOOLEAN', category: 'conversion', description: 'Convert to boolean', args: [{ name: 'value', type: 'any' }], example: 'TO_BOOLEAN("true") → true', returnType: 'boolean' },
  { name: 'TO_JSON', category: 'conversion', description: 'Convert to JSON string', args: [{ name: 'value', type: 'any' }], example: 'TO_JSON({a:1}) → \'{"a":1}\'', returnType: 'string' },
  { name: 'FROM_JSON', category: 'conversion', description: 'Parse a JSON string', args: [{ name: 'text', type: 'string' }], example: 'FROM_JSON(\'{"a":1}\') → {a:1}', returnType: 'any' },

  // ─── List ───
  { name: 'COUNT', category: 'list', description: 'Count items in a list', args: [{ name: 'list', type: 'array' }], example: 'COUNT([1,2,3]) → 3', returnType: 'number' },
  { name: 'FIRST', category: 'list', description: 'First item in a list', args: [{ name: 'list', type: 'array' }], example: 'FIRST([1,2,3]) → 1', returnType: 'any' },
  { name: 'LAST', category: 'list', description: 'Last item in a list', args: [{ name: 'list', type: 'array' }], example: 'LAST([1,2,3]) → 3', returnType: 'any' },
  { name: 'INDEX', category: 'list', description: 'Get item at index (1-based)', args: [{ name: 'list', type: 'array' }, { name: 'index', type: 'number' }], example: 'INDEX([a,b,c], 2) → "b"', returnType: 'any' },
  { name: 'REVERSE', category: 'list', description: 'Reverse a list', args: [{ name: 'list', type: 'array' }], example: 'REVERSE([1,2,3]) → [3,2,1]', returnType: 'array' },
  { name: 'UNIQUE', category: 'list', description: 'Remove duplicate values', args: [{ name: 'list', type: 'array' }], example: 'UNIQUE([1,2,2,3]) → [1,2,3]', returnType: 'array' },
  { name: 'FLATTEN', category: 'list', description: 'Flatten nested arrays', args: [{ name: 'list', type: 'array' }], example: 'FLATTEN([[1,2],[3]]) → [1,2,3]', returnType: 'array' },
  { name: 'PLUCK', category: 'list', description: 'Extract one field from every item into a list (dotted paths like "address.city" work)', args: [{ name: 'list', type: 'array' }, { name: 'key', type: 'string' }], example: 'SUM(PLUCK(items, "price"))', returnType: 'array' },
  { name: 'FIND_WHERE', category: 'list', description: 'First item whose field equals a value — optionally return one field of it', args: [{ name: 'list', type: 'array' }, { name: 'field', type: 'string' }, { name: 'value', type: 'any' }, { name: 'return_field', type: 'string', optional: true }], example: 'FIND_WHERE(customers, "id", 42, "email") → "ada@example.com"', returnType: 'any' },
  { name: 'FILTER_WHERE', category: 'list', description: 'All items whose field equals a value', args: [{ name: 'list', type: 'array' }, { name: 'field', type: 'string' }, { name: 'value', type: 'any' }], example: 'COUNT(FILTER_WHERE(orders, "status", "open"))', returnType: 'array' },

  // ─── Regex ───
  { name: 'REGEX_MATCH', category: 'regex', description: 'Test if text matches a pattern', args: [{ name: 'text', type: 'string' }, { name: 'pattern', type: 'string' }], example: 'REGEX_MATCH("abc123", "\\\\d+") → true', returnType: 'boolean' },
  { name: 'REGEX_EXTRACT', category: 'regex', description: 'Extract first match', args: [{ name: 'text', type: 'string' }, { name: 'pattern', type: 'string' }], example: 'REGEX_EXTRACT("abc123", "\\\\d+") → "123"', returnType: 'string' },
  { name: 'REGEX_REPLACE', category: 'regex', description: 'Replace matches with a string', args: [{ name: 'text', type: 'string' }, { name: 'pattern', type: 'string' }, { name: 'replacement', type: 'string' }], example: 'REGEX_REPLACE("a1b2", "\\\\d", "X") → "aXbX"', returnType: 'string' },

  // ─── Data ───
  { name: 'GUID', category: 'data', description: 'Generate a new UUID', args: [], example: 'GUID() → "a1b2c3..."', returnType: 'string' },
  { name: 'BASE64_ENCODE', category: 'data', description: 'Encode string to Base64', args: [{ name: 'text', type: 'string' }], example: 'BASE64_ENCODE("Hello") → "SGVsbG8="', returnType: 'string' },
  { name: 'BASE64_DECODE', category: 'data', description: 'Decode Base64 to string', args: [{ name: 'text', type: 'string' }], example: 'BASE64_DECODE("SGVsbG8=") → "Hello"', returnType: 'string' },

  // ─── File ───
  { name: 'FILE_NAME', category: 'file', description: 'Extract filename from path or URL', args: [{ name: 'path', type: 'string' }], example: 'FILE_NAME("/docs/report.pdf") → "report.pdf"', returnType: 'string' },
  { name: 'FILE_EXT', category: 'file', description: 'Extract file extension', args: [{ name: 'path', type: 'string' }], example: 'FILE_EXT("report.pdf") → "pdf"', returnType: 'string' },
  { name: 'FILE_BASE_NAME', category: 'file', description: 'Filename without extension', args: [{ name: 'path', type: 'string' }], example: 'FILE_BASE_NAME("report.pdf") → "report"', returnType: 'string' },
  { name: 'MIME_TYPE', category: 'file', description: 'Get MIME type from extension', args: [{ name: 'filename', type: 'string' }], example: 'MIME_TYPE("doc.pdf") → "application/pdf"', returnType: 'string' },
  { name: 'FILE_NAMES', category: 'file', description: 'Names of a list of files (an Attachments field), joined', args: [{ name: 'files', type: 'array' }, { name: 'separator', type: 'string', optional: true }], example: 'FILE_NAMES(task_data.receipts) → "a.pdf, b.png"', returnType: 'string' },
  { name: 'FILES_TOTAL_SIZE', category: 'file', description: 'Total size in bytes of a list of files', args: [{ name: 'files', type: 'array' }], example: 'FILE_SIZE_FORMAT(FILES_TOTAL_SIZE(task_data.receipts)) → "2.4 MB"', returnType: 'number' },
  { name: 'FILE_SIZE_FORMAT', category: 'file', description: 'Format bytes to human-readable', args: [{ name: 'bytes', type: 'number' }], example: 'FILE_SIZE_FORMAT(1048576) → "1.0 MB"', returnType: 'string' },
  { name: 'DATA_URI', category: 'file', description: 'Build data URI from base64 + mime', args: [{ name: 'base64', type: 'string' }, { name: 'mimeType', type: 'string' }], example: 'DATA_URI("SGVs...", "text/plain")', returnType: 'string' },
  { name: 'DATA_URI_BASE64', category: 'file', description: 'Extract base64 from a data URI', args: [{ name: 'dataUri', type: 'string' }], example: 'DATA_URI_BASE64("data:text/plain;base64,SGVs...") → "SGVs..."', returnType: 'string' },
  { name: 'DATA_URI_MIME', category: 'file', description: 'Extract MIME type from a data URI', args: [{ name: 'dataUri', type: 'string' }], example: 'DATA_URI_MIME("data:text/plain;base64,...") → "text/plain"', returnType: 'string' },
]

// ─── Category metadata ───
export const FUNCTION_CATEGORIES: { id: string; label: string; icon: string; color: string }[] = [
  { id: 'text', label: 'Text', icon: 'Type', color: '#3B82F6' },
  { id: 'date', label: 'Date & Time', icon: 'Calendar', color: '#8B5CF6' },
  { id: 'math', label: 'Math', icon: 'Calculator', color: '#F59E0B' },
  { id: 'logical', label: 'Logical', icon: 'GitBranch', color: '#22C55E' },
  { id: 'conversion', label: 'Conversion', icon: 'ArrowUpDown', color: '#06B6D4' },
  { id: 'list', label: 'List', icon: 'ListTree', color: '#EC4899' },
  { id: 'regex', label: 'Regex', icon: 'Regex', color: '#EF4444' },
  { id: 'data', label: 'Data', icon: 'Database', color: '#6B7280' },
  { id: 'file', label: 'File', icon: 'Paperclip', color: '#F97316' },
]

// ─── Function evaluator ───

/**
 * Parse a function call string like FUNC_NAME(arg1, arg2, "string arg", ...)
 * and return { name, args[] }
 */
function parseFunctionCall(expr: string): { name: string; args: string[] } | null {
  const match = expr.match(/^([A-Z_][A-Z0-9_]*)\s*\(([\s\S]*)\)$/)
  if (!match) return null

  const name = match[1]
  const argsStr = match[2].trim()
  if (!argsStr) return { name, args: [] }

  // Parse args, respecting quoted strings and nested parens
  const args: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i]
    if (inString) {
      current += ch
      if (ch === stringChar && argsStr[i - 1] !== '\\') inString = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      stringChar = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '[') { depth++; current += ch; continue }
    if (ch === ')' || ch === ']') { depth--; current += ch; continue }
    if (ch === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) args.push(current.trim())

  return { name, args }
}

// ─── Operators: comparison and arithmetic ─────────────────────────────
//
// Semantics (documented on /docs/workflows/expressions):
// - `==` / `!=`: numeric when both sides are numeric (numbers or numeric
//   text), otherwise exact, case-sensitive text; null/missing equals "".
// - `> < >= <=`: numeric when both sides are numeric, otherwise text order;
//   false when either side is null, missing or "".
// - `+`: adds numbers; joins as text when either side is not numeric.
// - `- * / %`: numbers only; a non-numeric operand or division by zero
//   gives null.
// - An operand is a literal ("text", 12.5, true, false, null), a variable
//   name, a FUNCTION(...) call or a parenthesised expression. An unknown
//   name means the argument is not an expression and is read as plain text
//   (the pre-existing behaviour), as are unquoted dates and ids such as
//   2026-01-05 or 021-555-1234.

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'call'; v: string }
  | { t: 'op'; v: string }

const OPERATOR_TOKENS = ['==', '!=', '>=', '<=', '>', '<', '+', '-', '*', '/', '%', '(', ')']

/** Tokenise an argument; null when it contains anything an expression cannot. */
function tokenize(src: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      let out = ''
      while (j < src.length && src[j] !== ch) {
        // Only an escaped quote is unescaped (as before): "\\d+" stays a regex.
        if (src[j] === '\\' && (src[j + 1] === '"' || src[j + 1] === "'")) { out += src[j + 1]; j += 2; continue }
        if (src[j] === '\\' && j + 1 < src.length) { out += src[j] + src[j + 1]; j += 2; continue }
        out += src[j++]
      }
      if (j >= src.length) return null
      tokens.push({ t: 'str', v: out })
      i = j + 1
      continue
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
      if (!m) return null
      tokens.push({ t: 'num', v: Number(m[0]) })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_]\w*(?:\.\w+|\[\d+\])*/.exec(src.slice(i))!
      let j = i + m[0].length
      let k = j
      while (src[k] === ' ') k++
      if (src[k] === '(' && /^[A-Z_][A-Z0-9_]*$/.test(m[0])) {
        // FUNCTION(...) — capture through the balancing paren.
        let depth = 0
        let quote = ''
        for (; k < src.length; k++) {
          const c = src[k]
          if (quote) { if (c === '\\') k++; else if (c === quote) quote = ''; continue }
          if (c === '"' || c === "'") quote = c
          else if (c === '(') depth++
          else if (c === ')' && --depth === 0) break
        }
        if (depth !== 0 || k >= src.length) return null
        tokens.push({ t: 'call', v: src.slice(i, k + 1) })
        i = k + 1
        continue
      }
      tokens.push({ t: 'id', v: m[0] })
      i = j
      continue
    }
    const op = OPERATOR_TOKENS.find((candidate) => src.startsWith(candidate, i))
    if (!op) return null
    tokens.push({ t: 'op', v: op })
    i += op.length
  }
  return tokens
}

function isNumeric(value: any): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string' || value.trim() === '') return false
  return Number.isFinite(Number(value))
}

function asText(value: any): string {
  if (value == null) return ''
  if (typeof value === 'object') { try { return JSON.stringify(value) } catch { return String(value) } }
  return String(value)
}

/** Compare two operand values with the documented operator semantics. */
export function compareValues(op: string, left: any, right: any): boolean {
  // Ordering against a missing/empty value is false (as Number(NaN) was).
  const blank = (value: any) => value == null || value === ''
  if (op !== '==' && op !== '!=' && (blank(left) || blank(right))) return false
  const numeric = isNumeric(left) && isNumeric(right)
  const l = numeric ? Number(left) : asText(left)
  const r = numeric ? Number(right) : asText(right)
  switch (op) {
    case '==': return l === r
    case '!=': return l !== r
    case '>': return l > r
    case '<': return l < r
    case '>=': return l >= r
    case '<=': return l <= r
    default: return false
  }
}

function arithmetic(op: string, left: any, right: any): any {
  const numeric = isNumeric(left) && isNumeric(right)
  if (op === '+' && !numeric) return asText(left) + asText(right)
  if (!numeric) return null
  const a = Number(left)
  const b = Number(right)
  const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b
  return Number.isFinite(result) ? result : null
}

class NotAnExpression extends Error {}

/**
 * Evaluate an operator expression. Throws NotAnExpression when the text is not
 * one (unknown name, dangling operator…) so the caller keeps the legacy reading.
 */
function evaluateOperatorExpression(tokens: Token[], evalFn: (expr: string) => any, scope?: Record<string, any>): any {
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (...ops: string[]) => peek()?.t === 'op' && ops.includes(peek()!.v as string)

  const primary = (): any => {
    const token = tokens[pos++]
    if (!token) throw new NotAnExpression()
    if (token.t === 'num' || token.t === 'str') return token.v
    if (token.t === 'call') return evalFn(token.v)
    if (token.t === 'id') {
      if (token.v === 'true') return true
      if (token.v === 'false') return false
      if (token.v === 'null') return null
      if (scope) {
        if (token.v in scope) return scope[token.v]
        const parts = token.v.replace(/\[(\d+)\]/g, '.$1').split('.')
        if (parts[0] in scope) {
          let value: any = scope[parts[0]]
          for (let i = 1; i < parts.length; i++) value = value?.[parts[i]]
          return value
        }
      }
      throw new NotAnExpression()
    }
    if (token.v === '(') {
      const value = comparison()
      if (!isOp(')')) throw new NotAnExpression()
      pos++
      return value
    }
    if (token.v === '-' || token.v === '+') {
      const value = primary()
      if (!isNumeric(value)) throw new NotAnExpression()
      return token.v === '-' ? -Number(value) : Number(value)
    }
    throw new NotAnExpression()
  }
  const term = (): any => {
    let left = primary()
    while (isOp('*', '/', '%')) { const op = tokens[pos++].v as string; left = arithmetic(op, left, primary()) }
    return left
  }
  const sum = (): any => {
    let left = term()
    while (isOp('+', '-')) { const op = tokens[pos++].v as string; left = arithmetic(op, left, term()) }
    return left
  }
  const comparison = (): any => {
    const left = sum()
    if (isOp('==', '!=', '>=', '<=', '>', '<')) { const op = tokens[pos++].v as string; return compareValues(op, left, sum()) }
    return left
  }
  const value = comparison()
  if (pos !== tokens.length) throw new NotAnExpression()
  return value
}

/** Unquoted dates, phone numbers and dotted ids (2026-01-05, 021-555-1234, 1.2.3) are text, not arithmetic. */
const DATE_OR_ID = /^\d+(?:[-/.]\d+){2,}$/

/**
 * Try `text` as an operator expression. Returns { value } when it is one,
 * null when it is a single literal/name/call (left to the caller) or not an
 * expression at all.
 */
export function tryOperatorExpression(text: string, evalFn: (expr: string) => any, scope?: Record<string, any>, allowSingle = false): { value: any } | null {
  const trimmed = text.trim()
  if (!trimmed || DATE_OR_ID.test(trimmed)) return null
  const tokens = tokenize(trimmed)
  if (!tokens?.length) return null
  if (!allowSingle && !tokens.some((token) => token.t === 'op')) return null
  try {
    return { value: evaluateOperatorExpression(tokens, evalFn, scope) }
  } catch (error) {
    if (error instanceof NotAnExpression) return null
    throw error
  }
}

/**
 * Resolve a single argument — strip quotes, parse numbers/booleans,
 * evaluate operators, or recursively evaluate nested function calls.
 */
function resolveArg(arg: string, evalFn: (expr: string) => any, scope?: Record<string, any>): any {
  // A flat scope key wins (keys may contain characters that read as operators).
  if (scope && arg in scope) return scope[arg]
  // Exactly one quoted string. (A starts-and-ends-with-quote check would read
  // '"a" == "b"' as one string.)
  const tokens = /^["']/.test(arg) ? tokenize(arg) : null
  if (tokens?.length === 1 && tokens[0].t === 'str') return tokens[0].v
  // Comparison / arithmetic: "status == \"open\"", "price * qty", "(a + b) / 2".
  const expression = tryOperatorExpression(arg, evalFn, scope)
  if (expression) return expression.value
  // Quoted string (legacy reading for text the tokenizer rejects)
  if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
    return arg.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
  }
  // Nested function call
  if (/^[A-Z_][A-Z0-9_]*\s*\(/.test(arg)) {
    return evalFn(arg)
  }
  // Boolean
  if (arg === 'true') return true
  if (arg === 'false') return false
  if (arg === 'null') return null
  // Infix comparison the expression parser could not read (e.g. plain words
  // on one side: "Open orders >= 2"): compare the two sides as values.
  const cmp = arg.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/)
  if (cmp) {
    const left = resolveArg(cmp[1].trim(), evalFn, scope)
    const right = resolveArg(cmp[3].trim(), evalFn, scope)
    return compareValues(cmp[2], left, right)
  }
  // Array literal, e.g. COUNT([1,2,3]) — the catalog's own documented form.
  if (arg.startsWith('[') && arg.endsWith(']')) {
    try { return JSON.parse(arg) } catch { /* fall through */ }
  }
  // Bare identifier resolved from scope to its ACTUAL value (arrays/objects kept
  // intact, so COUNT(items) / PLUCK(items,"price") see the real control value).
  // Flat lookup runs first and has no shape gate, so UUID ids and dotted flat
  // keys ('user.email', component uuids with hyphens) resolve too.
  if (scope) {
    if (arg in scope) return scope[arg]
    if (/^[A-Za-z_][\w-]*(\[\d+\])*(\.[\w-]+(\[\d+\])*)*$/.test(arg)) {
      const parts = arg.replace(/\[(\d+)\]/g, '.$1').split('.')
      if (parts[0] in scope) {
        let v: any = scope[parts[0]]
        for (let i = 1; i < parts.length; i++) v = v?.[parts[i]]
        return v
      }
    }
  }
  // Number
  const num = Number(arg)
  if (!isNaN(num) && arg !== '') return num
  // Plain string (variable reference already resolved)
  return arg
}

/** A field of a row: the flat key first, then a dotted/indexed path (`address.city`, `tags[0]`). */
function readField(row: any, key: string): any {
  if (row == null || typeof row !== 'object') return undefined
  if (key in row) return row[key]
  let value: any = row
  for (const part of key.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (!part) continue
    if (value == null) return undefined
    value = value[part]
  }
  return value
}

/** Equality for FIND_WHERE/FILTER_WHERE: 42 matches "42", true matches "true". */
function looseEquals(a: any, b: any): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Parse a date safely — returns null if invalid */
function toDate(v: any): Date | null {
  if (v == null || v === '') return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

/** Extract valid numbers from args, filtering out NaN */
function toNums(args: any[]): number[] {
  // Flatten one level so SUM(PLUCK(items,"price")) / AVG([1,2,3]) work as well as
  // the spread form SUM(1, 2, 3).
  return args.flat().map(Number).filter(n => !isNaN(n))
}

/**
 * Evaluate a function expression (after variables have been resolved).
 * Supports nesting: LEFT(UPPER({{name}}), 1)
 */
export function evaluateFunction(expr: string, scope?: Record<string, any>): any {
  // Tolerate surrounding whitespace — "{{= ADD(x, 1) }}" arrives as " ADD(x, 1) ",
  // and an untrimmed expr fails the FUNC(...) match, leaking the literal text
  // into the output instead of the evaluated result.
  const parsed = parseFunctionCall(String(expr ?? '').trim())
  if (!parsed) {
    // Not a single FUNCTION(...) call: an operator expression such as
    // `{{= price * qty }}` or `{{= status == "open" }}`, else the text as-is.
    const expression = tryOperatorExpression(String(expr ?? ''), (e) => evaluateFunction(e, scope), scope, true)
    return expression ? expression.value : expr
  }

  const { name } = parsed
  // `scope` lets a bare identifier arg resolve to its ACTUAL value (arrays/objects
  // included) — so COUNT(items) / SUM(PLUCK(items,"price")) work against a control.
  const args = parsed.args.map(a => resolveArg(a, (e) => evaluateFunction(e, scope), scope))

  try {
    switch (name) {
      // ─── Text ───
      case 'LEFT': return String(args[0] ?? '').slice(0, Number(args[1]) || 0)
      case 'RIGHT': return String(args[0] ?? '').slice(-(Number(args[1]) || 0))
      case 'MID': {
        const s = String(args[0] ?? '')
        const start = (Number(args[1]) || 1) - 1
        const len = args[2] != null ? Number(args[2]) : undefined
        return len != null ? s.slice(start, start + len) : s.slice(start)
      }
      case 'LENGTH': return String(args[0] ?? '').length
      case 'UPPER': return String(args[0] ?? '').toUpperCase()
      case 'LOWER': return String(args[0] ?? '').toLowerCase()
      case 'TRIM': return String(args[0] ?? '').trim()
      case 'REPLACE': return String(args[0] ?? '').split(String(args[1] ?? '')).join(String(args[2] ?? ''))
      case 'FIND': { const idx = String(args[0] ?? '').indexOf(String(args[1] ?? '')); return idx >= 0 ? idx + 1 : 0 }
      case 'CONTAINS': return String(args[0] ?? '').includes(String(args[1] ?? ''))
      case 'CONCAT': return args.flat().map(a => String(a ?? '')).join('')
      case 'JOIN': return args.slice(1).flat().map(a => String(a ?? '')).join(String(args[0] ?? ''))
      case 'SPLIT': return String(args[0] ?? '').split(String(args[1] ?? ','))
      case 'PAD_LEFT': return String(args[0] ?? '').padStart(Number(args[1]) || 0, String(args[2] ?? ' '))
      case 'PAD_RIGHT': return String(args[0] ?? '').padEnd(Number(args[1]) || 0, String(args[2] ?? ' '))
      case 'PROPER': return String(args[0] ?? '').replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
      case 'URL_ENCODE': return encodeURIComponent(String(args[0] ?? ''))
      case 'URL_DECODE': return decodeURIComponent(String(args[0] ?? ''))

      // ─── Date & Time ───
      case 'NOW': return new Date().toISOString()
      case 'TODAY': return new Date().toISOString().split('T')[0]
      case 'TOMORROW': { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] }
      case 'YESTERDAY': { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0] }
      case 'ADD_DAYS': { const d = toDate(args[0]); if (!d) return null; d.setDate(d.getDate() + (Number(args[1]) || 0)); return d.toISOString() }
      case 'ADD_HOURS': { const d = toDate(args[0]); if (!d) return null; d.setHours(d.getHours() + (Number(args[1]) || 0)); return d.toISOString() }
      case 'ADD_MINUTES': { const d = toDate(args[0]); if (!d) return null; d.setMinutes(d.getMinutes() + (Number(args[1]) || 0)); return d.toISOString() }
      case 'SUBTRACT_DAYS': { const d = toDate(args[0]); if (!d) return null; d.setDate(d.getDate() - (Number(args[1]) || 0)); return d.toISOString() }
      case 'DAY_DIFF': { const a = toDate(args[0]); const b = toDate(args[1]); if (!a || !b) return null; return Math.round((b.getTime() - a.getTime()) / 86400000 * 10) / 10 }
      case 'DAY': { const d = toDate(args[0]); return d ? d.getUTCDate() : null }
      case 'MONTH': { const d = toDate(args[0]); return d ? d.getUTCMonth() + 1 : null }
      case 'YEAR': { const d = toDate(args[0]); return d ? d.getUTCFullYear() : null }
      case 'WEEKDAY': { const d = toDate(args[0]); return d ? DAYS[d.getUTCDay()] : null }
      case 'FORMAT_DATE': {
        const d = toDate(args[0])
        if (!d) return null
        let fmt = String(args[1] ?? 'YYYY-MM-DD')
        // Use placeholder-based replacement to avoid token conflicts (e.g. MM vs mm)
        // Use UTC methods for consistency with date-only strings
        const tokens: [string, string][] = [
          ['YYYY', String(d.getUTCFullYear())],
          ['MM', String(d.getUTCMonth() + 1).padStart(2, '0')],
          ['DD', String(d.getUTCDate()).padStart(2, '0')],
          ['HH', String(d.getUTCHours()).padStart(2, '0')],
          ['mm', String(d.getUTCMinutes()).padStart(2, '0')],
          ['ss', String(d.getUTCSeconds()).padStart(2, '0')],
        ]
        // Replace longest tokens first, use unique placeholders to avoid conflicts.
        // replaceAll so a token repeated in the format string works everywhere.
        const placeholders: [string, string][] = []
        tokens.forEach(([tok, val], i) => {
          const ph = `\x00${i}\x00`
          fmt = fmt.replaceAll(tok, ph)
          placeholders.push([ph, val])
        })
        placeholders.forEach(([ph, val]) => { fmt = fmt.replaceAll(ph, val) })
        return fmt
      }
      case 'START_OF_MONTH': { const d = toDate(args[0]); if (!d) return null; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().split('T')[0] }
      case 'END_OF_MONTH': { const d = toDate(args[0]); if (!d) return null; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().split('T')[0] }

      // ─── Math ───
      // Basic arithmetic — the names people reach for first (the date variants
      // ADD_DAYS etc. already existed, but plain ADD/MULTIPLY did not, so
      // expressions like ADD(index, 1) silently passed through unevaluated).
      case 'ADD': return toNums(args).reduce((a, b) => a + b, 0)
      case 'SUBTRACT': return (Number(args[0]) || 0) - (Number(args[1]) || 0)
      case 'MULTIPLY': return toNums(args).reduce((a, b) => a * b, 1)
      case 'DIVIDE': { const divisor = Number(args[1]); return divisor ? (Number(args[0]) || 0) / divisor : null }
      case 'ABS': return Math.abs(Number(args[0]) || 0)
      case 'ROUND': return Number((Number(args[0]) || 0).toFixed(Number(args[1]) ?? 0))
      case 'ROUND_UP': return Math.ceil(Number(args[0]) || 0)
      case 'ROUND_DOWN': return Math.floor(Number(args[0]) || 0)
      case 'MIN': { const nums = toNums(args); return nums.length ? Math.min(...nums) : 0 }
      case 'MAX': { const nums = toNums(args); return nums.length ? Math.max(...nums) : 0 }
      case 'AVG': { const nums = toNums(args); return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0 }
      case 'SUM': return toNums(args).reduce((a, b) => a + b, 0)
      case 'POWER': return Math.pow(Number(args[0]) || 0, Number(args[1]) || 0)
      case 'SQRT': return Math.sqrt(Number(args[0]) || 0)
      case 'MOD': return (Number(args[0]) || 0) % (Number(args[1]) || 1)
      case 'RANDOM': return Math.floor(Math.random() * (Number(args[0]) || 100))
      case 'FORMAT_NUMBER': return (Number(args[0]) || 0).toFixed(Number(args[1]) ?? 2)

      // ─── Logical ───
      // Boolean context: false, 0, "", "false", "0", "no", "off", "null",
      // null and missing are false (lib/conditions.ts isTruthyValue).
      case 'IF': return isTruthyValue(args[0]) ? args[1] : args[2]
      case 'AND': return args.every(isTruthyValue)
      case 'OR': return args.some(isTruthyValue)
      case 'NOT': return !isTruthyValue(args[0])
      case 'GT': return Number(args[0]) > Number(args[1])
      case 'GTE': return Number(args[0]) >= Number(args[1])
      case 'LT': return Number(args[0]) < Number(args[1])
      case 'LTE': return Number(args[0]) <= Number(args[1])
      case 'EQ': return String(args[0]) === String(args[1])
      case 'NEQ': return String(args[0]) !== String(args[1])
      case 'COALESCE': return args.find(a => a != null && a !== '') ?? null
      case 'IS_EMPTY': return args[0] == null || args[0] === '' || (Array.isArray(args[0]) && args[0].length === 0)

      // ─── Conversion ───
      case 'TO_STRING': return String(args[0] ?? '')
      case 'TO_NUMBER': return Number(args[0]) || 0
      case 'TO_BOOLEAN': return args[0] === true || args[0] === 'true' || args[0] === '1' || args[0] === 1
      case 'TO_JSON': return JSON.stringify(args[0])
      case 'FROM_JSON': {
        try { return JSON.parse(String(args[0])) } catch { return null }
      }

      // ─── List ───
      case 'COUNT': return Array.isArray(args[0]) ? args[0].length : 0
      case 'FIRST': return Array.isArray(args[0]) ? args[0][0] : null
      case 'LAST': return Array.isArray(args[0]) ? args[0][args[0].length - 1] : null
      case 'INDEX': return Array.isArray(args[0]) ? args[0][(Number(args[1]) || 1) - 1] : null
      case 'REVERSE': return Array.isArray(args[0]) ? [...args[0]].reverse() : []
      case 'UNIQUE': return Array.isArray(args[0]) ? [...new Set(args[0])] : []
      case 'FLATTEN': return Array.isArray(args[0]) ? args[0].flat(Infinity) : []
      // PLUCK(list, "key") — extract one column from a list of row objects into an array.
      case 'PLUCK': return Array.isArray(args[0]) ? args[0].map((row: any) => readField(row, String(args[1] ?? ''))) : []
      case 'FIND_WHERE': {
        if (!Array.isArray(args[0])) return null
        const field = String(args[1] ?? '')
        const found = args[0].find((row: any) => looseEquals(readField(row, field), args[2]))
        if (found === undefined) return null
        return args[3] !== undefined && args[3] !== '' ? readField(found, String(args[3])) ?? null : found
      }
      case 'FILTER_WHERE': {
        if (!Array.isArray(args[0])) return []
        const field = String(args[1] ?? '')
        return args[0].filter((row: any) => looseEquals(readField(row, field), args[2]))
      }

      // ─── Regex ───
      // User patterns go through the ReDoS guard (lib/safe-regex.ts): an unsafe
      // or over-long pattern/input behaves like an invalid pattern here.
      case 'REGEX_MATCH': try { return compileUserRegex(String(args[1])).test(assertRegexInput(String(args[0]))) } catch { return false }
      case 'REGEX_EXTRACT': try { return assertRegexInput(String(args[0])).match(compileUserRegex(String(args[1])))?.[0] ?? '' } catch { return '' }
      case 'REGEX_REPLACE': try { return assertRegexInput(String(args[0])).replace(compileUserRegex(String(args[1]), 'g'), String(args[2] ?? '')) } catch { return String(args[0]) }

      // ─── Data ───
      case 'GUID': return crypto.randomUUID()
      case 'BASE64_ENCODE': return typeof btoa === 'function' ? btoa(String(args[0] ?? '')) : Buffer.from(String(args[0] ?? '')).toString('base64')
      case 'BASE64_DECODE': return typeof atob === 'function' ? atob(String(args[0] ?? '')) : Buffer.from(String(args[0] ?? ''), 'base64').toString()

      // ─── File ───
      case 'FILE_NAME': {
        const p = String(args[0] ?? '')
        try { return new URL(p).pathname.split('/').pop() ?? p } catch { return p.split('/').pop() ?? p }
      }
      case 'FILE_EXT': {
        const name = String(args[0] ?? '').split('/').pop() ?? ''
        const dot = name.lastIndexOf('.')
        return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
      }
      case 'FILE_BASE_NAME': {
        const name = String(args[0] ?? '').split('/').pop() ?? ''
        const dot = name.lastIndexOf('.')
        return dot >= 0 ? name.slice(0, dot) : name
      }
      case 'MIME_TYPE': {
        const ext = (String(args[0] ?? '').split('.').pop() ?? '').toLowerCase()
        const mimes: Record<string, string> = {
          pdf: 'application/pdf', json: 'application/json', xml: 'application/xml', zip: 'application/zip',
          csv: 'text/csv', txt: 'text/plain', html: 'text/html', css: 'text/css', js: 'application/javascript',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
          mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
          doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        }
        return mimes[ext] ?? 'application/octet-stream'
      }
      // An Attachments field's list of file objects (or one file).
      case 'FILE_NAMES': {
        const list = Array.isArray(args[0]) ? args[0] : args[0] && typeof args[0] === 'object' ? [args[0]] : []
        return list.map((f: any) => (f && typeof f === 'object' ? String(f.name ?? '') : String(f ?? ''))).filter(Boolean).join(args[1] === undefined ? ', ' : String(args[1]))
      }
      case 'FILES_TOTAL_SIZE': {
        const list = Array.isArray(args[0]) ? args[0] : args[0] && typeof args[0] === 'object' ? [args[0]] : []
        return list.reduce((sum: number, f: any) => sum + (Number(f?.size) || 0), 0)
      }
      case 'FILE_SIZE_FORMAT': {
        const bytes = Number(args[0]) || 0
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`
        return `${(bytes / 1073741824).toFixed(1)} GB`
      }
      case 'DATA_URI': return `data:${String(args[1] ?? 'application/octet-stream')};base64,${String(args[0] ?? '')}`
      case 'DATA_URI_BASE64': {
        const uri = String(args[0] ?? '')
        const idx = uri.indexOf(',')
        return idx >= 0 ? uri.slice(idx + 1) : ''
      }
      case 'DATA_URI_MIME': {
        const uri = String(args[0] ?? '')
        const m = uri.match(/^data:([^;,]+)/)
        return m?.[1] ?? ''
      }

      default: return expr
    }
  } catch {
    return expr
  }
}
