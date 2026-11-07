/**
 * SFTP connector against a real SSH server. Skipped unless SFTP_TEST_URL is
 * set, e.g. with a throwaway container:
 *
 *   docker run -d --rm --name sftp-test -p 127.0.0.1:2222:22 atmoz/sftp:alpine app:fake-sftp-password:1001::upload
 *   SFTP_TEST_URL=sftp://app:fake-sftp-password@127.0.0.1:2222/upload npx vitest run __tests__/connectors-sftp-live.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runConnectorTemplate } from './helpers/connector-contract'

const RAW = process.env.SFTP_TEST_URL
const d = RAW ? describe : describe.skip
const u = RAW ? new URL(RAW) : null
const base = u ? { host: u.hostname, port: u.port || '22', default_path: u.pathname || '/', restrict_to_default_path: 'true' } : {}
const creds = u ? { auth_method: 'password', username: decodeURIComponent(u.username), password: decodeURIComponent(u.password), private_key: '', private_key_passphrase: '' } : {}

d('sftp connector (real server)', () => {
  const saved = process.env.ALLOW_PRIVATE_EGRESS
  let fingerprint = ''
  const dir = `t${Date.now().toString(36)}`

  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    // Unpinned: refused, and the error names the server's key.
    const { testSftpConnection } = await import('@/lib/sftp-executor')
    const probe = await testSftpConnection({ ...base, ...creds, _executor: 'sftp' })
    expect(probe.success).toBe(false)
    expect(probe.message).toMatch(/not pinned/)
    fingerprint = probe.fingerprint ?? ''
    expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
    const ok = await testSftpConnection({ ...base, ...creds, host_key_fingerprint: fingerprint })
    expect(ok).toMatchObject({ success: true })
  }, 30_000)
  afterAll(() => {
    if (saved === undefined) delete process.env.ALLOW_PRIVATE_EGRESS
    else process.env.ALLOW_PRIVATE_EGRESS = saved
  })

  const run = (template: string, inputs: Record<string, any>, extra: Record<string, any> = {}) =>
    runConnectorTemplate({ connector: 'sftp', template, config: { ...base, host_key_fingerprint: fingerprint, ...extra }, credentials: creds, inputs }).then((r) => r.result)

  it('round-trips files through every operation', async () => {
    expect((await run('create_directory', { path: `${dir}/a/b` })).data).toMatchObject({ created: true })
    expect((await run('upload_file', { remote_path: `${dir}/a/hello.txt`, content: 'héllo "sftp"\n' })).data).toMatchObject({ size: 14 })
    expect((await run('upload_file', { remote_path: `${dir}/a/hello.txt`, content: 'more\n', mode: 'append' })).status).toBe(200)
    expect((await run('upload_file', { remote_path: `${dir}/a/hello.txt`, content: 'x', mode: 'create' })).status).toBeGreaterThanOrEqual(400)
    expect((await run('upload_file', { remote_path: `${dir}/a/bin.dat`, content: Buffer.from([0, 1, 2, 250]).toString('base64'), encoding: 'base64' })).data).toMatchObject({ size: 4 })

    const list = await run('list_directory', { path: `${dir}/a` })
    expect(list.data.files.map((f: any) => [f.name, f.type])).toEqual([['b', 'directory'], ['bin.dat', 'file'], ['hello.txt', 'file']])

    expect((await run('download_file', { remote_path: `${dir}/a/hello.txt` })).data).toMatchObject({ encoding: 'utf8', content: 'héllo "sftp"\nmore\n' })
    expect((await run('download_file', { remote_path: `${dir}/a/bin.dat` })).data).toMatchObject({ encoding: 'base64', content: Buffer.from([0, 1, 2, 250]).toString('base64') })

    expect((await run('chmod', { path: `${dir}/a/hello.txt`, mode: '0600' })).status).toBe(200)
    expect((await run('file_stat', { path: `${dir}/a/hello.txt` })).data).toMatchObject({ permissions: '0600', isFile: true })
    expect((await run('rename_move', { from_path: `${dir}/a/hello.txt`, to_path: `${dir}/a/b/moved.txt` })).status).toBe(200)
    expect((await run('file_exists', { path: `${dir}/a/hello.txt` })).data).toMatchObject({ exists: false })
    expect((await run('file_exists', { path: `${dir}/a/b/moved.txt` })).data).toMatchObject({ exists: true, type: 'file' })
    expect((await run('download_file', { remote_path: `${dir}/missing.txt` })).status).toBe(404)

    for (const f of ['a/b/moved.txt', 'a/bin.dat']) expect((await run('delete_file', { remote_path: `${dir}/${f}` })).status).toBe(200)
    for (const p of ['a/b', 'a', '']) expect((await run('remove_directory', { path: `${dir}/${p}`.replace(/\/$/, '') })).status).toBe(200)
  }, 60_000)

  it('stays inside the default path and refuses another host key', async () => {
    const out = await run('list_directory', { path: '/' })
    expect(out).toMatchObject({ status: 403, data: { code: 'outside_root' } })
    await expect(run('list_directory', { path: '' }, { host_key_fingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })).rejects.toThrow(/host key mismatch/)
    await expect(runConnectorTemplate({ connector: 'sftp', template: 'list_directory', config: { ...base, host_key_fingerprint: fingerprint }, credentials: { ...creds, password: 'wrong-fake' }, inputs: { path: '' } })).rejects.toThrow(/authentication failed/)
  }, 30_000)
})
