import { defineConfig } from 'vitest/config'
import path from 'path'

const RLS_SNAPSHOT = '__tests__/rls-semantics-db.test.ts'
// Also holds one fixture transaction across many tables (tenant isolation of the dashboard reads).
const READS_ISOLATION = '__tests__/ui-reads-isolation-db.test.ts'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The RLS snapshot holds one transaction across every RLS table for a few
    // seconds; it runs after the other files so DB tests that take table
    // locks (e.g. ALTER TABLE event_stream) are not blocked by it.
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          include: ['__tests__/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
          exclude: [RLS_SNAPSHOT, READS_ISOLATION, '**/node_modules/**'],
          sequence: { groupOrder: 0 },
        },
      },
      { extends: true, test: { name: 'rls-snapshot', include: [RLS_SNAPSHOT, READS_ISOLATION], sequence: { groupOrder: 1 } } },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'lib/workflow-engine.ts',
        'lib/workflow-node-handlers.ts',
        'lib/workflow-schema.ts',
        'lib/workflow-validation.ts',
        'lib/workflow-utils.ts',
        'lib/expression-resolver.ts',
        'lib/expression-functions.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // Package tests run against sources, not the built dist/.
      '@usertasks/sdk': path.resolve(__dirname, 'packages/sdk/src/index.ts'),
    },
  },
})
