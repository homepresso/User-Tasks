/**
 * The app image `npm run stack -- up` runs (scripts/stack-helpers.ts), the
 * Compose default it shares, and the workflow that publishes the image
 * (.github/workflows/image.yml).
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { LOCAL_IMAGE, PUBLISHED_IMAGE_REPO, planAppImage, publishedImage, resolveAppImage } from '@/scripts/stack-helpers'

const ROOT = path.resolve(__dirname, '..')
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string
const PUBLISHED = `ghcr.io/homepresso/usertasks:${VERSION}`

/* eslint-disable @typescript-eslint/no-explicit-any -- parsed YAML */

describe('npm run stack -- up: which app image', () => {
  it('defaults to the published image for this version, pulled when it is not present', () => {
    const plan = planAppImage({ version: VERSION })
    expect(plan).toEqual({ kind: 'published-or-build', image: PUBLISHED, fallback: LOCAL_IMAGE })
    const asked: string[] = []
    expect(resolveAppImage(plan, (image) => { asked.push(image); return true })).toEqual({
      image: PUBLISHED, build: false, note: expect.stringContaining('published image'),
    })
    expect(asked).toEqual([PUBLISHED])
    expect(publishedImage(VERSION)).toBe(PUBLISHED)
    expect(PUBLISHED_IMAGE_REPO).toBe('ghcr.io/homepresso/usertasks')
  })

  it('falls back to a local build (usertasks:local, never the published name) when the pull fails', () => {
    const chosen = resolveAppImage(planAppImage({ version: VERSION }), () => false)
    expect(chosen).toEqual({ image: LOCAL_IMAGE, build: true, note: expect.stringContaining('building usertasks:local locally') })
    expect(LOCAL_IMAGE).toBe('usertasks:local')
  })

  it('--build always builds, without asking for the published image', () => {
    const never = () => { throw new Error('must not pull for --build') }
    expect(resolveAppImage(planAppImage({ build: true, version: VERSION }), never)).toEqual({ image: LOCAL_IMAGE, build: true })
    // …tagged with USERTASKS_IMAGE when that is set.
    expect(resolveAppImage(planAppImage({ build: true, image: 'registry.example/ut:dev', version: VERSION }), never)).toEqual({ image: 'registry.example/ut:dev', build: true })
  })

  it('USERTASKS_IMAGE runs that image and never builds; --no-build runs the earlier local build', () => {
    const never = () => { throw new Error('no availability check') }
    expect(resolveAppImage(planAppImage({ image: 'registry.example/ut:1.2.3', version: VERSION }), never)).toEqual({ image: 'registry.example/ut:1.2.3', build: false })
    expect(resolveAppImage(planAppImage({ image: 'usertasks:local', noBuild: true, version: VERSION }), never)).toEqual({ image: 'usertasks:local', build: false })
    expect(resolveAppImage(planAppImage({ noBuild: true, version: VERSION }), never)).toEqual({ image: LOCAL_IMAGE, build: false })
    // A blank value is unset.
    expect(planAppImage({ image: '  ', version: VERSION }).kind).toBe('published-or-build')
  })

  it('refuses --build with --no-build', () => {
    expect(() => planAppImage({ build: true, noBuild: true, version: VERSION })).toThrow(/contradict/)
  })
})

