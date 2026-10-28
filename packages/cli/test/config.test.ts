import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigStore, defaultConfigPath } from '../src/config'
import { tempConfigPath } from './helpers'

const posix = process.platform !== 'win32'
const mode = (path: string) => statSync(path).mode & 0o777

describe('defaultConfigPath', () => {
  it('uses XDG_CONFIG_HOME, then ~/.config, then %APPDATA% on Windows', () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/home/u')).toBe(join('/xdg', 'usertasks', 'config.json'))
    expect(defaultConfigPath({}, 'darwin', '/home/u')).toBe(join('/home/u', '.config', 'usertasks', 'config.json'))
    expect(defaultConfigPath({ APPDATA: 'C:\\AppData' }, 'win32', 'C:\\Users\\u')).toBe(join('C:\\AppData', 'usertasks', 'config.json'))
  })
})

describe('ConfigStore', () => {
  it('returns an empty config when the file does not exist', () => {
    expect(new ConfigStore(tempConfigPath()).read()).toEqual({ version: 1, profiles: {} })
  })

  it.runIf(posix)('creates the directory 0700 and the file 0600', () => {
    const path = tempConfigPath()
    const store = new ConfigStore(path)
    store.write({ version: 1, profiles: { default: { url: 'https://x.test', credentials: { type: 'api_key', api_key: 'secret' } } } })
    expect(mode(dirname(path))).toBe(0o700)
    expect(mode(path)).toBe(0o600)
    expect(store.read().profiles.default.credentials).toEqual({ type: 'api_key', api_key: 'secret' })
  })

  it.runIf(posix)('tightens an existing over-permissive directory and file', () => {
    const path = tempConfigPath()
    mkdirSync(dirname(path), { recursive: true, mode: 0o755 })
    chmodSync(dirname(path), 0o755)
    writeFileSync(path, '{"version":1,"profiles":{}}', { mode: 0o644 })
    new ConfigStore(path).write({ version: 1, profiles: {} })
    expect(mode(dirname(path))).toBe(0o700)
    expect(mode(path)).toBe(0o600)
  })

  it('writes atomically via temp file + rename and leaves no temp files', () => {
    const path = tempConfigPath()
    const store = new ConfigStore(path)
    store.write({ version: 1, profiles: { a: { url: 'https://a.test' } } })
    const before = statSync(path).ino
    for (let i = 0; i < 5; i++) store.update((config) => (config.current_profile = `p${i}`))
    expect(statSync(path).ino).not.toBe(before) // replaced, not rewritten in place
    expect(readdirSync(dirname(path))).toEqual(['config.json'])
    expect(JSON.parse(readFileSync(path, 'utf8')).current_profile).toBe('p4')
  })

  it('rejects a corrupt config file with a helpful message', () => {
    const path = tempConfigPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{nope')
    expect(() => new ConfigStore(path).read()).toThrow(/not valid JSON/)
  })
})
