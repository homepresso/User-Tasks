import { describe, expect, it } from 'vitest'

import { SECRET_PLACEHOLDER, resolveSecretPlaceholders, scrubSecretsForExport } from '@/lib/portability/scrub'

describe('scrubSecretsForExport', () => {
  it('replaces values under sensitive keys with the sentinel', () => {
    const scrubbed = scrubSecretsForExport({
      name: 'Slack',
      password: 'hunter2',
      client_secret: 'shhh',
      api_key: 'abc123',
      access_token: 'tok',
      base_url: 'https://slack.com',
    })

    expect(scrubbed.password).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.client_secret).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.api_key).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.access_token).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.name).toBe('Slack')
    expect(scrubbed.base_url).toBe('https://slack.com')
  })

  it('scrubs the blocklisted auth_config and db_config credential fields', () => {
    const scrubbed = scrubSecretsForExport({
      auth_config: { type: 'bearer', token: 't', password: 'p', key_value: 'k', key_name: 'X-Api-Key' },
      db_config: { host: 'db.internal', password: 'p2' },
    })

    expect(scrubbed.auth_config.token).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.auth_config.password).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.auth_config.key_value).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.auth_config.type).toBe('bearer')
    expect(scrubbed.auth_config.key_name).toBe('X-Api-Key')
    expect(scrubbed.db_config.password).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.db_config.host).toBe('db.internal')
  })

  it('replaces enc:v1: encrypted strings anywhere, even under non-sensitive keys', () => {
    const scrubbed = scrubSecretsForExport({
      config: {
        legacy_field: 'enc:v1:deadbeef',
        plain_field: 'visible',
        list: ['enc:v1:cafe', 'plain'],
      },
    })

    expect(scrubbed.config.legacy_field).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.config.plain_field).toBe('visible')
    expect(scrubbed.config.list).toEqual([SECRET_PLACEHOLDER, 'plain'])
  })

  it('walks nested objects and arrays, propagating sensitivity from parent keys', () => {
    const scrubbed = scrubSecretsForExport({
      integrations: [
        {
          name: 'ERP',
          config: {
            service_account: { client_email: 'svc@x.example', private_key: 'pem' },
            nested: { deeper: { my_api_token: 'tok' } },
          },
        },
      ],
    })

    const config = scrubbed.integrations[0].config
    // everything under a sensitive key (service_account) is scrubbed
    expect(config.service_account.client_email).toBe(SECRET_PLACEHOLDER)
    expect(config.service_account.private_key).toBe(SECRET_PLACEHOLDER)
    expect(config.nested.deeper.my_api_token).toBe(SECRET_PLACEHOLDER)
    expect(scrubbed.integrations[0].name).toBe('ERP')
  })

  it('leaves non-string values and null/undefined input untouched', () => {
    expect(scrubSecretsForExport(null)).toBeNull()
    const scrubbed = scrubSecretsForExport({ password: 42, retries: 3, enabled: true })
    expect(scrubbed.password).toBe(42)
    expect(scrubbed.retries).toBe(3)
    expect(scrubbed.enabled).toBe(true)
  })
})

describe('resolveSecretPlaceholders', () => {
  it('restores placeholder values from the existing record at the same path', () => {
    const resolved = resolveSecretPlaceholders(
      {
        name: 'Slack',
        config: { auth_config: { type: 'bearer', token: SECRET_PLACEHOLDER } },
      },
      {
        name: 'Slack',
        config: { auth_config: { type: 'bearer', token: 'real-token' } },
      },
    )

    expect(resolved.config.auth_config.token).toBe('real-token')
    expect(resolved.config.auth_config.type).toBe('bearer')
  })

  it('removes placeholder keys when no existing record is provided', () => {
    const resolved = resolveSecretPlaceholders({
      name: 'Slack',
      config: { auth_config: { type: 'bearer', token: SECRET_PLACEHOLDER }, password: SECRET_PLACEHOLDER },
    })

    expect(resolved.name).toBe('Slack')
    expect('token' in resolved.config.auth_config).toBe(false)
    expect('password' in resolved.config).toBe(false)
    expect(resolved.config.auth_config.type).toBe('bearer')
  })

  it('removes placeholder keys when the existing record lacks a value at that path', () => {
    const resolved = resolveSecretPlaceholders(
      { config: { token: SECRET_PLACEHOLDER, host: 'h' } },
      { config: { host: 'h' } },
    )

    expect('token' in resolved.config).toBe(false)
    expect(resolved.config.host).toBe('h')
  })

  it('drops placeholder array elements without an existing counterpart and restores those with one', () => {
    const withoutExisting = resolveSecretPlaceholders({ list: ['a', SECRET_PLACEHOLDER, 'b'] })
    expect(withoutExisting.list).toEqual(['a', 'b'])

    const withExisting = resolveSecretPlaceholders(
      { list: ['a', SECRET_PLACEHOLDER, 'b'] },
      { list: ['a', 'secret-item', 'b'] },
    )
    expect(withExisting.list).toEqual(['a', 'secret-item', 'b'])
  })

  it('passes non-placeholder values through unchanged', () => {
    const resolved = resolveSecretPlaceholders({ a: 1, b: 'x', c: { d: [true, null] } })
    expect(resolved).toEqual({ a: 1, b: 'x', c: { d: [true, null] } })
  })
})
