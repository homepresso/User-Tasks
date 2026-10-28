import { describe, it, expect } from 'vitest'
import { resolveExpression, safeEval } from '@/lib/expression-resolver'

describe('resolveExpression', () => {
  const ctx = {
    variables: {
      name: 'Alice',
      count: 42,
      nested: { deep: { value: 'found' } },
      items: [1, 2, 3],
      empty: '',
      zero: 0,
    },
    task: {
      title: 'Test Task',
      priority: 'high',
      metadata: { source: 'api' },
    },
  }

  // ─── Variable Resolution ───
  describe('variable resolution', () => {
    it('resolves a simple variable', () => {
      expect(resolveExpression('{{name}}', ctx)).toBe('Alice')
    })

    it('resolves a numeric variable and returns raw value for single expression', () => {
      expect(resolveExpression('{{count}}', ctx)).toBe(42)
    })

    it('resolves nested variable path', () => {
      expect(resolveExpression('{{nested.deep.value}}', ctx)).toBe('found')
    })

    it('resolves array variable', () => {
      expect(resolveExpression('{{items}}', ctx)).toEqual([1, 2, 3])
    })

    it('returns empty string for unknown variable in template', () => {
      expect(resolveExpression('Hello {{unknown}}!', ctx)).toBe('Hello !')
    })

    it('resolves multiple variables in a template', () => {
      expect(resolveExpression('{{name}} has {{count}} items', ctx)).toBe('Alice has 42 items')
    })

    it('resolves task fields via task prefix', () => {
      expect(resolveExpression('{{task.title}}', ctx)).toBe('Test Task')
    })

    it('resolves task fields directly', () => {
      expect(resolveExpression('{{title}}', { variables: {}, task: { title: 'Direct' } }))
        .toBe('Direct')
    })

    it('resolves nested task metadata', () => {
      expect(resolveExpression('{{task.metadata.source}}', ctx)).toBe('api')
    })

    it('is case-insensitive for variable names', () => {
      expect(resolveExpression('{{NAME}}', ctx)).toBe('Alice')
    })

    it('prefers variables over task fields', () => {
      const mixed = { variables: { title: 'Var Title' }, task: { title: 'Task Title' } }
      expect(resolveExpression('{{title}}', mixed)).toBe('Var Title')
    })
  })

  // ─── Non-string Input ───
  describe('non-string input', () => {
    it('returns numbers as-is', () => {
      expect(resolveExpression(42, ctx)).toBe(42)
    })

    it('returns booleans as-is', () => {
      expect(resolveExpression(true, ctx)).toBe(true)
    })

    it('returns null as-is', () => {
      expect(resolveExpression(null, ctx)).toBe(null)
    })

    it('returns undefined as-is', () => {
      expect(resolveExpression(undefined, ctx)).toBe(undefined)
    })

    it('returns objects as-is', () => {
      const obj = { key: 'val' }
      expect(resolveExpression(obj, ctx)).toBe(obj)
    })
  })

  // ─── Function Expressions ───
  describe('function expressions', () => {
    it('resolves inline function expression', () => {
      expect(resolveExpression('{{=UPPER("hello")}}', ctx)).toBe('HELLO')
    })

    it('resolves function with variable arguments', () => {
      expect(resolveExpression('{{=UPPER({{name}})}}', ctx)).toBe('ALICE')
    })

    it('resolves function mixed with text', () => {
      expect(resolveExpression('Result: {{=SUM(1, 2, 3)}}', ctx)).toBe('Result: 6')
    })

    it('resolves multiple function expressions', () => {
      expect(resolveExpression('{{=UPPER("a")}} and {{=LOWER("B")}}', ctx)).toBe('A and b')
    })

    it('resolves nested functions in template', () => {
      expect(resolveExpression('{{=LEFT(UPPER({{name}}), 1)}}', ctx)).toBe('A')
    })

    it('returns raw value for single function expression', () => {
      expect(resolveExpression('{{=SUM(1, 2, 3)}}', ctx)).toBe(6)
    })
  })

  // ─── Balanced Brace Parsing ───
  describe('balanced brace parsing', () => {
    it('handles nested parentheses in functions', () => {
      expect(resolveExpression('{{=IF(true, "yes", "no")}}', ctx)).toBe('yes')
    })

    it('handles quoted strings with special characters', () => {
      expect(resolveExpression('{{=UPPER("hello world")}}', ctx)).toBe('HELLO WORLD')
    })

    it('handles unclosed function gracefully', () => {
      // Unclosed {{= should not crash
      const result = resolveExpression('{{=UPPER("test"', ctx)
      expect(result).toBe('{{=UPPER("test"')
    })
  })

  // ─── Edge Cases ───
  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(resolveExpression('', ctx)).toBe('')
    })

    it('handles string with no expressions', () => {
      expect(resolveExpression('plain text', ctx)).toBe('plain text')
    })

    it('resolves empty variable to empty string in template', () => {
      expect(resolveExpression('val={{empty}}!', ctx)).toBe('val=!')
    })

    it('resolves zero correctly', () => {
      expect(resolveExpression('{{zero}}', ctx)).toBe(0)
    })
  })

  // ─── Bare identifiers inside {{=FUNC(...)}} (stress-test regressions) ───
  describe('bare variable identifiers in function expressions', () => {
    const mathCtx = { variables: { retail_price: 38.987, prod_idx: 2, sku: 'wdg-001', flag: true, price: 199.99, disc_pct: 10 } }

    it('resolves a bare numeric variable: ROUND(retail_price, 2)', () => {
      expect(resolveExpression('{{=ROUND(retail_price, 2)}}', mathCtx)).toBe(38.99)
    })

    it('resolves bare variables in embedded templates: [ADD(prod_idx, 1)]', () => {
      expect(resolveExpression('[{{=ADD(prod_idx, 1)}}]', mathCtx)).toBe('[3]')
    })

    it('tolerates whitespace inside the braces: {{= ADD(prod_idx, 1) }}', () => {
      expect(resolveExpression('[{{= ADD(prod_idx, 1) }}]', mathCtx)).toBe('[3]')
    })

    it('quotes string variable values so commas cannot break parsing', () => {
      expect(resolveExpression('{{=UPPER(sku)}}', mathCtx)).toBe('WDG-001')
      const trickyCtx = { variables: { note: 'a, b (c)' } }
      expect(resolveExpression('{{=LENGTH(note)}}', trickyCtx)).toBe(8)
    })

    it('mixes bare identifiers with literals and math', () => {
      expect(resolveExpression('{{=MULTIPLY(price, 0.9)}}', mathCtx)).toBeCloseTo(179.991)
    })

    it('leaves unknown identifiers, booleans, and quoted strings untouched', () => {
      expect(resolveExpression('{{=IF(flag, "yes", "no")}}', mathCtx)).toBe('yes')
      expect(resolveExpression('{{=CONCAT("disc_pct: ", disc_pct)}}', mathCtx)).toBe('disc_pct: 10')
    })

    it('still supports the braced spelling inside functions', () => {
      expect(resolveExpression('{{=ROUND({{retail_price}}, 2)}}', mathCtx)).toBe(38.99)
    })

    it('nested function calls are not treated as variables', () => {
      expect(resolveExpression('{{=UPPER(LEFT(sku, 3))}}', mathCtx)).toBe('WDG')
    })
  })
})

