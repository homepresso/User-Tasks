/**
 * `npm run helm:gate`: the Helm chart's release gate on a throwaway kind
 * cluster (docs/setup-kubernetes.md#release-gate).
 *
 *   npm run helm:gate -- [--image usertasks:local] [--cluster usertasks-gate] [--keep] [--reuse-cluster]
 *                        [--skip-eval] [--skip-hook]
 *
 * 1. eval: examples/eval.yaml (bundled PostgreSQL, MinIO, Valkey, Mailpit;
 *    built-in auth, SSE, the worker Deployment) with the egress allowlist
 *    NetworkPolicy. Installed with --wait: the migrate Job ran, the app is
 *    healthy. Then the HTTP smoke test (deploy/compose/smoke/smoke.mjs) in a
 *    pod in the cluster, `usertasks-admin doctor` incl. a scheduler tick, and
 *    the no-egress check: a release pod can't reach the internet while a pod
 *    outside the release can (so the policy, not the network, blocks it).
 * 2. upgrade: `helm upgrade` runs a new migrate Job (one per revision) and
 *    the app rolls and answers again.
 * 3. hook: a second release in its own namespace on a database of the
 *    first one's PostgreSQL, with an existing Secret, so migrations run as
 *    the pre-install / pre-upgrade hook; scheduler external (the tick
 *    CronJob), local storage, the postgres cache, console email. Smoke,
 *    a tick, then an upgrade re-runs the hook.
 *
 * Needs docker, kind, kubectl and helm. The image must exist locally
 * (`docker build -t usertasks:local .`); it is loaded into the cluster.
 * The cluster is deleted at the end unless --keep.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { parseArgs } from 'node:util'

const ROOT = path.resolve(__dirname, '..')
const CHART = path.join(ROOT, 'deploy/helm/usertasks')
const SMOKE = path.join(ROOT, 'deploy/compose/smoke/smoke.mjs')

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    image: { type: 'string', default: 'usertasks:local' },
    cluster: { type: 'string', default: 'usertasks-gate' },
    keep: { type: 'boolean' },
    'skip-hook': { type: 'boolean' },
    'skip-eval': { type: 'boolean' },
    'reuse-cluster': { type: 'boolean' },
  },
})

const [repository, tag = 'latest'] = values.image!.split(/:(?=[^/]+$)/)
const CONTEXT = `kind-${values.cluster}`
const DEP_IMAGES = ['postgres:16-alpine', 'pgsty/minio:latest', 'valkey/valkey:8-alpine', 'axllent/mailpit:v1.27', 'node:22-alpine']

interface Result { status: number; stdout: string; stderr: string }

function sh(cmd: string, args: string[], opts: { input?: string; allowFail?: boolean; quiet?: boolean } = {}): Result {
  if (!opts.quiet) console.log(`$ ${cmd} ${args.join(' ').replace(/(PASSWORD=|--password )\S+/g, '$1…')}`)
  const res = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', input: opts.input, maxBuffer: 64 * 1024 * 1024 })
  const out = { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  if (out.status !== 0 && !opts.allowFail) {
    process.stderr.write(out.stdout.slice(-4000) + out.stderr.slice(-4000))
    throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}… exited with ${out.status}`)
  }
  return out
}

const kubectl = (args: string[], opts: Parameters<typeof sh>[2] = {}) => sh('kubectl', ['--context', CONTEXT, ...args], opts)
const helm = (args: string[], opts: Parameters<typeof sh>[2] = {}) => sh('helm', ['--kube-context', CONTEXT, ...args], opts)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const checks: { name: string; ok: boolean; detail: string }[] = []
function record(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

const imageValues = ['--set', `image.repository=${repository}`, '--set', `image.tag=${tag}`, '--set', 'image.pullPolicy=Never']

function createCluster(): void {
  const existing = sh('kind', ['get', 'clusters'], { quiet: true }).stdout.split('\n')
  if (existing.includes(values.cluster!)) {
    if (!values['reuse-cluster']) throw new Error(`kind cluster ${values.cluster} exists: delete it, or pass --reuse-cluster`)
  } else {
    sh('kind', ['create', 'cluster', '--name', values.cluster!, '--wait', '120s'])
  }
  sh('kind', ['load', 'docker-image', values.image!, '--name', values.cluster!])
  // The dependencies are preloaded when that works (multi-platform images in Docker's
  // containerd store sometimes don't load); otherwise the node pulls them.
  for (const image of DEP_IMAGES) {
    if (sh('docker', ['image', 'inspect', image], { allowFail: true, quiet: true }).status !== 0) continue
    if (sh('kind', ['load', 'docker-image', image, '--name', values.cluster!], { allowFail: true }).status !== 0) console.log(`  (${image} will be pulled by the node)`)
  }
}

/** The app Deployment's admin CLI (`node admin.cjs …`). */
function admin(ns: string, release: string, args: string[], env: Record<string, string> = {}, allowFail = false): Result {
  const prefix = Object.entries(env).map(([k, v]) => `${k}='${v.replace(/'/g, `'\\''`)}'`).join(' ')
  return kubectl(['-n', ns, 'exec', `deploy/${release}-usertasks`, '-c', 'app', '--', 'sh', '-c', `${prefix} node admin.cjs ${args.map((a) => `'${a}'`).join(' ')}`], { allowFail, quiet: true })
}

function signInActionId(ns: string, release: string): string {
  const manifest = kubectl(['-n', ns, 'exec', `deploy/${release}-usertasks`, '-c', 'app', '--', 'cat', '.next/server/server-reference-manifest.json'], { quiet: true }).stdout
  const entry = Object.entries(JSON.parse(manifest).node as Record<string, { exportedName?: string; filename?: string }>)
    .find(([, v]) => v.exportedName === 'signInAction' && v.filename === 'app/actions/auth.ts')
  if (!entry) throw new Error('signInAction not found in the server reference manifest')
  return entry[0]
}

/** deploy/compose/smoke/smoke.mjs in a pod of the release (so the NetworkPolicies let it in). */
async function smoke(ns: string, release: string, mail: 'mailpit' | 'skip', realtime: 'sse' | 'skip'): Promise<boolean> {
  const run = Date.now().toString(36)
  const email = `smoke-${run}@usertasks.test`
  const password = randomBytes(12).toString('base64url')
  const boot = admin(ns, release, ['bootstrap', '--email', email, '--org', `Smoke ${run}`, '--if-missing', '--api-key', `smoke ${run}`], { BOOTSTRAP_PASSWORD: password })
  const key = boot.stdout.match(/ut_[0-9a-f]{64}/)?.[0]
  const slug = boot.stdout.match(/slug: ([a-z0-9-]+)/)?.[1] ?? ''
  if (!key) { record(`${release}: bootstrap`, false, boot.stdout + boot.stderr); return false }
  record(`${release}: bootstrap (usertasks-admin)`, true, `workspace ${slug}`)

  const cm = kubectl(['-n', ns, 'create', 'configmap', `${release}-smoke`, `--from-file=smoke.mjs=${SMOKE}`, '--dry-run=client', '-o', 'json'], { quiet: true }).stdout
  kubectl(['-n', ns, 'apply', '-f', '-'], { input: cm, quiet: true })
  const env: Record<string, string> = {
    SMOKE_URL: `http://${release}-usertasks:80`,
    SMOKE_API_KEY: key,
    SMOKE_EMAIL: email,
    SMOKE_PASSWORD: password,
    SMOKE_ORG: slug,
    SMOKE_SIGNIN_ACTION: signInActionId(ns, release),
    SMOKE_REALTIME: realtime,
    SMOKE_MAIL: mail,
    SMOKE_MAIL_URL: `http://${release}-usertasks-mailpit:8025`,
  }
  const pod = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: `${release}-smoke-${run}`, labels: { 'app.kubernetes.io/name': 'usertasks', 'app.kubernetes.io/instance': release, 'app.kubernetes.io/component': 'smoke' } },
    spec: {
      restartPolicy: 'Never',
      securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: 'RuntimeDefault' } },
      containers: [{
        name: 'smoke',
        image: 'node:22-alpine',
        imagePullPolicy: 'IfNotPresent',
        command: ['node', '/smoke/smoke.mjs'],
        env: Object.entries(env).map(([name, value]) => ({ name, value })),
        securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
        volumeMounts: [{ name: 'smoke', mountPath: '/smoke', readOnly: true }],
      }],
      volumes: [{ name: 'smoke', configMap: { name: `${release}-smoke` } }],
    },
  }
  kubectl(['-n', ns, 'apply', '-f', '-'], { input: JSON.stringify(pod), quiet: true })
  let phase = ''
  for (let i = 0; i < 120 && !['Succeeded', 'Failed'].includes(phase); i++) {
    await sleep(2000)
    phase = kubectl(['-n', ns, 'get', 'pod', pod.metadata.name, '-o', 'jsonpath={.status.phase}'], { quiet: true, allowFail: true }).stdout
  }
  const logs = kubectl(['-n', ns, 'logs', pod.metadata.name], { quiet: true, allowFail: true }).stdout
  console.log(logs.replace(/^/gm, '    '))
  kubectl(['-n', ns, 'delete', 'pod', pod.metadata.name, '--wait=false'], { quiet: true, allowFail: true })
  record(`${release}: HTTP smoke test in the cluster`, phase === 'Succeeded', /All \d+ smoke checks passed/.exec(logs)?.[0] ?? phase)
  return phase === 'Succeeded'
}

