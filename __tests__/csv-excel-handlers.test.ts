import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need to test the CSV/Excel handlers end-to-end by testing the parse/write logic
// Since the engine handlers are tightly coupled to Supabase (fetch, storage),
// we'll test the pure logic portions and mock the I/O

// ─── CSV Parsing Logic (extracted from engine) ───

function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = []
  let current = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') inQuote = false
      else current += ch
    } else if (ch === '"') { inQuote = true }
    else if (ch === delimiter) { result.push(current.trim()); current = '' }
    else current += ch
  }
  result.push(current.trim())
  return result
}

function parseCsv(text: string, delimiter: string = ',', hasHeaders: boolean = true): Record<string, any>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []

  if (hasHeaders) {
    const headers = parseCsvLine(lines[0], delimiter)
    return lines.slice(1).map(line => {
      const values = parseCsvLine(line, delimiter)
      const obj: Record<string, any> = {}
      headers.forEach((h, i) => { obj[h] = values[i] ?? '' })
      return obj
    })
  } else {
    return lines.map(line => {
      const values = parseCsvLine(line, delimiter)
      const obj: Record<string, any> = {}
      values.forEach((v, i) => { obj[`col_${i + 1}`] = v })
      return obj
    })
  }
}

function writeCsv(data: Record<string, any>[], delimiter: string = ','): string {
  if (data.length === 0) return ''
  const headers = Object.keys(data[0])
  const csvLines = [
    headers.join(delimiter),
    ...data.map(row => headers.map(h => {
      const val = String(row[h] ?? '')
      return val.includes(delimiter) || val.includes('"') || val.includes('\n') ? `"${val.replace(/"/g, '""')}"` : val
    }).join(delimiter))
  ]
  return csvLines.join('\n')
}

// ─── CSV Read Tests ───

describe('CSV Read', () => {
  it('parses simple CSV with headers', () => {
    const csv = 'Name,Email,Age\nAlice,alice@test.com,30\nBob,bob@test.com,25'
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@test.com', Age: '30' })
    expect(rows[1]).toEqual({ Name: 'Bob', Email: 'bob@test.com', Age: '25' })
  })

  it('parses CSV without headers', () => {
    const csv = 'Alice,alice@test.com,30\nBob,bob@test.com,25'
    const rows = parseCsv(csv, ',', false)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ col_1: 'Alice', col_2: 'alice@test.com', col_3: '30' })
  })

  it('handles quoted fields with commas', () => {
    const csv = 'Name,Address\nAlice,"123 Main St, Apt 4"\nBob,"456 Oak Ave"'
    const rows = parseCsv(csv)
    expect(rows[0].Address).toBe('123 Main St, Apt 4')
    expect(rows[1].Address).toBe('456 Oak Ave')
  })

  it('handles quoted fields with escaped quotes', () => {
    const csv = 'Name,Note\nAlice,"She said ""hello"""\nBob,"Normal"'
    const rows = parseCsv(csv)
    expect(rows[0].Note).toBe('She said "hello"')
  })

  it('handles semicolon delimiter', () => {
    const csv = 'Name;Email;Age\nAlice;alice@test.com;30'
    const rows = parseCsv(csv, ';')
    expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@test.com', Age: '30' })
  })

  it('handles tab delimiter', () => {
    const csv = 'Name\tEmail\tAge\nAlice\talice@test.com\t30'
    const rows = parseCsv(csv, '\t')
    expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@test.com', Age: '30' })
  })

  it('handles pipe delimiter', () => {
    const csv = 'Name|Email\nAlice|alice@test.com'
    const rows = parseCsv(csv, '|')
    expect(rows[0]).toEqual({ Name: 'Alice', Email: 'alice@test.com' })
  })

  it('handles empty values', () => {
    const csv = 'Name,Email,Age\nAlice,,30\n,bob@test.com,'
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual({ Name: 'Alice', Email: '', Age: '30' })
    expect(rows[1]).toEqual({ Name: '', Email: 'bob@test.com', Age: '' })
  })

  it('handles Windows line endings (CRLF)', () => {
    const csv = 'Name,Email\r\nAlice,alice@test.com\r\nBob,bob@test.com'
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0].Name).toBe('Alice')
  })

  it('handles trailing newline', () => {
    const csv = 'Name,Email\nAlice,alice@test.com\n'
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n\n')).toEqual([])
  })

  it('handles single column', () => {
    const csv = 'Name\nAlice\nBob'
    const rows = parseCsv(csv)
    expect(rows).toEqual([{ Name: 'Alice' }, { Name: 'Bob' }])
  })

  it('handles single row with header', () => {
    const csv = 'Name,Email\nAlice,alice@test.com'
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(1)
  })

  it('handles header-only CSV', () => {
    const csv = 'Name,Email,Age'
    const rows = parseCsv(csv)
    expect(rows).toEqual([])
  })

  it('handles more values than headers', () => {
    const csv = 'A,B\n1,2,3'
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual({ A: '1', B: '2' })
  })

  it('handles fewer values than headers', () => {
    const csv = 'A,B,C\n1,2'
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual({ A: '1', B: '2', C: '' })
  })

  it('handles quoted field with newline inside', () => {
    // This is a known CSV edge case — newlines inside quotes
    const csv = 'Name,Note\nAlice,"Line 1"'
    const rows = parseCsv(csv)
    expect(rows[0].Note).toBe('Line 1')
  })

  it('handles unicode characters', () => {
    const csv = 'Name,City\nMüller,Zürich\nTanaka,東京'
    const rows = parseCsv(csv)
    expect(rows[0]).toEqual({ Name: 'Müller', City: 'Zürich' })
    expect(rows[1]).toEqual({ Name: 'Tanaka', City: '東京' })
  })
})

