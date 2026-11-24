import { spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * Split offline bundles: <name>.tar.part-NNN + <name>.tar.parts.json (signed by
 * the release key), as the edition build publishes them when a bundle is over
 * GitHub's 2 GiB release-asset limit. The join / verify paths of install.sh
 * and of the `usertasks` wrapper run for real (throwaway ed25519 key, real
 * tar; downloads use curl on file:// addresses).
 */

const ROOT = path.resolve(__dirname, '..')
const INSTALL = path.join(ROOT, 'deploy/install')
const SCRATCH = mkdtempSync(path.join(ROOT, '__tests__', '.install-parts-'))
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }))

const KEYS = generateKeyPairSync('ed25519')
const OTHER = generateKeyPairSync('ed25519')
const PUB = path.join(SCRATCH, 'release-key.pub.pem')
writeFileSync(PUB, KEYS.publicKey.export({ type: 'spki', format: 'pem' }).toString())
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

const DIR = path.join(SCRATCH, 'inst')
const SRC = path.join(SCRATCH, 'src')
const NAME = 'usertasks-edition-sharepoint-0.3.0-sp0.1.0-linux-amd64'
const TAR = `${NAME}.tar`

/** A small real bundle tar (bundle.json + padding, so it splits into several parts). */
function makeTar(): Buffer {
  const stage = path.join(SCRATCH, 'stage')
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(path.join(stage, NAME, 'release'), { recursive: true })
  writeFileSync(path.join(stage, NAME, 'bundle.json'), `${JSON.stringify({ format: 1, kind: 'usertasks.bundle', edition: 'sharepoint', edition_version: '0.3.0-sp0.1.0', core_version: '0.3.0' }, null, 2)}\n`)
  writeFileSync(path.join(stage, NAME, 'images.tar'), Buffer.alloc(6000, 7))
  const out = path.join(SCRATCH, TAR)
  const r = spawnSync('tar', ['-cf', out, '-C', stage, NAME], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  expect(r.status).toBe(0)
  return readFileSync(out)
}
const WHOLE = makeTar()

/** The parts and manifest in the format of the edition build's scripts/bundle-split.sh. */
function writeParts(dir: string, o: { partSize?: number; minified?: boolean; signer?: typeof KEYS; edit?: (m: any) => void; noSig?: boolean } = {}) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const size = o.partSize ?? 4096
  const parts: { name: string; size: number; sha256: string }[] = []
  for (let i = 0; i * size < WHOLE.length; i++) {
    const b = WHOLE.subarray(i * size, (i + 1) * size)
    const name = `${TAR}.part-${String(i + 1).padStart(3, '0')}`
    writeFileSync(path.join(dir, name), b)
    parts.push({ name, size: b.length, sha256: sha(b) })
  }
  const m: any = { format: 1, kind: 'usertasks.bundle-parts', name: TAR, size: WHOLE.length, sha256: sha(WHOLE), part_size: size, parts }
  o.edit?.(m)
  const text = o.minified
    ? JSON.stringify(m)
    : `{\n  "format": 1,\n  "kind": "usertasks.bundle-parts",\n  "name": "${m.name}",\n  "size": ${m.size},\n  "sha256": "${m.sha256}",\n  "part_size": ${m.part_size},\n  "parts": [\n${m.parts.map((p: any) => `    { "name": "${p.name}", "size": ${p.size}, "sha256": "${p.sha256}" }`).join(',\n')}\n  ]\n}\n`
  const mf = path.join(dir, `${TAR}.parts.json`)
  writeFileSync(mf, text)
  if (!o.noSig) writeFileSync(`${mf}.sig`, sign(null, Buffer.from(text), (o.signer ?? KEYS).privateKey))
  return { manifest: mf, parts }
}

const env = { PATH: process.env.PATH ?? '', HOME: SCRATCH, NO_COLOR: '1' } as unknown as NodeJS.ProcessEnv
/** The wrapper's functions (main skipped). */
const wrapper = (code: string) => spawnSync('sh', ['-c', `USERTASKS_WRAPPER_NO_MAIN=1; . "${path.join(INSTALL, 'usertasks')}"; DIR="${DIR}"; ${code}`], { encoding: 'utf8', env })
/** install.sh's functions: the script without its last line (the ut_install call). */
const INSTALL_FNS = path.join(SCRATCH, 'install-fns.sh')
writeFileSync(INSTALL_FNS, readFileSync(path.join(INSTALL, 'install.sh'), 'utf8').trimEnd().split('\n').slice(0, -1).join('\n'))
const installer = (code: string) => spawnSync('sh', ['-c', `set -eu; . "${INSTALL_FNS}"; DIR="${DIR}"; KEY="${DIR}/release-key.pub.pem"; ${code}`], { encoding: 'utf8', env })

beforeEach(() => {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(path.join(DIR, 'releases'), { recursive: true })
  writeFileSync(path.join(DIR, 'release-key.pub.pem'), readFileSync(PUB))
})

const KEYP = () => path.join(DIR, 'release-key.pub.pem')
const JOIN = () => path.join(DIR, 'releases', '.bundle-join')

