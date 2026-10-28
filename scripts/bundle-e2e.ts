/**
 * `npm run bundle:e2e -- <bundle.tar> [--fingerprint aa:bb:…] [--keep]`: the
 * air-gapped bundle, end to end, on a host with no internet
 * (docs/setup-air-gapped.md#release-gate).
 *
 * The "offline host" is a Docker-in-Docker container on an internal Docker
 * network: its daemon starts with no images and can't pull. Inside it:
 * `bundle.sh verify`, `bundle.sh load`, `bundle.sh up` (the on-premises
 * Compose profile with OpenBao KMS), `bundle.sh smoke`, and the CLI from
 * npm/ installed with `npm install -g` in a container with no network.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from 'node:util'

const DIND_IMAGE = 'docker:28-dind'
const NAME = 'usertasks-airgap-host'
const NETWORK = 'usertasks-airgap'

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: { fingerprint: { type: 'string' }, keep: { type: 'boolean' } },
})
const tarball = positionals[0] ? path.resolve(positionals[0]) : ''
if (!tarball) {
  console.error('usage: npm run bundle:e2e -- <bundle.tar> [--fingerprint aa:bb:…] [--keep]')
  process.exit(2)
}

function sh(cmd: string, args: string[], opts: { allowFail?: boolean; show?: boolean } = {}): { status: number; out: string } {
  console.log(`$ ${cmd} ${args.join(' ')}`.slice(0, 300))
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  if (opts.show !== false) process.stdout.write(out.replace(/^/gm, '    '))
  if (res.status !== 0 && !opts.allowFail) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}… exited with ${res.status}`)
  return { status: res.status ?? 1, out }
}

const host = (script: string, opts: { allowFail?: boolean } = {}) => sh('docker', ['exec', NAME, 'sh', '-c', script], opts)
const checks: { name: string; ok: boolean }[] = []
const record = (name: string, ok: boolean) => { checks.push({ name, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`) }

function cleanup() {
  sh('docker', ['rm', '-f', '-v', NAME], { allowFail: true, show: false })
  sh('docker', ['network', 'rm', NETWORK], { allowFail: true, show: false })
}

async function main() {
  cleanup()
  sh('docker', ['network', 'create', '--internal', NETWORK])
  sh('docker', ['run', '-d', '--privileged', '--name', NAME, '--network', NETWORK, '-e', 'DOCKER_TLS_CERTDIR=', DIND_IMAGE])
  for (let i = 0; i < 60 && host('docker info >/dev/null 2>&1', { allowFail: true }).status !== 0; i++) await new Promise((r) => setTimeout(r, 1000))

  // The offline host: no images, no way out.
  const images = host('docker images -q | wc -l').out.trim()
  const pull = host('docker pull -q hello-world', { allowFail: true })
  const wget = host('wget -q -T 8 -O /dev/null https://registry.npmjs.org/', { allowFail: true })
  record(`offline host: no images (${images}), docker pull and HTTPS fail`, images === '0' && pull.status !== 0 && wget.status !== 0)

  sh('docker', ['cp', tarball, `${NAME}:/bundle.tar`], { show: false })
  host('mkdir -p /opt && tar -xf /bundle.tar -C /opt && rm /bundle.tar && ls /opt')
  const dir = `/opt/${path.basename(tarball).replace(/\.tar$/, '')}`
  // docker:dind is Alpine: sha256sum and OpenSSL 3 are there; no Node.js.
  record('bundle.sh verify (checksums, signature, fingerprint)', host(`cd ${dir} && ./bundle.sh verify ${values.fingerprint ? `--fingerprint ${values.fingerprint}` : ''}`, { allowFail: true }).status === 0)
  const tampered = host(`cd ${dir} && cp README.md /tmp/r && echo x >> README.md && ./bundle.sh verify; s=$?; cp /tmp/r README.md; exit $s`, { allowFail: true })
  record('bundle.sh verify rejects a changed file', tampered.status !== 0)
  record('bundle.sh load', host(`cd ${dir} && ./bundle.sh load`, { allowFail: true }).status === 0)
  record('bundle.sh up (on-premises Compose profile, OpenBao KMS)', host(`cd ${dir} && ./bundle.sh up`, { allowFail: true }).status === 0)
  record('bundle.sh smoke', host(`cd ${dir} && ./bundle.sh smoke`, { allowFail: true }).status === 0)
  const cli = host(`docker run --rm --network none -v ${dir}/npm:/npm:ro node:22-alpine sh -c 'npm install -g --offline --no-audit --no-fund /npm/usertasks-cli-*.tgz >/dev/null && usertasks --version'`, { allowFail: true })
  record('CLI installs from npm/ with no network (npm install -g)', cli.status === 0)
}

main()
  .catch((error) => record(`e2e run: ${(error as Error).message}`, false))
  .finally(() => {
    if (!values.keep) cleanup()
    const failed = checks.filter((c) => !c.ok).length
    console.log(`\nAir-gapped bundle E2E: ${failed ? `FAILED (${failed} of ${checks.length})` : `PASSED (${checks.length} checks)`}`)
    process.exit(failed ? 1 : 0)
  })