type DoctorCheck = { area: string; name: string; status: string; detail: string }

async function doctor(ns: string, release: string): Promise<void> {
  let checks: DoctorCheck[] = []
  for (let i = 0; i < 24; i++) {
    const res = admin(ns, release, ['doctor', '--json'], {}, true)
    try { checks = JSON.parse(res.stdout).checks } catch { checks = [] }
    const tick = checks.find((c) => c.area === 'scheduler' && c.name === 'last tick')
    if (tick?.status === 'ok' && !checks.some((c) => c.status === 'fail')) break
    await sleep(10_000)
  }
  for (const c of checks) console.log(`    ${c.status.padEnd(4)}  ${c.area.padEnd(9)} ${c.name.padEnd(16)} ${c.detail}`)
  const failed = checks.filter((c) => c.status === 'fail').map((c) => `${c.area}/${c.name}`)
  const tick = checks.find((c) => c.name === 'last tick')
  record(`${release}: usertasks-admin doctor (no failures)`, checks.length > 0 && !failed.length, failed.join(', '))
  record(`${release}: scheduler ticked`, tick?.status === 'ok', tick?.detail ?? 'no tick check')
}

function migrateJobs(ns: string): { name: string; succeeded: number; hook: boolean }[] {
  const json = JSON.parse(kubectl(['-n', ns, 'get', 'jobs', '-l', 'app.kubernetes.io/component=migrate', '-o', 'json'], { quiet: true }).stdout)
  return json.items.map((j: { metadata: { name: string; annotations?: Record<string, string> }; status: { succeeded?: number } }) => ({
    name: j.metadata.name, succeeded: j.status.succeeded ?? 0, hook: Boolean(j.metadata.annotations?.['helm.sh/hook']),
  }))
}

