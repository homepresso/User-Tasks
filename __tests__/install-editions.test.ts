import { spawnSync } from 'node:child_process'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Editions in the one-line installer (deploy/install/usertasks, install.sh):
 * the licence check with usertasks.com, the signed edition manifest, the
 * pull by signed digest and the image check, offline bundles. `curl` and
 * `docker` are stand-ins on PATH (nothing is downloaded or pulled); the
 * signature checks are real (throwaway ed25519 key).
 */

const ROOT = path.resolve(__dirname, '..')
const INSTALL = path.join(ROOT, 'deploy/install')
const SCRATCH = mkdtempSync(path.join(ROOT, '__tests__', '.install-editions-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

const BIN = path.join(SCRATCH, 'bin')
const DIR = path.join(SCRATCH, 'inst')
mkdirSync(BIN, { recursive: true })

// Stand-in curl: answers POSTs to …/pull-token with $FAKE_BODY / $FAKE_STATUS and keeps the request body.
writeFileSync(path.join(BIN, 'curl'), `#!/bin/sh
out=""; data=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out=$2; shift 2 ;; --data-binary) data=\${2#@}; shift 2 ;; -w|-A|-H|--retry|--connect-timeout|--max-time) shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac
done
echo "$url" >> "$FAKE_LOG"
[ -n "$data" ] && cp "$data" "$FAKE_REQUEST"
cp "$FAKE_BODY" "$out"
printf '%s' "\${FAKE_STATUS:-200}"
`)
// Stand-in docker: records calls; knows the images pulled, tagged or loaded, whose id is $FAKE_IMAGE_ID.
writeFileSync(path.join(BIN, 'docker'), `#!/bin/sh
case "$1" in
  login) cat > "$FAKE_LOGIN"; echo "login $*" >> "$FAKE_LOG" ;;
  image) for a; do ref=$a; done; grep -qxF "$ref" "$FAKE_IMAGES" 2>/dev/null || exit 1; printf '%s\\n' "$FAKE_IMAGE_ID" ;;
  pull) for a; do ref=$a; done; echo "$ref" >> "$FAKE_IMAGES"; echo "$*" >> "$FAKE_LOG" ;;
  tag) echo "$3" >> "$FAKE_IMAGES"; echo "$*" >> "$FAKE_LOG" ;;
  load) echo "$FAKE_LOAD_TAG" >> "$FAKE_IMAGES"; echo "$*" >> "$FAKE_LOG" ;;
  *) echo "$*" >> "$FAKE_LOG" ;;
esac
`)
chmodSync(path.join(BIN, 'curl'), 0o755)
chmodSync(path.join(BIN, 'docker'), 0o755)

const KEYS = generateKeyPairSync('ed25519')
const PUB = path.join(SCRATCH, 'release-key.pub.pem')
writeFileSync(PUB, KEYS.publicKey.export({ type: 'spki', format: 'pem' }).toString())
const dg = (c: string) => `sha256:${c.repeat(64)}`

function editionJson(o: Record<string, unknown> = {}) {
  return Buffer.from(`${JSON.stringify({
    format: 1, kind: 'usertasks.edition', edition: 'sharepoint', edition_version: '0.3.0-sp1.2.0', core_version: '0.3.0', extension_version: '1.2.0',
    built_at: '2026-11-30T00:00:00Z', index_digest: dg('a'), platforms: { 'linux/amd64': { manifest: dg('b'), config: dg('c') } }, ...o,
  }, null, 2)}\n`)
}

function tokenResponse(manifest = editionJson(), signature = sign(null, manifest, KEYS.privateKey), o: Record<string, unknown> = {}) {
  return JSON.stringify({
    registry: 'usertasks.com', repository: 'editions/sharepoint', username: 'licence', password: 'utpt1.SECRET-TOKEN.mac',
    expires_at: '2026-12-01T12:30:00.000Z', image: `usertasks.com/editions/sharepoint@${dg('a')}`, edition: 'sharepoint',
    edition_version: '0.3.0-sp1.2.0', core_version: '0.3.0', extension_version: '1.2.0', index_digest: dg('a'),
    edition_manifest: manifest.toString('base64'), edition_signature: Buffer.from(signature).toString('base64'),
    licence_id: 'lic_1', trial: true, licence_expires_at: '2026-12-31T00:00:00.000Z', licence_cutoff_at: '2027-01-01T00:00:00.000Z', ...o,
  })
}

const files = {
  body: path.join(SCRATCH, 'body.json'), request: path.join(SCRATCH, 'request.json'), log: path.join(SCRATCH, 'calls.log'),
  login: path.join(SCRATCH, 'login.txt'), licence: path.join(SCRATCH, 'trial.licence'), images: path.join(SCRATCH, 'images.txt'),
}
writeFileSync(files.licence, '{"kind":"usertasks.licence","licence_id":"lic_1"}\n')

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  for (const f of [files.log, files.request, files.login, files.images]) rmSync(f, { force: true })
  writeFileSync(files.log, '')
})