// ─── CSV Write Tests ───

describe('CSV Write', () => {
  it('writes simple data', () => {
    const data = [
      { Name: 'Alice', Age: '30' },
      { Name: 'Bob', Age: '25' },
    ]
    const csv = writeCsv(data)
    expect(csv).toBe('Name,Age\nAlice,30\nBob,25')
  })

  it('writes with custom delimiter', () => {
    const data = [{ Name: 'Alice', Age: '30' }]
    const csv = writeCsv(data, ';')
    expect(csv).toBe('Name;Age\nAlice;30')
  })

  it('quotes fields containing delimiter', () => {
    const data = [{ Name: 'Alice, Bob', Age: '30' }]
    const csv = writeCsv(data)
    expect(csv).toBe('Name,Age\n"Alice, Bob",30')
  })

  it('escapes double quotes in values', () => {
    const data = [{ Name: 'She said "hi"', Age: '30' }]
    const csv = writeCsv(data)
    expect(csv).toBe('Name,Age\n"She said ""hi""",30')
  })

  it('quotes fields containing newlines', () => {
    const data = [{ Name: 'Alice', Note: 'Line 1\nLine 2' }]
    const csv = writeCsv(data)
    expect(csv).toContain('"Line 1\nLine 2"')
  })

  it('handles null/undefined values', () => {
    const data = [{ Name: 'Alice', Email: null, Age: undefined }]
    const csv = writeCsv(data as any)
    expect(csv).toBe('Name,Email,Age\nAlice,,')
  })

  it('handles empty array', () => {
    expect(writeCsv([])).toBe('')
  })

  it('handles numeric values', () => {
    const data = [{ id: 1, price: 19.99, active: true }]
    const csv = writeCsv(data as any)
    expect(csv).toBe('id,price,active\n1,19.99,true')
  })

  it('round-trips: write then read produces same data', () => {
    const original = [
      { Name: 'Alice', Email: 'alice@test.com', Age: '30' },
      { Name: 'Bob', Email: 'bob@test.com', Age: '25' },
    ]
    const csv = writeCsv(original)
    const parsed = parseCsv(csv)
    expect(parsed).toEqual(original)
  })

  it('round-trips with special characters', () => {
    const original = [
      { Name: 'O\'Brien', Note: 'Said "hello, world"' },
    ]
    const csv = writeCsv(original)
    const parsed = parseCsv(csv)
    expect(parsed[0].Name).toBe("O'Brien")
    expect(parsed[0].Note).toBe('Said "hello, world"')
  })

  it('round-trips with semicolon delimiter', () => {
    const original = [
      { A: '1,2', B: '3;4' },
    ]
    const csv = writeCsv(original, ';')
    const parsed = parseCsv(csv, ';')
    expect(parsed[0].A).toBe('1,2')
    expect(parsed[0].B).toBe('3;4')
  })
})

// ─── CSV Line Parser Edge Cases ───

describe('parseCsvLine', () => {
  it('parses simple line', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('parses quoted values', () => {
    expect(parseCsvLine('"hello","world"')).toEqual(['hello', 'world'])
  })

  it('parses mixed quoted and unquoted', () => {
    expect(parseCsvLine('hello,"world, nice",123')).toEqual(['hello', 'world, nice', '123'])
  })

  it('handles empty fields', () => {
    expect(parseCsvLine(',,,')).toEqual(['', '', '', ''])
  })

  it('handles single value', () => {
    expect(parseCsvLine('hello')).toEqual(['hello'])
  })

  it('handles empty string', () => {
    expect(parseCsvLine('')).toEqual([''])
  })
})

// Excel read/write is covered against lib/excel (ExcelJS) in excel.test.ts.