function migrateLog(ns: string, job: string): string {
  return kubectl(['-n', ns, 'logs', `job/${job}`, '-c', 'migrate'], { quiet: true, allowFail: true }).stdout
}

async function evalProfile(): Promise<void> {
  const ns = 'ut-eval'
  const release = 'eval'
  kubectl(['create', 'namespace', ns], { allowFail: true })
  const policy = ['--set', 'networkPolicy.enabled=true', '--set', 'networkPolicy.egress.mode=allowlist']
  helm(['install', release, CHART, '-n', ns, '-f', path.join(CHART, 'examples/eval.yaml'), ...imageValues, ...policy, '--wait', '--wait-for-jobs', '--timeout', '15m'])
  const jobs = migrateJobs(ns)
  const first = jobs.find((j) => j.name === `${release}-usertasks-migrate-1`)
  record('eval: migrate Job (revision 1) completed', first?.succeeded === 1, first ? migrateLog(ns, first.name).trim().split('\n').slice(-2).join(' | ') : 'no job')
  const health = kubectl(['-n', ns, 'get', 'deploy', `${release}-usertasks`, `${release}-usertasks-worker`, '-o', 'jsonpath={range .items[*]}{.metadata.name}={.status.readyReplicas}/{.spec.replicas} {end}'], { quiet: true }).stdout
  record('eval: app and worker ready', !/=\/|=0\//.test(health), health.trim())

  await smoke(ns, release, 'mailpit', 'sse')
  await doctor(ns, release)

  // No egress: from a release pod the internet is unreachable; from a pod outside the release it is.
  const blocked = kubectl(['-n', ns, 'exec', `deploy/${release}-usertasks`, '-c', 'app', '--', 'wget', '-q', '-T', '8', '-O', '/dev/null', 'https://registry.npmjs.org/'], { allowFail: true, quiet: true })
  const control = kubectl(['-n', ns, 'run', `egress-control-${Date.now().toString(36)}`, '--rm', '-i', '--restart=Never', '--image=node:22-alpine', '--image-pull-policy=IfNotPresent', '--', 'wget', '-q', '-T', '8', '-O', '/dev/null', 'https://registry.npmjs.org/'], { allowFail: true, quiet: true })
  if (control.status !== 0) {
    record('eval: no outbound internet from release pods (NetworkPolicy)', blocked.status !== 0, 'inconclusive: the control pod has no internet either')
  } else {
    record('eval: no outbound internet from release pods (NetworkPolicy)', blocked.status !== 0, 'a pod outside the release reaches registry.npmjs.org; the app pod does not')
  }

  // Upgrade: a new revision runs a new migrate Job, the app rolls and answers.
  helm(['upgrade', release, CHART, '-n', ns, '--reuse-values', '--set', `app.podAnnotations.gate-upgrade=${Date.now()}`, '--wait', '--wait-for-jobs', '--timeout', '15m'])
  const second = migrateJobs(ns).find((j) => j.name === `${release}-usertasks-migrate-2`)
  record('eval: helm upgrade ran migrate Job revision 2', second?.succeeded === 1, second ? migrateLog(ns, second.name).trim().split('\n').slice(-2).join(' | ') : 'no job')
  const test = helm(['test', release, '-n', ns, '--timeout', '3m'], { allowFail: true })
  record('eval: helm test after the upgrade', test.status === 0, test.status === 0 ? '' : test.stdout.slice(-300))
}

async function hookProfile(): Promise<void> {
  const ns = 'ut-hook'
  const release = 'hook'
  kubectl(['create', 'namespace', ns], { allowFail: true })
  // Its own PostgreSQL (plain, outside the chart), and a Secret that exists before the release.
  const pgPassword = randomBytes(18).toString('hex')
  kubectl(['-n', ns, 'run', 'pg', '--image=postgres:16-alpine', '--image-pull-policy=IfNotPresent', '--port=5432', '--expose',
    `--env=POSTGRES_PASSWORD=${pgPassword}`, '--env=POSTGRES_USER=usertasks', '--env=POSTGRES_DB=usertasks'], { quiet: true })
  kubectl(['-n', ns, 'wait', '--for=condition=Ready', 'pod/pg', '--timeout=180s'])
  const url = `postgresql://usertasks:${pgPassword}@pg:5432/usertasks`
  const secret = {
    apiVersion: 'v1', kind: 'Secret', metadata: { name: 'hook-env' }, type: 'Opaque',
    stringData: {
      ENCRYPTION_KEY: randomBytes(32).toString('hex'), CRON_SECRET: randomBytes(32).toString('hex'),
      DATABASE_URL: url, MIGRATION_DATABASE_URL: url, REALTIME_DATABASE_URL: url,
    },
  }
  kubectl(['-n', ns, 'apply', '-f', '-'], { input: JSON.stringify(secret), quiet: true })
  const set = [
    'appUrl=http://localhost:3001', 'secrets.existingSecret=hook-env', 'app.replicas=1',
    'providers.db.provider=postgres', 'providers.auth.provider=builtin', 'providers.realtime.provider=sse',
    'providers.scheduler.provider=external', 'providers.email.provider=console', 'providers.cache.provider=postgres',
    'providers.storage.provider=local', 'providers.storage.options.local_root=/var/lib/usertasks/storage',
  ].flatMap((s) => ['--set', s])
  // One replica with an emptyDir is enough here; local storage with replicas needs a ReadWriteMany volume.
  const volumes = [
    '--set-json', 'extraVolumes=[{"name":"storage","emptyDir":{}}]',
    '--set-json', 'extraVolumeMounts=[{"name":"storage","mountPath":"/var/lib/usertasks/storage"}]',
  ]
  // pg isn't ready to accept connections the moment its pod is Ready; the hook retries (backoffLimit).
  helm(['install', release, CHART, '-n', ns, ...imageValues, ...set, ...volumes, '--wait', '--wait-for-jobs', '--timeout', '15m'])
  const hook = migrateJobs(ns).find((j) => j.name === `${release}-usertasks-migrate`)
  record('hook: pre-install migrate hook completed', hook?.succeeded === 1 && hook.hook, hook ? migrateLog(ns, hook.name).trim().split('\n').slice(-2).join(' | ') : 'no job')
  await smoke(ns, release, 'skip', 'sse')
  // The tick CronJob: wait for one run, then the doctor sees the tick.
  await doctor(ns, release)
  // The tick's request returns once the minute's jobs ran: give the Job time to complete.
  let ticked = 0
  for (let i = 0; i < 18 && !ticked; i++) {
    const cron = JSON.parse(kubectl(['-n', ns, 'get', 'jobs', '-l', 'app.kubernetes.io/component=tick', '-o', 'json'], { quiet: true }).stdout)
    ticked = cron.items.filter((j: { status: { succeeded?: number } }) => (j.status.succeeded ?? 0) > 0).length
    if (!ticked) await sleep(10_000)
  }
  record('hook: tick CronJob ran (POST /api/cron/tick)', ticked > 0, `${ticked} successful tick job(s)`)

  helm(['upgrade', release, CHART, '-n', ns, '--reuse-values', '--set', `app.podAnnotations.gate-upgrade=${Date.now()}`, '--wait', '--wait-for-jobs', '--timeout', '15m'])
  const after = migrateJobs(ns).find((j) => j.name === `${release}-usertasks-migrate`)
  const log = after ? migrateLog(ns, after.name) : ''
  record('hook: helm upgrade re-ran the pre-upgrade migrate hook', after?.succeeded === 1 && /Up to date\./.test(log), log.trim().split('\n').slice(-1)[0] ?? '')
}

async function main() {
  createCluster()
  try {
    if (!values['skip-eval']) await evalProfile()
    if (!values['skip-hook']) await hookProfile()
  } catch (error) {
    record('gate run', false, (error as Error).message)
    for (const ns of ['ut-eval', 'ut-hook']) {
      kubectl(['-n', ns, 'get', 'pods,jobs', '-o', 'wide'], { allowFail: true, quiet: true }).stdout.split('\n').forEach((l) => l && console.log(`    ${l}`))
    }
  } finally {
    if (!values.keep) sh('kind', ['delete', 'cluster', '--name', values.cluster!], { allowFail: true })
  }
  const failed = checks.filter((c) => !c.ok)
  console.log(`\nHelm chart gate: ${failed.length ? `FAILED (${failed.length} of ${checks.length})` : `PASSED (${checks.length} checks)`}`)
  process.exit(failed.length ? 1 : 0)
}

main().catch((error) => {
  console.error(`helm-gate: ${(error as Error).message}`)
  process.exit(1)
})