describe('safeEval', () => {
  it('evaluates simple arithmetic', () => {
    expect(safeEval('2 + 3')).toBe(5)
  })

  it('evaluates multiplication', () => {
    expect(safeEval('4 * 5')).toBe(20)
  })

  it('evaluates parentheses', () => {
    expect(safeEval('(2 + 3) * 4')).toBe(20)
  })

  it('evaluates modulo', () => {
    expect(safeEval('10 % 3')).toBe(1)
  })

  it('returns 0 for empty string', () => {
    expect(safeEval('')).toBe(0)
  })

  it('strips letters and evaluates remaining expression', () => {
    // 'abc + 1' → '+ 1' after stripping letters → evaluates to 1
    expect(safeEval('abc + 1')).toBe(1)
  })

  it('returns 0 for very long expression', () => {
    expect(safeEval('1+'.repeat(150) + '1')).toBe(0)
  })

  it('returns 0 for Infinity result', () => {
    expect(safeEval('1/0')).toBe(0)
  })
})

// ─── Workflow parity: scope-aware list/table functions (consumer-release audit) ───
describe('workflow resolveExpression — scope-aware functions', () => {
  const ctx = { variables: { items: [{ price: 10, qty: 2 }, { price: 5, qty: 1 }], name: 'Smith, John', 'user.email': 'a@b.c' }, task: { title: 'T1' } }

  it('COUNT / SUM(PLUCK) work against array variables (same as forms)', () => {
    expect(resolveExpression('{{=COUNT(items)}}', ctx)).toBe(2)
    expect(resolveExpression('{{=SUM(PLUCK(items, "price"))}}', ctx)).toBe(15)
    expect(resolveExpression('{{=COUNT({{items}})}}', ctx)).toBe(2) // braced array arg
  })

  it('braced string args are quoted — commas cannot corrupt arg parsing', () => {
    expect(resolveExpression('{{=UPPER({{name}})}}', ctx)).toBe('SMITH, JOHN')
    expect(resolveExpression('{{=CONTAINS({{name}}, "Smith")}}', ctx)).toBe(true)
  })

  it('flat dotted variable keys resolve', () => {
    expect(resolveExpression('{{user.email}}', ctx)).toBe('a@b.c')
  })

  it('task.* resolves inside functions via scope', () => {
    expect(resolveExpression('{{=UPPER(task.title)}}', ctx)).toBe('T1')
  })

  it('array literals and JOIN over arrays work', () => {
    expect(resolveExpression('{{=COUNT([1,2,3])}}', ctx)).toBe(3)
    expect(resolveExpression('{{=JOIN(", ", PLUCK(items, "price"))}}', ctx)).toBe('10, 5')
  })
})
