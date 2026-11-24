import { describe, expect, it } from 'vitest'
import { lookupTargetField } from '@/lib/services/form-lookup'
import { normalizeTaskFields } from '@/lib/task-field-schema'

const TABLE = '0f000000-0000-4000-8000-0000000000d1'

describe('lookups inside repeating sections', () => {
  it('finds a lookup control inside a repeating section by its key (the form page asks for it by key)', () => {
    const fields = normalizeTaskFields([
      { key: 'deal', label: 'Deal', type: 'text' },
      { key: 'lines', label: 'Products', type: 'repeating_section', repeating_section: { fields: [
        { key: 'product', label: 'Product', type: 'lookup', lookup: { source: 'table', table_id: TABLE, value_column: 'product', display_columns: ['product'], search_columns: ['product'] } },
        { key: 'qty', label: 'Quantity', type: 'number' },
      ] } },
    ])
    expect(lookupTargetField(fields, 'product')?.lookup).toMatchObject({ source: 'table', table_id: TABLE })
    expect(lookupTargetField(fields, 'qty')).toBeNull()
    expect(lookupTargetField(fields, 'missing')).toBeNull()
  })
})