describe('docker-compose.yml: the app image', () => {
  const compose = parse(readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8'), { merge: true }) as any

  it('defaults to the published image tagged with package.json’s version (bump them together)', () => {
    expect(compose['x-app-image'].image).toBe(`\${USERTASKS_IMAGE:-${PUBLISHED}}`)
    for (const service of ['app', 'migrate', 'worker']) expect(compose.services[service].image, service).toBe(`\${USERTASKS_IMAGE:-${PUBLISHED}}`)
    // Only the app service builds (the fallback when the pull fails).
    expect(compose.services.app.build.context).toBe('.')
    expect(compose.services.migrate.build).toBeUndefined()
  })

  const hasCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0
  it.skipIf(!hasCompose)('docker compose config resolves it, and USERTASKS_IMAGE overrides it', () => {
    // An empty env file so a developer's .env can't change the answer.
    const envFile = path.join(mkdtempSync(path.join(tmpdir(), 'stack-image-')), 'empty.env')
    writeFileSync(envFile, '')
    const images = (extra: Record<string, string>) => {
      const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
      if (!extra.USERTASKS_IMAGE) delete env.USERTASKS_IMAGE
      const res = spawnSync('docker', ['compose', '-f', 'docker-compose.yml', '--project-directory', ROOT, '--env-file', envFile, '--profile', 'standalone', 'config', '--format', 'json'], { cwd: ROOT, env, encoding: 'utf8' })
      expect(res.status, res.stderr).toBe(0)
      const services = JSON.parse(res.stdout).services as Record<string, { image?: string }>
      return { app: services.app.image, migrate: services.migrate.image, worker: services.worker.image }
    }
    expect(images({})).toEqual({ app: PUBLISHED, migrate: PUBLISHED, worker: PUBLISHED })
    expect(images({ USERTASKS_IMAGE: 'usertasks:local' })).toEqual({ app: 'usertasks:local', migrate: 'usertasks:local', worker: 'usertasks:local' })
  })
})

describe('.github/workflows/image.yml', () => {
  const workflow = parse(readFileSync(path.join(ROOT, '.github/workflows/image.yml'), 'utf8')) as any
  const text = readFileSync(path.join(ROOT, '.github/workflows/image.yml'), 'utf8')

  it('runs on version tags and by hand (latest optional)', () => {
    expect(workflow.on.push.tags).toEqual(['v*'])
    expect(workflow.on.workflow_dispatch.inputs.latest).toMatchObject({ type: 'boolean', default: false })
  })

  it('builds amd64 and arm64 natively, type-checked, with cache, provenance and an SBOM', () => {
    const build = workflow.jobs.build
    expect(build.strategy.matrix.include).toEqual([
      { platform: 'linux/amd64', runner: 'ubuntu-24.04' },
      { platform: 'linux/arm64', runner: 'ubuntu-24.04-arm' },
    ])
    const step = build.steps.find((s: any) => String(s.uses).startsWith('docker/build-push-action@'))
    expect(step.with['build-args']).toContain('TYPECHECK=true')
    expect(step.with['build-args']).toContain('DEPLOYMENT_MODE=self_hosted')
    expect(step.with['cache-from']).toMatch(/^type=gha/)
    expect(step.with['cache-to']).toMatch(/^type=gha.*mode=max/)
    expect(step.with.provenance).toBe('mode=max')
    expect(step.with.sbom).toBe(true)
    expect(workflow.env.IMAGE).toBe('ghcr.io/homepresso/usertasks')
  })

  it('pushes to GHCR with GITHUB_TOKEN only (packages: write), with OCI source and licence labels', () => {
    for (const job of ['build', 'merge']) expect(workflow.jobs[job].permissions).toEqual({ contents: 'read', packages: 'write' })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect([...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).every((s) => s === 'GITHUB_TOKEN')).toBe(true)
    expect(text).toContain('org.opencontainers.image.licenses=Apache-2.0')
    expect(text).toContain('org.opencontainers.image.source=https://github.com/${{ github.repository }}')
  })

  it('tags the version the stack pulls (package.json) and latest only on tags or when asked', () => {
    const meta = workflow.jobs.merge.steps.find((s: any) => s.id === 'meta')
    expect(meta.with.tags).toContain("type=raw,value=${{ steps.version.outputs.version }},enable=${{ github.event_name == 'workflow_dispatch' }}")
    expect(meta.with.tags).toContain('type=semver,pattern={{version}}')
    expect(meta.with.tags).toContain("type=raw,value=latest,enable=${{ github.ref_type == 'tag' || inputs.latest == true }}")
  })
})

describe('workflows: pinned tools, no Node 20 actions', () => {
  const dir = path.join(ROOT, '.github/workflows')
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml'))

  it('every workflow parses', () => {
    for (const f of files) expect(() => parse(readFileSync(path.join(dir, f), 'utf8')), f).not.toThrow()
  })

  it('pins the Supabase CLI (a new major must not change CI under us)', () => {
    for (const f of files) {
      const steps = Object.values((parse(readFileSync(path.join(dir, f), 'utf8')) as any).jobs).flatMap((j: any) => j.steps ?? [])
      for (const s of steps.filter((s: any) => String(s.uses).startsWith('supabase/setup-cli@'))) {
        expect(s.with?.version, f).toMatch(/^\d+\.\d+\.\d+$/)
      }
    }
  })

  it('uses the Node 24 majors of the actions that warned', () => {
    const old = /(actions\/checkout|actions\/setup-node)@v4|supabase\/setup-cli@v1|actions\/upload-artifact@v[45]\b|azure\/setup-helm@v4/
    for (const f of files) expect(readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(old)
  })
})
