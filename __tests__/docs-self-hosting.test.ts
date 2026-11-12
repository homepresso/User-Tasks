import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import sitemap from '@/app/sitemap'
import { ALL_DOC_PAGES, DOC_SECTIONS, getDocPage, sectionOf } from '@/lib/docs/registry'
import { pageBlocks } from '@/lib/docs/render'
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/seo/llms'
import { GUIDES } from '@/lib/marketing-nav'
import { getSeoPage } from '@/lib/seo-pages'
import { DOCS_UPDATED } from '@/lib/seo/site'

/** The step-by-step self-hosting guide (lib/docs/content/self-hosting-guide.ts). */
const GUIDE = [
  ['self-hosting/quick-start', 'Quick start on your computer (beginner)'],
  ['self-hosting/choose', 'Choose how to run it'],
  ['self-hosting/requirements', 'Requirements'],
  ['self-hosting/install', 'Install step by step'],
  ['self-hosting/admin-account', 'Create your admin account'],
  ['self-hosting/invite-people', 'Sign in and invite people'],
  ['self-hosting/cli', 'Use the CLI with your server'],
  ['self-hosting/updates-and-backups', 'Updates and backups'],
  ['self-hosting/troubleshooting', 'Troubleshooting'],
] as const

const text = (slug: string) => JSON.stringify(pageBlocks(getDocPage(slug)!))

