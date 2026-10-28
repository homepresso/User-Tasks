import { describe, it, expect } from 'vitest'
import { evaluateFunction, FUNCTION_CATALOG } from '@/lib/expression-functions'

describe('evaluateFunction', () => {
  // ─── Text Functions ───
  describe('text functions', () => {
    it('LEFT returns leftmost characters', () => {
      expect(evaluateFunction('LEFT("Example", 2)')).toBe('Ex')
    })

    it('LEFT returns empty string for 0 length', () => {
      expect(evaluateFunction('LEFT("Hello", 0)')).toBe('')
    })

    it('RIGHT returns rightmost characters', () => {
      expect(evaluateFunction('RIGHT("Example", 3)')).toBe('ple')
    })

    it('MID returns substring from position (1-based)', () => {
      expect(evaluateFunction('MID("Example", 3, 2)')).toBe('am')
    })

    it('MID without length returns rest of string', () => {
      expect(evaluateFunction('MID("Example", 3)')).toBe('ample')
    })

    it('LENGTH returns string length', () => {
      expect(evaluateFunction('LENGTH("Hello")')).toBe(5)
    })

    it('UPPER converts to uppercase', () => {
      expect(evaluateFunction('UPPER("hello")')).toBe('HELLO')
    })

    it('LOWER converts to lowercase', () => {
      expect(evaluateFunction('LOWER("HELLO")')).toBe('hello')
    })

    it('TRIM removes whitespace', () => {
      expect(evaluateFunction('TRIM("  hi  ")')).toBe('hi')
    })

    it('REPLACE replaces all occurrences', () => {
      expect(evaluateFunction('REPLACE("hello", "l", "r")')).toBe('herro')
    })

    it('FIND returns 1-based position', () => {
      expect(evaluateFunction('FIND("Example", "amp")')).toBe(3)
    })

    it('FIND returns 0 when not found', () => {
      expect(evaluateFunction('FIND("Example", "xyz")')).toBe(0)
    })

    it('CONTAINS returns true for substring match', () => {
      expect(evaluateFunction('CONTAINS("hello", "ell")')).toBe(true)
    })

    it('CONTAINS returns false for no match', () => {
      expect(evaluateFunction('CONTAINS("hello", "xyz")')).toBe(false)
    })

    it('CONCAT joins strings', () => {
      expect(evaluateFunction('CONCAT("a", " ", "b")')).toBe('a b')
    })

    it('JOIN joins with separator', () => {
      expect(evaluateFunction('JOIN(", ", "a", "b", "c")')).toBe('a, b, c')
    })

    it('SPLIT splits string into array', () => {
      expect(evaluateFunction('SPLIT("a;b;c", ";")')).toEqual(['a', 'b', 'c'])
    })

    it('PAD_LEFT pads on the left', () => {
      expect(evaluateFunction('PAD_LEFT("5", 3, "0")')).toBe('005')
    })

    it('PAD_RIGHT pads on the right', () => {
      expect(evaluateFunction('PAD_RIGHT("5", 3, "0")')).toBe('500')
    })

    it('PROPER converts to title case', () => {
      expect(evaluateFunction('PROPER("hello world")')).toBe('Hello World')
    })

    it('URL_ENCODE encodes special characters', () => {
      expect(evaluateFunction('URL_ENCODE("a b")')).toBe('a%20b')
    })

    it('URL_DECODE decodes encoded characters', () => {
      expect(evaluateFunction('URL_DECODE("a%20b")')).toBe('a b')
    })
  })

  // ─── Math Functions ───
  describe('math functions', () => {
    it('ADD sums its arguments', () => {
      expect(evaluateFunction('ADD(2, 1)')).toBe(3)
      expect(evaluateFunction('ADD(1, 2, 3)')).toBe(6)
    })

    it('SUBTRACT subtracts the second from the first', () => {
      expect(evaluateFunction('SUBTRACT(10, 4)')).toBe(6)
    })

    it('MULTIPLY multiplies its arguments', () => {
      expect(evaluateFunction('MULTIPLY(199.99, 0.9)')).toBeCloseTo(179.991)
      expect(evaluateFunction('MULTIPLY(2, 3, 4)')).toBe(24)
    })

    it('DIVIDE divides and guards divide-by-zero', () => {
      expect(evaluateFunction('DIVIDE(10, 4)')).toBe(2.5)
      expect(evaluateFunction('DIVIDE(10, 0)')).toBeNull()
    })

    it('ABS returns absolute value', () => {
      expect(evaluateFunction('ABS(-5)')).toBe(5)
    })

    it('ROUND rounds to given precision', () => {
      expect(evaluateFunction('ROUND(1.567, 1)')).toBe(1.6)
    })

    it('ROUND_UP rounds up', () => {
      expect(evaluateFunction('ROUND_UP(1.1)')).toBe(2)
    })

    it('ROUND_DOWN rounds down', () => {
      expect(evaluateFunction('ROUND_DOWN(1.9)')).toBe(1)
    })

    it('MIN returns minimum value', () => {
      expect(evaluateFunction('MIN(3, 1, 5)')).toBe(1)
    })

    it('MAX returns maximum value', () => {
      expect(evaluateFunction('MAX(3, 1, 5)')).toBe(5)
    })

    it('AVG returns average', () => {
      expect(evaluateFunction('AVG(2, 4, 6)')).toBe(4)
    })

    it('SUM returns sum', () => {
      expect(evaluateFunction('SUM(1, 2, 3)')).toBe(6)
    })

    it('POWER raises to power', () => {
      expect(evaluateFunction('POWER(2, 3)')).toBe(8)
    })

    it('SQRT returns square root', () => {
      expect(evaluateFunction('SQRT(9)')).toBe(3)
    })

    it('MOD returns remainder', () => {
      expect(evaluateFunction('MOD(10, 3)')).toBe(1)
    })

    it('FORMAT_NUMBER formats with decimals', () => {
      expect(evaluateFunction('FORMAT_NUMBER(1234.5, 2)')).toBe('1234.50')
    })
  })

  // ─── Logical Functions ───
  describe('logical functions', () => {
    it('IF returns then value when truthy', () => {
      expect(evaluateFunction('IF(true, "Yes", "No")')).toBe('Yes')
    })

    it('IF returns else value when falsy', () => {
      expect(evaluateFunction('IF(false, "Yes", "No")')).toBe('No')
    })

    it('AND returns true when all true', () => {
      expect(evaluateFunction('AND(true, true)')).toBe(true)
    })

    it('AND returns false when any false', () => {
      expect(evaluateFunction('AND(true, false)')).toBe(false)
    })

    it('OR returns true when any true', () => {
      expect(evaluateFunction('OR(true, false)')).toBe(true)
    })

    it('OR returns false when all false', () => {
      expect(evaluateFunction('OR(false, false)')).toBe(false)
    })

    it('NOT negates boolean', () => {
      expect(evaluateFunction('NOT(true)')).toBe(false)
    })

    it('COALESCE returns first non-empty', () => {
      expect(evaluateFunction('COALESCE("", null, "hi")')).toBe('hi')
    })

    it('IS_EMPTY returns true for empty string', () => {
      expect(evaluateFunction('IS_EMPTY("")')).toBe(true)
    })

    it('IS_EMPTY returns false for non-empty', () => {
      expect(evaluateFunction('IS_EMPTY("hello")')).toBe(false)
    })
  })

  // ─── Conversion Functions ───
  describe('conversion functions', () => {
    it('TO_STRING converts number to string', () => {
      expect(evaluateFunction('TO_STRING(123)')).toBe('123')
    })

    it('TO_NUMBER converts string to number', () => {
      expect(evaluateFunction('TO_NUMBER("42")')).toBe(42)
    })

    it('TO_BOOLEAN converts "true" to true', () => {
      expect(evaluateFunction('TO_BOOLEAN("true")')).toBe(true)
    })

    it('TO_JSON serializes to JSON', () => {
      expect(evaluateFunction('TO_JSON("hello")')).toBe('"hello"')
    })

    it('FROM_JSON parses JSON string', () => {
      expect(evaluateFunction("FROM_JSON('{\"a\":1}')")).toEqual({ a: 1 })
    })

    it('FROM_JSON returns null for invalid JSON', () => {
      expect(evaluateFunction('FROM_JSON("invalid")')).toBe(null)
    })
  })

  // ─── Date Functions ───
  describe('date functions', () => {
    it('NOW returns ISO date string', () => {
      const result = evaluateFunction('NOW()')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('TODAY returns date-only string', () => {
      const result = evaluateFunction('TODAY()')
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('ADD_DAYS adds days to date', () => {
      const result = evaluateFunction('ADD_DAYS("2024-01-01", 7)')
      expect(result).toContain('2024-01-08')
    })

    it('SUBTRACT_DAYS subtracts days', () => {
      const result = evaluateFunction('SUBTRACT_DAYS("2024-01-08", 7)')
      expect(result).toContain('2024-01-01')
    })

    it('DAY_DIFF calculates days between dates', () => {
      expect(evaluateFunction('DAY_DIFF("2024-01-01", "2024-01-08")')).toBe(7)
    })

    it('DAY extracts day of month', () => {
      expect(evaluateFunction('DAY("2024-03-15")')).toBe(15)
    })

    it('MONTH extracts month number', () => {
      expect(evaluateFunction('MONTH("2024-03-15")')).toBe(3)
    })

    it('YEAR extracts year', () => {
      expect(evaluateFunction('YEAR("2024-03-15")')).toBe(2024)
    })

    it('FORMAT_DATE formats with pattern', () => {
      expect(evaluateFunction('FORMAT_DATE("2024-03-15T00:00:00Z", "DD/MM/YYYY")')).toBe('15/03/2024')
    })

    it('START_OF_MONTH returns first day', () => {
      expect(evaluateFunction('START_OF_MONTH("2024-03-15")')).toBe('2024-03-01')
    })

    it('END_OF_MONTH returns last day', () => {
      expect(evaluateFunction('END_OF_MONTH("2024-03-15")')).toBe('2024-03-31')
    })

    it('ADD_DAYS returns null for invalid date', () => {
      expect(evaluateFunction('ADD_DAYS("not-a-date", 5)')).toBe(null)
    })
  })

  // ─── List Functions ───
  describe('list functions', () => {
    it('COUNT returns array length', () => {
      // COUNT expects an array arg — test via nested FROM_JSON
      expect(evaluateFunction("COUNT(FROM_JSON('[1,2,3]'))")).toBe(3)
    })

    it('COUNT returns 0 for non-array', () => {
      expect(evaluateFunction('COUNT("not array")')).toBe(0)
    })
  })

  // ─── Regex Functions ───
  describe('regex functions', () => {
    it('REGEX_MATCH returns true on match', () => {
      expect(evaluateFunction('REGEX_MATCH("abc123", "\\d+")')).toBe(true)
    })

    it('REGEX_MATCH returns false on no match', () => {
      expect(evaluateFunction('REGEX_MATCH("abc", "\\d+")')).toBe(false)
    })

    it('REGEX_EXTRACT returns first match', () => {
      expect(evaluateFunction('REGEX_EXTRACT("abc123def", "\\d+")')).toBe('123')
    })

    it('REGEX_REPLACE replaces matches', () => {
      expect(evaluateFunction('REGEX_REPLACE("a1b2", "\\d", "X")')).toBe('aXbX')
    })
  })

  // ─── Data Functions ───
  describe('data functions', () => {
    it('GUID returns a UUID', () => {
      const result = evaluateFunction('GUID()')
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('BASE64_ENCODE encodes string', () => {
      expect(evaluateFunction('BASE64_ENCODE("Hello")')).toBe('SGVsbG8=')
    })

    it('BASE64_DECODE decodes string', () => {
      expect(evaluateFunction('BASE64_DECODE("SGVsbG8=")')).toBe('Hello')
    })
  })

  // ─── File Functions ───
  describe('file functions', () => {
    it('FILE_EXT extracts extension', () => {
      expect(evaluateFunction('FILE_EXT("report.pdf")')).toBe('pdf')
    })

    it('FILE_BASE_NAME extracts name without extension', () => {
      expect(evaluateFunction('FILE_BASE_NAME("report.pdf")')).toBe('report')
    })

    it('MIME_TYPE returns correct MIME', () => {
      expect(evaluateFunction('MIME_TYPE("doc.pdf")')).toBe('application/pdf')
    })

    it('FILE_SIZE_FORMAT formats bytes', () => {
      expect(evaluateFunction('FILE_SIZE_FORMAT(1048576)')).toBe('1.0 MB')
    })

    it('FILE_SIZE_FORMAT handles small files', () => {
      expect(evaluateFunction('FILE_SIZE_FORMAT(500)')).toBe('500 B')
    })

    it('DATA_URI builds data URI', () => {
      expect(evaluateFunction('DATA_URI("SGVs", "text/plain")')).toBe('data:text/plain;base64,SGVs')
    })
  })

  // ─── Nesting ───
  describe('nested function calls', () => {
    it('supports nested calls', () => {
      expect(evaluateFunction('LEFT(UPPER("hello"), 1)')).toBe('H')
    })

    it('supports double nesting', () => {
      expect(evaluateFunction('LENGTH(UPPER("hello"))')).toBe(5)
    })
  })

  // ─── Edge Cases ───
  describe('edge cases', () => {
    it('returns raw expression for unknown function', () => {
      expect(evaluateFunction('UNKNOWN_FUNC("a")')).toBe('UNKNOWN_FUNC("a")')
    })

    it('returns input string for non-function input', () => {
      expect(evaluateFunction('just a string')).toBe('just a string')
    })

    it('handles null args gracefully', () => {
      expect(evaluateFunction('UPPER(null)')).toBe('')
    })

    it('handles empty args', () => {
      expect(evaluateFunction('LENGTH("")')).toBe(0)
    })
  })
})

describe('FUNCTION_CATALOG', () => {
  it('has entries for all function categories', () => {
    const categories = new Set(FUNCTION_CATALOG.map(f => f.category))
    expect(categories).toContain('text')
    expect(categories).toContain('date')
    expect(categories).toContain('math')
    expect(categories).toContain('logical')
    expect(categories).toContain('conversion')
    expect(categories).toContain('list')
    expect(categories).toContain('regex')
    expect(categories).toContain('data')
    expect(categories).toContain('file')
  })

  it('has unique function names', () => {
    const names = FUNCTION_CATALOG.map(f => f.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('has examples for all functions', () => {
    for (const fn of FUNCTION_CATALOG) {
      expect(fn.example, `${fn.name} missing example`).toBeTruthy()
    }
  })
})