function wrapper(code: string, env: Record<string, string> = {}) {
  return spawnSync('sh', ['-c', `USERTASKS_WRAPPER_NO_MAIN=1; . "${path.join(INSTALL, 'usertasks')}"; DIR="${DIR}"; ${code}`], {
    encoding: 'utf8',
    env: {
      PATH: `${BIN}:${process.env.PATH ?? ''}`, HOME: SCRATCH, NO_COLOR: '1', USERTASKS_EDITION_API: 'https://api.test/x',
      FAKE_BODY: files.body, FAKE_REQUEST: files.request, FAKE_LOG: files.log, FAKE_LOGIN: files.login, FAKE_IMAGES: files.images, FAKE_LOAD_TAG: 'usertasks.com/editions/sharepoint:0.3.0-sp1.2.0', FAKE_IMAGE_ID: dg('c'), ...env,
    } as unknown as NodeJS.ProcessEnv,
  })
}

const request = `edition_request sharepoint "${files.licence}" 0.3.0 install "${DIR}/w" "${PUB}"`

describe('installer: licence-gated edition download', () => {
  it('sends the licence, verifies the signed manifest, pulls by digest, checks and tags the image, logs out', () => {
    writeFileSync(files.body, tokenResponse())
    const r = wrapper(`${request} && edition_pull && echo "IMG=$EDITION_IMAGE VER=$ED_VERSION CORE=$ED_CORE PASS=[$ED_PASS]"`)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('IMG=usertasks.com/editions/sharepoint:0.3.0-sp1.2.0 VER=0.3.0-sp1.2.0 CORE=0.3.0 PASS=[]')
    expect(r.stdout).toContain('licence accepted (trial)')
    const req = JSON.parse(readFileSync(files.request, 'utf8'))
    expect(Buffer.from(req.licence, 'base64').toString()).toBe(readFileSync(files.licence, 'utf8'))
    expect(req).toMatchObject({ version: '0.3.0', purpose: 'install' })
    const calls = readFileSync(files.log, 'utf8').trim().split('\n')
    expect(calls[0]).toBe('https://api.test/x/sharepoint/pull-token')
    expect(calls.slice(1)).toEqual([
      'login login usertasks.com -u licence --password-stdin',
      `pull usertasks.com/editions/sharepoint@${dg('a')}`,
      'logout usertasks.com',
      `tag usertasks.com/editions/sharepoint@${dg('a')} usertasks.com/editions/sharepoint:0.3.0-sp1.2.0`,
    ])
    expect(readFileSync(files.login, 'utf8')).toBe('utpt1.SECRET-TOKEN.mac')
    // The credential is never left in the install folder.
    const left = readdirSync(path.join(DIR, 'w')).map((f) => readFileSync(path.join(DIR, 'w', f), 'utf8')).join('\n')
    expect(left).not.toContain('SECRET-TOKEN')
    expect(existsSync(path.join(DIR, 'w', 'edition.json'))).toBe(true)
  })

  it('refuses a manifest the release key did not sign', () => {
    writeFileSync(files.body, tokenResponse(editionJson(), sign(null, editionJson({ core_version: '0.2.0' }), KEYS.privateKey)))
    const r = wrapper(`${request} || { echo "ERR=$EDITION_ERROR"; exit 3; }`)
    expect(r.status).toBe(3)
    expect(r.stdout).toContain('ERR=signature check FAILED')
  })

  it('refuses download details that differ from the signed manifest', () => {
    writeFileSync(files.body, tokenResponse(undefined, undefined, { index_digest: dg('9') }))
    const r = wrapper(`${request} || { echo "ERR=$EDITION_ERROR"; exit 3; }`)
    expect(r.status).toBe(3)
    expect(r.stdout).toContain('do not match the signed edition manifest')
  })

  it('passes the server refusal through (expired licence) and changes nothing', () => {
    writeFileSync(files.body, JSON.stringify({ error: 'This trial licence expired on 2026-11-01 00:00 UTC. Downloads and upgrades need an active licence; a UserTasks installation that is already running keeps running.', code: 'licence_expired' }))
    const r = wrapper(`${request} || { echo "CODE=$EDITION_ERROR_CODE ERR=$EDITION_ERROR"; exit 3; }`, { FAKE_STATUS: '403' })
    expect(r.status).toBe(3)
    expect(r.stdout).toContain('CODE=licence_expired ERR=This trial licence expired on 2026-11-01 00:00 UTC.')
    expect(readFileSync(files.log, 'utf8')).not.toContain('pull usertasks.com')
  })

  it('does not use an image that is not one of the signed digests', () => {
    writeFileSync(files.body, tokenResponse())
    const r = wrapper(`${request} && { edition_pull || { echo "ERR=$EDITION_ERROR"; exit 3; }; }`, { FAKE_IMAGE_ID: dg('7') })
    expect(r.status).toBe(3)
    expect(r.stdout).toContain('is not the one the signed edition manifest names')
    expect(readFileSync(files.log, 'utf8')).not.toContain('tag ')
  })

  it('reads JSON string fields with escapes, and base64 round-trips', () => {
    writeFileSync(files.body, '{"error":"say \\"hi\\" now","code":"x","trial":false}')
    const r = wrapper(`json_field error "${files.body}"; json_bool trial "${files.body}"; b64_encode "${files.licence}" > "${DIR}/b"; b64_decode "${DIR}/b" "${DIR}/d"; cat "${DIR}/d"`)
    expect(r.stdout.split('\n').slice(0, 3)).toEqual(['say "hi" now', 'false', '{"kind":"usertasks.licence","licence_id":"lic_1"}'])
  })
})

