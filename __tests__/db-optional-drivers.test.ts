import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * snowflake-sdk, oracledb and mongodb are optionalDependencies. When one is not
 * installed, using its connector must fail with an actionable message.
 */

function missing(pkg: string) {
  return () => {
    const e = new Error(`Cannot find module '${pkg}' imported from /app/lib/db-connector.ts`) as Error & { code: string }
    e.code = 'ERR_MODULE_NOT_FOUND'
    throw e
  }
}

const base = { host: 'db.example.test', port: 1, database: 'd', username: 'u', password: 'p' }

afterEach(() => {
  vi.doUnmock('mongodb')
  vi.doUnmock('snowflake-sdk')
  vi.doUnmock('oracledb')
  vi.resetModules()
})

describe('optional database drivers', () => {
  it('recognises missing-module errors only for the named package', async () => {
    const { isMissingModuleError } = await import('@/lib/db-connector')
    expect(isMissingModuleError(Object.assign(new Error("Cannot find module 'mongodb'"), { code: 'MODULE_NOT_FOUND' }), 'mongodb')).toBe(true)
    expect(isMissingModuleError(new Error('Failed to load external module snowflake-sdk: Error: Cannot find module'), 'snowflake-sdk')).toBe(true)
    // Another package missing inside the driver is a different problem.
    expect(isMissingModuleError(Object.assign(new Error("Cannot find module 'bson'"), { code: 'MODULE_NOT_FOUND' }), 'mongodb')).toBe(false)
    expect(isMissingModuleError(new Error("Cannot find module 'bson'\nRequire stack:\n- /app/node_modules/mongodb/lib/index.js"), 'mongodb')).toBe(false)
    expect(isMissingModuleError(new Error('mongodb: authentication failed'), 'mongodb')).toBe(false)
    expect(isMissingModuleError(new Error("Cannot find package 'snowflake-sdk' imported from /app/x.js"), 'snowflake-sdk')).toBe(true)
  })

  it('loadOptionalDriver rethrows unrelated errors unchanged', async () => {
    const { loadOptionalDriver } = await import('@/lib/db-connector')
    const boom = new Error('native init failed')
    await expect(loadOptionalDriver('oracledb', async () => { throw boom })).rejects.toBe(boom)
    await expect(loadOptionalDriver('oracledb', async () => 'ok')).resolves.toBe('ok')
  })

  it.each([
    ['mongodb', 'mongodb', 'MongoDB', '^7.1.1'],
    ['snowflake', 'snowflake-sdk', 'Snowflake', '^2.4.0'],
    ['oracle', 'oracledb', 'Oracle', '^6.10.0'],
  ] as const)('%s connection test reports the missing %s package', async (type, pkg, label, version) => {
    vi.doMock(pkg, missing(pkg))
    const { testConnection } = await import('@/lib/db-connector')
    const result = await testConnection({ ...base, type, connectionString: type === 'mongodb' ? 'mongodb://db.example.test/d' : undefined })
    expect(result.success).toBe(false)
    expect(result.message).toBe(
      `The ${label} connector requires the optional package ${pkg}; install it with \`npm install ${pkg}@${version}\`, `
        + 'then rebuild (`npm run build`) and restart (Docker: rebuild the image with --build-arg INCLUDE_OPTIONAL_DB_DRIVERS=true). '
        + 'See /docs/self-hosting/optional-drivers.',
    )
  })

  it.each(['snowflake-sdk', 'oracledb', 'mongodb'] as const)('the build-time stub for a missing %s maps to the install message', async (pkg) => {
    const { loadOptionalDriver, missingDriverMessage } = await import('@/lib/db-connector')
    await expect(loadOptionalDriver(pkg, () => import(`@/lib/optional-drivers/missing-${pkg}`))).rejects.toThrow(missingDriverMessage(pkg))
  })

  it('queries surface the same error', async () => {
    vi.doMock('snowflake-sdk', missing('snowflake-sdk'))
    const { executeQuery } = await import('@/lib/db-connector')
    await expect(executeQuery({ ...base, type: 'snowflake' }, 'select 1')).rejects.toThrow(/requires the optional package snowflake-sdk/)
  })
})
