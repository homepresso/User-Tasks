import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConfigStore } from '../src/config'
import { tempConfigPath } from './helpers'

const failRename = vi.hoisted(() => ({ on: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (failRename.on) throw Object.assign(new Error('EIO: simulated'), { code: 'EIO' })
      return actual.renameSync(from, to)
    },
  }
})

describe('ConfigStore atomic write failure', () => {
  it('keeps the previous file intact and removes the temp file when the rename fails', () => {
    const path = tempConfigPath()
    const store = new ConfigStore(path)
    store.write({ version: 1, current_profile: 'keep', profiles: {} })
    failRename.on = true
    try {
      expect(() => store.write({ version: 1, current_profile: 'lost', profiles: {} })).toThrow(/simulated/)
    } finally {
      failRename.on = false
    }
    expect(store.read().current_profile).toBe('keep')
    expect(readdirSync(dirname(path))).toEqual(['config.json'])
  })
})
