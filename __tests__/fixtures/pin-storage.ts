import { afterAll, beforeAll } from 'vitest'

/**
 * For test files that exercise the Supabase Storage path (a mocked
 * `.storage` client or the local stack's buckets): run them on the default
 * storage provider even when the suite runs with STORAGE_PROVIDER=local/s3/….
 */
export function pinDefaultStorageProvider(): void {
  let saved: string | undefined
  beforeAll(() => {
    saved = process.env.STORAGE_PROVIDER
    delete process.env.STORAGE_PROVIDER
  })
  afterAll(() => {
    if (saved === undefined) delete process.env.STORAGE_PROVIDER
    else process.env.STORAGE_PROVIDER = saved
  })
}
