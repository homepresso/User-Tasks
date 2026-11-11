import { describe, expect, it } from 'vitest'
import * as app from '@/lib/forms/custom-controls/contract'
import * as pkg from '../packages/form-control/src/contract'

/** @user-tasks/form-control ships a copy of the contract: its values must match the app's. */
describe('@user-tasks/form-control contract parity', () => {
  it('exports the same constants as lib/forms/custom-controls/contract', () => {
    const constants = (mod: Record<string, unknown>) => Object.fromEntries(Object.entries(mod).filter(([, v]) => typeof v !== 'function'))
    const ours = constants(app as Record<string, unknown>)
    const theirs = constants(pkg as Record<string, unknown>)
    expect(Object.keys(theirs).sort()).toEqual(Object.keys(ours).sort())
    for (const key of Object.keys(ours)) {
      const a = ours[key]
      const b = theirs[key]
      expect(a instanceof Set ? [...a].sort() : a, key).toEqual(b instanceof Set ? [...(b as Set<unknown>)].sort() : b)
    }
  })
})
