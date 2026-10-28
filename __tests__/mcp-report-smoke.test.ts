import { describe, expect, it } from 'vitest'

import { REPORT_SOURCES } from '@/lib/report-sources'
import { getDerivedReportColumnKeys, normalizeReportConfig } from '@/lib/report-config'
import { buildSourceSpecificRecipes } from '@/lib/mcp/tools/reports'

describe('MCP report smoke suite', () => {
  it('keeps canonical source-specific recipes normalized and free of source-prefixed aggregate aliases', () => {
    for (const source of REPORT_SOURCES) {
      const recipes = buildSourceSpecificRecipes(source)
      expect(recipes.length, `${source.key} should expose at least one report recipe`).toBeGreaterThan(0)

      for (const recipe of recipes) {
        const config = normalizeReportConfig(recipe.config)
        const derivedKeys = getDerivedReportColumnKeys(config)

        expect(config.data_source, `${source.key}/${recipe.name} should set data_source`).toBe(source.key)
        expect(Array.isArray(config.columns), `${source.key}/${recipe.name} should have columns`).toBe(true)
        expect((config.columns ?? []).length, `${source.key}/${recipe.name} should have at least one column`).toBeGreaterThan(0)

        for (const column of config.columns ?? []) {
          expect(String(column), `${source.key}/${recipe.name} should not use source-prefixed _count columns`).not.toMatch(/^[^.]+\._count$/)
        }
        for (const filter of config.filters ?? []) {
          expect(String(filter.field ?? ''), `${source.key}/${recipe.name} filters should not use source-prefixed _count columns`).not.toMatch(/^[^.]+\._count$/)
        }
        if (config.sort?.field) {
          expect(String(config.sort.field), `${source.key}/${recipe.name} sort should not use source-prefixed _count columns`).not.toMatch(/^[^.]+\._count$/)
        }

        for (const aggregation of config.aggregations ?? []) {
          const expectedKey = aggregation.field ? `${aggregation.fn}_${aggregation.field}` : aggregation.fn
          expect(derivedKeys.has(expectedKey) || expectedKey === 'COUNT', `${source.key}/${recipe.name} should expose derived aggregation keys`).toBe(true)
        }
      }
    }
  })
})