describe('self-hosting guide', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is in the docs registry, in order, right after the Self-hosting overview', () => {
    const section = DOC_SECTIONS.find((s) => s.title === 'Self-hosting')!
    const slugs = section.pages.map((page) => page.slug)
    expect(slugs.slice(0, GUIDE.length + 1)).toEqual(['self-hosting', ...GUIDE.map(([slug]) => slug)])
    for (const [slug, title] of GUIDE) {
      expect(getDocPage(slug)?.title).toBe(title)
      expect(sectionOf(slug)?.title).toBe('Self-hosting')
    }
    // The reference pages keep their place after the guide.
    expect(slugs).toContain('self-hosting/environment')
    expect(ALL_DOC_PAGES.filter((page) => page.slug.startsWith('self-hosting/')).length).toBeGreaterThan(GUIDE.length)
  })

  it('covers every way to run it, the /setup screen and the setup code', () => {
    const install = text('self-hosting/install')
    for (const id of ['laptop-trial', 'docker-compose', 'kubernetes-helm', 'air-gapped-bundle', 'your-own-postgresql-without-supabase', 'from-source-with-supabase']) {
      expect(install).toContain(`"id":"${id}"`)
    }
    expect(install).toContain('npm run stack -- up')
    expect(install).toContain('helm install usertasks deploy/helm/usertasks')
    expect(install).toContain('./bundle.sh verify')

    const setup = text('self-hosting/admin-account')
    for (const needle of ['/setup', 'Create your admin account', 'UserTasks setup code: ABCD-EFGH-JKLM', 'usertasks-admin setup-code', 'setup-code status', 'npm run admin -- setup-code', 'docker compose exec app node admin.cjs setup-code', 'USERTASKS_SETUP_CODE', 'npm run bootstrap -- --email']) {
      expect(setup, needle).toContain(needle)
    }

    const cli = text('self-hosting/cli')
    for (const needle of ['npm install -g @user-tasks/cli', 'user-tasks-cli-', 'usertasks login --url https://tasks.example.com', '--api-key']) expect(cli, needle).toContain(needle)

    const windows = text('self-hosting/admin-account')
    for (const needle of ['npm run setup-code', 'Test-Path package.json', 'dir package.json', 'single quotes', 'double quotes', 'npx tsx --env-file=.env.local scripts/bootstrap-tenant.ts', 'docker compose exec app node admin.cjs bootstrap']) {
      expect(windows, needle).toContain(needle)
    }
    expect(windows).not.toContain('set -a')
    expect(text('self-hosting/cli')).toContain('logs in to http://localhost:3000')

    const trouble = text('self-hosting/troubleshooting')
    for (const needle of ['ENOENT', 'Could not read package.json', 'Missing environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.', 'DB_PROVIDER=postgres', 'AUTH_PROVIDER=builtin', 'CLI 0.1.2']) {
      expect(trouble, needle).toContain(needle)
    }
    for (const needle of ['No server URL for profile', 'PORT=3001 npm run dev', 'APP_URL', 'AUTH_COOKIE_SECURE']) expect(trouble, needle).toContain(needle)
  })

  it('has a beginner quick start led by npm run setup:local, and install / quickstart lead with it too', () => {
    const quick = text('self-hosting/quick-start')
    for (const needle of ['git-scm.com', 'nodejs.org', 'docker-desktop', 'WSL 2', 'PowerShell', 'git clone <repository-url> usertasks', 'cd usertasks', 'npm run setup:local', 'npm run dev', 'UserTasks setup code: ABCD-EFGH-JKLM', 'http://localhost:3000', 'Create your admin account', 'npx supabase stop', 'npx supabase start', 'npm run setup-code', 'Could not read package.json', '/docs/self-hosting/troubleshooting', '--reset', 'What you\'ll see']) {
      expect(quick, needle).toContain(needle)
    }
    expect(quick).toContain("doesn't install anything")
    const install = text('self-hosting/install')
    expect(install).toContain('npm run setup:local')
    expect(install).toContain('/docs/self-hosting/quick-start')
    expect(install).toContain('npx supabase status -o env')
    expect(text('quickstart/self-host')).toContain('npm run setup:local')
    expect(text('self-hosting/cli')).toContain("The CLI doesn't install UserTasks")
    const trouble = text('self-hosting/troubleshooting')
    for (const needle of ["Docker isn't running", "The local Supabase won't start", 'npm run dev -- -p 3001', 'wsl --install']) expect(trouble, needle).toContain(needle)
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['setup:local']).toBe('tsx scripts/setup-local.ts')
  })

  it('quotes the errors the troubleshooting page explains', async () => {
    const { readFileSync } = await import('fs')
    const { missingEnvMessage } = await import('@/packages/admin/src/local-env')
    const message = missingEnvMessage(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], '/nowhere', [])
    expect(message).toContain('Missing environment variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.')
    expect(message).toContain('Run this from the UserTasks folder (the one with package.json)')
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['setup-code']).toContain('setup-code')
    // CLI 0.1.3+: an unreachable server is named, with a start / --url hint (main.ts reportError).
    const main = readFileSync('packages/cli/src/main.ts', 'utf8')
    expect(main).toContain("can't reach UserTasks at ${origin}. Is it running?")
    const guide = readFileSync('lib/docs/content/self-hosting-guide.ts', 'utf8')
    expect(guide).toContain("can't reach UserTasks at http://localhost:3000. Is it running?")
  })

  it('is in the sitemap with the docs date (cloud edition)', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('APP_URL', '')
    const entries = sitemap()
    for (const [slug] of GUIDE) {
      const entry = entries.find((e) => e.url === `https://usertasks.com/docs/${slug}`)
      expect(entry, slug).toBeDefined()
      expect((entry!.lastModified as Date).toISOString().slice(0, 10)).toBe(DOCS_UPDATED)
    }
  })

  it('is listed in llms.txt and llms-full.txt', () => {
    const index = buildLlmsTxt('https://usertasks.com')
    const full = buildLlmsFullTxt('https://usertasks.com')
    for (const [slug, title] of GUIDE) {
      expect(index).toContain(`- [${title}](https://usertasks.com/docs/${slug}):`)
      expect(full).toContain(`https://usertasks.com/docs/${slug}`)
    }
  })

  it('is linked from the marketing site', () => {
    expect(GUIDES.some((link) => link.href.startsWith('/docs/self-hosting'))).toBe(true)
    for (const slug of ['on-premises-workflow-automation', 'open-source-workflow-engine']) {
      expect(getSeoPage(slug)!.links.some((link) => link.href.startsWith('/docs/self-hosting/')), slug).toBe(true)
    }
  })
})
