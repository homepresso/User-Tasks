import { describe, expect, it } from 'vitest'
import { applyODataFilter } from '@/lib/odata'

const rows = [
  { RowId: '1', employee_name: 'Andy Hayes', department: 'Finance', amount: 1250 },
  { RowId: '2', employee_name: 'Anna Stone', department: 'Operations', amount: 200 },
  { RowId: '3', employee_name: 'Brian Fox', department: 'Finance', amount: 50 },
]

describe('applyODataFilter', () => {
  it('supports contains', () => {
    const result = applyODataFilter(rows, "contains(employee_name,'andy')")
    expect(result.map((row) => row.RowId)).toEqual(['1'])
  })

  it('supports startswith', () => {
    const result = applyODataFilter(rows, "startswith(employee_name,'Ann')")
    expect(result.map((row) => row.RowId)).toEqual(['2'])
  })

  it('supports endswith', () => {
    const result = applyODataFilter(rows, "endswith(employee_name,'Fox')")
    expect(result.map((row) => row.RowId)).toEqual(['3'])
  })

  it('supports tolower in comparison expressions', () => {
    const result = applyODataFilter(rows, "tolower(department) eq 'finance'")
    expect(result.map((row) => row.RowId)).toEqual(['1', '3'])
  })

  it('supports mixed string and numeric clauses', () => {
    const result = applyODataFilter(rows, "contains(department,'fin') and amount gt 100")
    expect(result.map((row) => row.RowId)).toEqual(['1'])
  })
})
