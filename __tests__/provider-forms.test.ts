import { describe, expect, it } from 'vitest'
import { PROVIDER_AREAS, PROVIDER_IDS } from '@/lib/config/schema'
import { isCredentialKey } from '@/lib/config/instance-settings'
import { OPTION_ENV, areaFieldOptions, fieldSchema, parseFieldValue, providerFields, switchFlagFields } from '@/lib/config/provider-forms'
import { PROVIDER_OPTION_ENV } from '@/lib/config'

/**
 * The provider option forms of Settings → Infrastructure stay in step with
 * the providers: every option a provider reads (its *_OPTION_ENV list) has
 * a field, credential options are secret fields (and nothing else is), and
 * the zod field schemas accept what the CLI's --set would and refuse junk.
 */

describe('provider forms', () => {
  it('cover every provider option, with the same environment variables as lib/config', () => {
    for (const area of PROVIDER_AREAS) {
      const env = PROVIDER_OPTION_ENV[area] ?? {}
      expect(OPTION_ENV[area] ?? {}).toEqual(env)
      const covered = areaFieldOptions(area)
      for (const option of Object.keys(env)) expect(covered.has(option), `${area}.${option} has no form field`).toBe(true)
      for (const option of covered) expect(option in env, `${area}.${option} is not a known option`).toBe(true)
    }
  })

  it('mark exactly the credential options as secret fields', () => {
    for (const area of PROVIDER_AREAS) {
      for (const id of PROVIDER_IDS[area]) {
        for (const field of providerFields(area, id)) {
          // secrets.<option> rows that are store options are never credentials of the db store.
          const credential = isCredentialKey(`${area}.${field.option}`)
          expect(field.secret, `${area}/${id} ${field.option}`).toBe(credential)
        }
      }
    }
  })

  it('give each provider its own options plus the area-wide ones, without duplicates', () => {
    expect(providerFields('email', 'smtp').map((f) => f.option)).toEqual(expect.arrayContaining(['from', 'reply_to', 'smtp_host', 'smtp_password']))
    expect(providerFields('email', 'console').map((f) => f.option)).not.toContain('smtp_host')
    expect(providerFields('realtime', 'sse')).toEqual([])
    for (const area of PROVIDER_AREAS) {
      for (const id of PROVIDER_IDS[area]) {
        const options = providerFields(area, id).map((f) => f.option)
        expect(new Set(options).size, `${area}/${id}`).toBe(options.length)
      }
    }
    expect(switchFlagFields('db').map((f) => f.flag)).toEqual(['target-url', 'target-host', 'target-port', 'target-database', 'target-user', 'target-password', 'target-sslmode', 'target-ca', 'target-auth', 'prepare-only'])
    expect(switchFlagFields('db').filter((f) => f.secret).map((f) => f.flag)).toEqual(['target-url', 'target-password'])
  })

  it('validate typed values', () => {
    const port = { label: 'Port', kind: 'number' as const, min: 1 }
    expect(fieldSchema(port).safeParse('587').success).toBe(true)
    expect(fieldSchema(port).safeParse('0').success).toBe(false)
    expect(fieldSchema(port).safeParse('5x').success).toBe(false)
    expect(fieldSchema({ label: 'B', kind: 'boolean' }).safeParse('True').data).toBe('true')
    expect(fieldSchema({ label: 'B', kind: 'boolean' }).safeParse('yes').success).toBe(false)
    expect(fieldSchema({ label: 'U', kind: 'url' }).safeParse('rediss://cache:6380').success).toBe(true)
    expect(fieldSchema({ label: 'U', kind: 'url' }).safeParse('not a url').success).toBe(false)
    expect(fieldSchema({ label: 'J', kind: 'json' }).safeParse('{"logos":"a"}').success).toBe(true)
    expect(fieldSchema({ label: 'J', kind: 'json' }).safeParse('{logos').success).toBe(false)
    expect(fieldSchema({ label: 'E', kind: 'email' }).safeParse('UserTasks <no@example.com>').success).toBe(true)
    expect(fieldSchema({ label: 'S', kind: 'select', choices: ['a', 'b'] }).safeParse('c').success).toBe(false)
  })

  it('accept secret:// references for any field, and refuse malformed ones', () => {
    const field = providerFields('email', 'smtp').find((f) => f.option === 'smtp_port')!
    expect(parseFieldValue(field, 'secret://smtp_port')).toEqual({ ok: true, value: 'secret://smtp_port', ref: true })
    expect(parseFieldValue(field, 'secret://creds#port')).toMatchObject({ ok: true, ref: true })
    expect(parseFieldValue(field, 'secret://')).toMatchObject({ ok: false })
    expect(parseFieldValue(field, 'secret://a b')).toMatchObject({ ok: false })
  })
})