describe('installer: offline bundles', () => {
  function makeBundle(tamper = false) {
    const b = path.join(DIR, 'b', 'usertasks-edition-sharepoint-0.3.0-sp1.2.0-linux-amd64')
    mkdirSync(path.join(b, 'release'), { recursive: true })
    const manifest = editionJson()
    writeFileSync(path.join(b, 'edition.json'), manifest)
    writeFileSync(path.join(b, 'edition.json.sig'), sign(null, manifest, KEYS.privateKey))
    writeFileSync(path.join(b, 'images.tar'), 'images')
    writeFileSync(path.join(b, 'bundle.json'), JSON.stringify({ format: 1, kind: 'usertasks.bundle', edition: 'sharepoint', edition_version: '0.3.0-sp1.2.0', core_version: '0.3.0', platform: 'linux/amd64', image: 'usertasks.com/editions/sharepoint:0.3.0-sp1.2.0' }, null, 2))
    const sums = ['bundle.json', 'edition.json', 'edition.json.sig', 'images.tar'].map((f) => `${createHash('sha256').update(readFileSync(path.join(b, f))).digest('hex')}  ${f}`)
    writeFileSync(path.join(b, 'SHA256SUMS.bundle'), `${sums.join('\n')}\n`)
    if (tamper) writeFileSync(path.join(b, 'images.tar'), 'swapped')
    mkdirSync(DIR, { recursive: true })
    writeFileSync(path.join(DIR, 'release-key.pub.pem'), readFileSync(PUB))
    return b
  }

  it('checks the bundle, the edition signature and the loaded image', () => {
    const b = makeBundle()
    const r = wrapper(`bundle_check "${b}" && bundle_load "${b}" && echo "IMAGE=$IMAGE ED=$ED_EDITION $ED_VERSION"`)
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain('IMAGE=usertasks.com/editions/sharepoint:0.3.0-sp1.2.0 ED=sharepoint 0.3.0-sp1.2.0')
    expect(readFileSync(files.log, 'utf8')).toContain(`load -i ${b}/images.tar`)
    expect(existsSync(path.join(DIR, 'editions', '0.3.0-sp1.2.0', 'edition.json.sig'))).toBe(true)
  })

  it('refuses a changed bundle and a foreign image', () => {
    const tampered = makeBundle(true)
    const r = wrapper(`bundle_check "${tampered}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('checksum mismatch for images.tar')
    const b = makeBundle()
    const r2 = wrapper(`bundle_check "${b}" && bundle_load "${b}"`, { FAKE_IMAGE_ID: dg('7') })
    expect(r2.status).toBe(1)
    expect(r2.stderr).toContain('is not the one the signed edition manifest names')
  })
})

describe('installer: edition options', () => {
  const run = (args: string[]) => spawnSync('sh', [path.join(INSTALL, 'install.sh'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: SCRATCH, NO_COLOR: '1' } as unknown as NodeJS.ProcessEnv })

  it('needs a licence for an edition, knows only real editions', () => {
    expect(run(['--edition', 'sharepoint', '--non-interactive']).stderr).toContain('needs your licence: --licence <file>')
    expect(run(['--edition', 'nope']).stderr).toContain('unknown edition: nope')
    expect(run(['--edition', 'sharepoint', '--licence', path.join(SCRATCH, 'missing.licence')]).stderr).toContain('licence file not found')
    expect(run(['--bundle-download', '--edition', 'sharepoint']).stderr).toContain('--bundle-download needs --edition sharepoint and --licence')
  })

  it('documents the edition options in --help and the wrapper usage', () => {
    const help = run(['--help']).stdout
    expect(help).toContain('--edition sharepoint')
    expect(help).toContain('--bundle-download')
    const usage = spawnSync('sh', [path.join(INSTALL, 'usertasks'), 'help'], { encoding: 'utf8' }).stdout
    expect(usage).toContain('[--edition sharepoint|core] [--licence <file>] [--bundle <offline bundle>]')
    expect(usage).toContain('usertasks bundle-download --edition sharepoint --licence <file>')
  })
})
