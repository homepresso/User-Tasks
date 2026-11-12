import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILD_MEMORY_GB, firstLoginText, loginHint, memoryCheckMessage, setupHint } from '@/scripts/stack-helpers'

const ROOT = path.resolve(__dirname, '..')
const GB = 1024 ** 3

describe('npm run stack: memory check before the image build', () => {
  it('passes with enough memory (Docker Desktop reports a little under the setting)', () => {
    expect(memoryCheckMessage(BUILD_MEMORY_GB * GB)).toBeNull()
    expect(memoryCheckMessage((BUILD_MEMORY_GB - 0.3) * GB)).toBeNull()
    expect(memoryCheckMessage(32 * GB)).toBeNull()
  })

  it('stops with the Docker Desktop steps and the way out below it', () => {
    const message = memoryCheckMessage(4 * GB) ?? ''
    expect(message).toContain(`Docker has 4.0 GB of memory; building UserTasks needs about ${BUILD_MEMORY_GB} GB.`)
    expect(message).toContain('Settings → Resources → Memory')
    expect(message).toContain('Apply & restart')
    expect(message).toContain('npm run setup:local')
    expect(message).toContain('--skip-memory-check')
  })

  it('says nothing when docker info has no answer', () => {
    expect(memoryCheckMessage(Number(''))).toBeNull()
    expect(memoryCheckMessage(Number.NaN)).toBeNull()
  })
})

describe('npm run stack: first sign-in', () => {
  it('the login hint names the file, never the password', () => {
    const hint = loginHint('http://localhost:3000', 'you@example.com', '.usertasks-first-login')
    expect(hint).toContain('http://localhost:3000/login')
    expect(hint).toContain('you@example.com')
    expect(hint).toContain('.usertasks-first-login')
    expect(loginHint('http://localhost:3000', 'you@example.com', 'chosen')).toContain('the password you chose')
    expect(loginHint('http://localhost:3000', 'you@example.com', 'existing')).toContain('already existed')
    for (const mode of ['chosen', 'existing', '.usertasks-first-login']) expect(loginHint('http://localhost:3000', 'you@example.com', mode)).not.toMatch(/PASSWORD=|s3cret/)
  })

  it('the first-login file holds where to sign in and the password', () => {
    const text = firstLoginText('http://localhost:3000', 'you@example.com', 'Acme Inc', 's3cret-Pa55')
    expect(text).toContain('URL=http://localhost:3000/login')
    expect(text).toContain('EMAIL=you@example.com')
    expect(text).toContain('PASSWORD=s3cret-Pa55')
    expect(text).toMatch(/Delete this file/)
  })

  it('the setup hint prints the setup code from the env file, or says where to find one', () => {
    expect(setupHint('http://localhost:3000', 'ABCD-EFGH-JKLM')).toContain('open http://localhost:3000/setup and enter the setup code ABCD-EFGH-JKLM')
    expect(setupHint('http://localhost:3000', undefined)).toContain('docker compose logs app')
    expect(setupHint('http://localhost:3000', 'short')).toContain('docker compose logs app')
  })

  it('the password file is never committed or sent to the Docker build', () => {
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toMatch(/^\.usertasks-first-login$/m)
    expect(readFileSync(path.join(ROOT, '.dockerignore'), 'utf8')).toMatch(/^\.usertasks-first-login$/m)
  })

  it('the standalone template leaves the setup code commented out (init fills it in)', () => {
    const template = readFileSync(path.join(ROOT, 'deploy/compose/standalone.env.example'), 'utf8')
    expect(template).toMatch(/^# USERTASKS_SETUP_CODE=$/m)
    expect(template).not.toMatch(/^USERTASKS_SETUP_CODE=/m)
  })
})

describe('the image is built once, without tsc unless asked', () => {
  const compose = readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8')
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')

  it('only the app service builds; migrate and worker reuse its image', () => {
    const service = (name: string) => compose.split(/\n  (?=[a-z]+:\n)/).find((block) => block.startsWith(`${name}:\n`)) ?? ''
    expect(service('app')).toContain('*app-build')
    expect(service('migrate')).toContain('<<: *app-image')
    expect(service('migrate')).not.toContain('app-build')
    expect(service('worker')).not.toContain('app-build')
    expect(compose).toContain('TYPECHECK: ${TYPECHECK:-false}')
  })

  it('the Dockerfile type-checks only with TYPECHECK=true; release builds pass it', () => {
    expect(dockerfile).toContain('ARG TYPECHECK=false')
    expect(dockerfile).toMatch(/if \[ "\$TYPECHECK" = "true" \]; then[\s\S]*tsc --noEmit/)
    const gates = readFileSync(path.join(ROOT, '.github/workflows/release-gates.yml'), 'utf8')
    expect(gates.match(/docker build /g)?.length).toBe(gates.match(/docker build --build-arg TYPECHECK=true /g)?.length)
    expect(readFileSync(path.join(ROOT, 'scripts/bundle.ts'), 'utf8')).toContain("'--build-arg', 'TYPECHECK=true'")
  })
})