describe.each([
  ['usertasks wrapper', wrapper, 'bundle_resolve'],
  ['install.sh', installer, 'ut_bundle_resolve'],
] as const)('split bundles: %s', (_label, run, resolve) => {
  const joinedOk = (r: ReturnType<typeof run>) => {
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    const file = r.stdout.match(/FILE=(.*) JOINED=1/)?.[1]
    expect(file).toBe(path.join(JOIN(), TAR))
    expect(readFileSync(file!).equals(WHOLE)).toBe(true)
  }

  it('joins the parts from the folder, the manifest or one of the parts, after the signature and every checksum', () => {
    const { manifest, parts } = writeParts(SRC)
    expect(parts.length).toBe(Math.ceil(WHOLE.length / 4096))
    expect(parts.length).toBeGreaterThanOrEqual(3)
    for (const target of [SRC, manifest, path.join(SRC, parts[1].name)]) {
      const r = run(`${resolve} "${target}" "${KEYP()}" "${JOIN()}"; echo "FILE=$BUNDLE_FILE JOINED=$BUNDLE_JOINED"`)
      joinedOk(r)
      expect(r.stdout).toContain(`signature of ${TAR}.parts.json`)
      expect(r.stdout).toContain(`${parts.length} parts (sizes and checksums)`)
    }
  })

  it('reads a minified manifest and a single part', () => {
    writeParts(SRC, { minified: true })
    joinedOk(run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"; echo "FILE=$BUNDLE_FILE JOINED=$BUNDLE_JOINED"`))
    writeParts(SRC, { partSize: WHOLE.length + 10 })
    joinedOk(run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"; echo "FILE=$BUNDLE_FILE JOINED=$BUNDLE_JOINED"`))
  })

  it('still takes a single .tar (and a folder holding one), untouched', () => {
    mkdirSync(path.join(SCRATCH, 'single'), { recursive: true })
    const tar = path.join(SCRATCH, 'single', TAR)
    writeFileSync(tar, WHOLE)
    for (const target of [tar, path.join(SCRATCH, 'single')]) {
      const r = run(`${resolve} "${target}" "${KEYP()}" "${JOIN()}"; echo "FILE=$BUNDLE_FILE JOINED=$BUNDLE_JOINED"`)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain(`FILE=${tar} JOINED=0`)
    }
    expect(existsSync(JOIN())).toBe(false)
  })

  it('names the missing, the cut-short and the damaged part', () => {
    const { parts } = writeParts(SRC)
    const n = parts.length
    rmSync(path.join(SRC, parts[2].name))
    let r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`part 3 of ${n} (${parts[2].name}) is missing: copy it next to ${TAR}.parts.json (or download it again)`)

    writeParts(SRC)
    truncateSync(path.join(SRC, parts[0].name), 100)
    r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`part 1 of ${n} (${parts[0].name}) is incomplete or damaged (wrong size): download it again`)

    writeParts(SRC)
    const p2 = path.join(SRC, parts[1].name)
    const b = readFileSync(p2); b[10] ^= 0xff; writeFileSync(p2, b)
    r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`part 2 of ${n} (${parts[1].name}) is damaged (checksum mismatch): download it again`)
    expect(existsSync(path.join(JOIN(), TAR))).toBe(false)
  })

  it('refuses a manifest without a signature, or signed by another key', () => {
    writeParts(SRC, { noSig: true })
    let r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`${TAR}.parts.json.sig is missing`)
    writeParts(SRC, { signer: OTHER })
    r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('signature check FAILED')
  })

  it('refuses unexpected part names, sizes that do not add up and a wrong whole checksum (even when signed)', () => {
    writeParts(SRC, { edit: (m) => { m.parts[1].name = '../../evil' } })
    let r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('lists an unexpected part (entry 2)')
    writeParts(SRC, { edit: (m) => { m.size += 1 } })
    r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.stderr).toContain('do not add up to the bundle size')
    writeParts(SRC, { edit: (m) => { m.sha256 = 'f'.repeat(64) } })
    r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.stderr).toContain('the joined bundle does not match')
    expect(existsSync(path.join(JOIN(), TAR))).toBe(false)
    writeParts(SRC, { edit: (m) => { m.name = 'x;rm -rf ~.tar' } })
    r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.stderr).toContain('is not a bundle parts manifest')
  })

  it('asks which bundle when a folder holds two', () => {
    writeParts(SRC)
    writeFileSync(path.join(SRC, 'other.tar.parts.json'), '{}')
    const r = run(`${resolve} "${SRC}" "${KEYP()}" "${JOIN()}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('holds more than one bundle')
  })
})

describe('split bundles: unpacking', () => {
  it('install.sh unpacks the joined bundle and removes the joined copy', () => {
    writeParts(SRC)
    const r = installer(`BUNDLE="${SRC}"; ut_open_bundle; echo "V=$BUNDLE_V DIR=$BUNDLE_DIR"`)
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain(`V=0.3.0 DIR=${path.join(DIR, 'releases', '.bundle', NAME)}`)
    expect(existsSync(JOIN())).toBe(false)
  })

  it('the wrapper (usertasks upgrade --bundle) unpacks parts the same way', () => {
    writeParts(SRC)
    // bundle_check needs SHA256SUMS.bundle: stop after the unpack to look at the result.
    const r = wrapper(`bundle_check() { echo "CHECK $1"; }; bundle_open "${SRC}"`)
    expect(r.stderr).toBe('')
    expect(r.stdout).toContain(`CHECK ${path.join(DIR, 'releases', '.bundle', NAME)}`)
    expect(existsSync(JOIN())).toBe(false)
  })
})

describe('split bundles: install.sh --bundle-download --from', () => {
  const OUT = path.join(SCRATCH, 'out')
  const url = () => pathToFileURL(path.join(SRC, `${TAR}.parts.json`)).href

  it('downloads the manifest, its signature and every part, resuming and replacing damaged ones', () => {
    const { parts } = writeParts(SRC)
    rmSync(OUT, { recursive: true, force: true })
    mkdirSync(OUT, { recursive: true })
    // Part 1 cut short (resumed), part 2 complete but damaged (downloaded again), part 3 already intact (kept).
    writeFileSync(path.join(OUT, parts[0].name), readFileSync(path.join(SRC, parts[0].name)).subarray(0, 1000))
    writeFileSync(path.join(OUT, parts[1].name), Buffer.alloc(parts[1].size, 1))
    writeFileSync(path.join(OUT, parts[2].name), readFileSync(path.join(SRC, parts[2].name)))
    const r = installer(`ut_parts_download "${url()}" "${OUT}"`)
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(`part 3 of ${parts.length} already here`)
    expect(r.stdout).toContain(`Downloading part 1 of ${parts.length}`)
    expect(r.stdout).toContain(`Downloading part 2 of ${parts.length}`)
    for (const p of parts) expect(sha(readFileSync(path.join(OUT, p.name)))).toBe(p.sha256)
    expect(r.stdout).toContain('Offline bundle ready')
    // What was carried across installs.
    const j = installer(`ut_bundle_resolve "${OUT}" "$KEY" "${JOIN()}"; echo "FILE=$BUNDLE_FILE"`)
    expect(j.status).toBe(0)
    expect(readFileSync(path.join(JOIN(), TAR)).equals(WHOLE)).toBe(true)
  })

  it('stops on a damaged source part and on a missing one, naming it', () => {
    const { parts } = writeParts(SRC)
    rmSync(OUT, { recursive: true, force: true })
    const p = path.join(SRC, parts[1].name)
    const b = readFileSync(p); b[0] ^= 0xff; writeFileSync(p, b)
    let r = installer(`ut_parts_download "${url()}" "${OUT}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`part 2 of ${parts.length} (${parts[1].name}) arrived damaged`)
    expect(existsSync(path.join(OUT, parts[1].name))).toBe(false)
    writeParts(SRC)
    rmSync(path.join(SRC, parts[2].name))
    r = installer(`ut_parts_download "${url()}" "${OUT}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`the download of part 3 of ${parts.length} stopped: run the same command again to resume it`)
  })

  it('refuses a manifest signed by another key, and --from without --bundle-download', () => {
    writeParts(SRC, { signer: OTHER })
    const r = installer(`ut_parts_download "${url()}" "${path.join(SCRATCH, 'out2')}"`)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('signature check FAILED')
    expect(existsSync(path.join(SCRATCH, 'out2', `${TAR}.part-001`))).toBe(false)
    const o = spawnSync('sh', [path.join(INSTALL, 'install.sh'), '--from', url()], { encoding: 'utf8', env })
    expect(o.stderr).toContain('--from goes with --bundle-download')
  })
})

describe('split bundles: PowerShell has the same paths', () => {
  it('install.ps1 and usertasks.ps1 verify the signature, each part and the whole before unpacking', () => {
    const ps = readFileSync(path.join(INSTALL, 'install.ps1'), 'utf8')
    for (const s of ['function Read-UtParts', 'function Join-UtParts', 'function Resolve-UtBundle', 'function Save-UtParts', 'function Get-UtResume', '[string]$From', 'Resolve-UtBundle $Bundle $key $join']) expect(ps).toContain(s)
    const join = ps.slice(ps.indexOf('function Join-UtParts'), ps.indexOf('\n}', ps.indexOf('function Join-UtParts')))
    const at = (s: string) => { const i = join.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i }
    expect(at('Test-UtSignature')).toBeLessThan(at('Test-UtPart'))
    expect(at('Test-UtPart')).toBeLessThan(at('CopyTo'))
    expect(at('CopyTo')).toBeLessThan(at('Get-FileHash'))
    const w = readFileSync(path.join(INSTALL, 'usertasks.ps1'), 'utf8')
    for (const s of ['function Read-Parts', 'function Join-Parts', 'function Resolve-Bundle', "Resolve-Bundle $file (Join-Path $script:Dir 'release-key.pub.pem') $join"]) expect(w).toContain(s)
    // The same messages as the sh scripts.
    for (const text of [ps, w]) {
      expect(text).toContain('is missing: copy it next to $leaf (or download it again)')
      expect(text).toContain('is damaged (checksum mismatch): download it again')
    }
  })
})
