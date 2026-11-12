import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import sitemap from '@/app/sitemap'
import { ALL_DOC_PAGES, DOC_SECTIONS, getDocPage, sectionOf } from '@/lib/docs/registry'
import { pageBlocks } from '@/lib/docs/render'
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/seo/llms'
import { GUIDES } from '@/lib/marketing-nav'
import { getSeoPage } from '@/lib/seo-pages'
import { DOCS_UPDATED } from '@/lib/seo/site'
import { parseMarkdown } from '@/lib/docs/markdown'
import { resolveBaseDomain, classifyHost, canShareCookies } from '@/lib/workspace-address'
import { STORAGE_URL_COLUMNS } from '@/lib/storage/migrate'

/** The step-by-step self-hosting guide (lib/docs/content/self-hosting-guide.ts). */
const GUIDE = [
  ['self-hosting/quick-start', 'Quick start on your computer (beginner)'],
  ['self-hosting/choose', 'Choose how to run it'],
  ['self-hosting/requirements', 'Requirements'],
  ['self-hosting/install', 'Install step by step'],
  ['self-hosting/admin-account', 'Create your admin account'],
  ['self-hosting/invite-people', 'Sign in and invite people'],
  ['self-hosting/cli', 'Use the CLI with your server'],
  ['self-hosting/local-to-supabase-cloud', 'Move from your local Supabase to Supabase Cloud'],
  ['self-hosting/friendly-address', 'Give your install a friendly address'],
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

  it('has a friendly-address page that matches the code', () => {
    const page = getDocPage('self-hosting/friendly-address')!
    const body = text('self-hosting/friendly-address')
    for (const needle of [
      'APP_URL', 'NEXT_PUBLIC_APP_URL', 'APP_BASE_DOMAIN', 'APP_BASE_DOMAIN=off', 'INSTANCE_ADMIN_EMAILS', 'usertasks-admin instance-admins add',
      'Settings → Workspace DNS', 'Check again', 'Settings → General → Workspace address', 'Workspace addresses are off on this instance',
      'No workspace at this address', '*.tasks.yourcompany.com', 'nslookup tasks.yourcompany.com', 'dig +short tasks.yourcompany.com',
      'reverse_proxy 127.0.0.1:3000', 'dns cloudflare {env.CF_API_TOKEN}', 'proxy_set_header Host $host', 'X-Forwarded-Proto', 'X-Forwarded-For',
      'proxy_buffering off', 'proxy_read_timeout', 'client_max_body_size 64m', 'sudo certbot --nginx -d tasks.yourcompany.com',
      'certManager', 'clusterIssuer', 'APP_PORT=127.0.0.1:3000', 'docker compose up -d --build', 'npm run build',
      'usertasks login --url https://tasks.yourcompany.com', '/auth/sso/<id>/callback', '/auth/saml/<id>/acs', 'spEntityId',
      '/auth/callback', '/api/connectors/oauth/callback', 'install-pg-cron --base-url', 'Full (strict)', 'DNS only',
    ]) expect(body, needle).toContain(needle)
    expect(body).not.toMatch(/example\.org|yourdomain/)

    // Every shell block pastes into zsh: no # comments (the shell-snippets guard checks every docs page too).
    const blocks = parseMarkdown(page.body).filter((b) => b.kind === 'code')
    const shell = blocks.filter((b) => b.kind === 'code' && ['bash', 'sh', 'shell', 'zsh', 'console'].includes(b.lang))
    expect(shell.length).toBeGreaterThan(5)
    for (const b of shell) if (b.kind === 'code') expect(b.code, b.code).not.toMatch(/(^|\s)#/m)
    expect(blocks.map((b) => (b.kind === 'code' ? b.lang : ''))).toEqual(expect.arrayContaining(['caddyfile', 'nginx', 'yaml', 'ini']))

    // The behaviour it describes.
    expect(resolveBaseDomain({ appUrl: 'https://tasks.yourcompany.com', cloud: false })).toBeNull()
    expect(resolveBaseDomain({ baseDomain: 'tasks.yourcompany.com', appUrl: 'https://tasks.yourcompany.com' })).toBe('tasks.yourcompany.com')
    expect(resolveBaseDomain({ baseDomain: 'off', appUrl: 'https://tasks.yourcompany.com', cloud: true })).toBeNull()
    expect(classifyHost('tasks.yourcompany.com', 'yourcompany.com')).toEqual({ kind: 'workspace', label: 'tasks' })
    expect(classifyHost('acme.tasks.yourcompany.com', 'tasks.yourcompany.com')).toEqual({ kind: 'workspace', label: 'acme' })
    expect(canShareCookies('tasks.yourcompany.com', true)).toBe(true)
    expect(canShareCookies('tasks.yourcompany.com', false)).toBe(false)
    const next = readFileSync('next.config.ts', 'utf8')
    expect(next).toContain('Number(process.env.FORM_UPLOAD_MAX_BODY_MB) || 50')
    expect(readFileSync('docker-compose.yml', 'utf8')).toContain('"${APP_PORT:-3000}:3000"')
    expect(readFileSync('lib/log-export/sse.ts', 'utf8')).toContain("'X-Accel-Buffering': 'no'")

    // Linked from the install, requirements, CLI and troubleshooting pages, the Markdown guide, the README and /open-source.
    for (const slug of ['self-hosting/install', 'self-hosting/requirements', 'self-hosting/cli', 'self-hosting/troubleshooting']) {
      expect(text(slug), slug).toContain('/docs/self-hosting/friendly-address')
    }
    for (const file of ['docs/self-hosting.md', 'README.md', 'components/marketing/open-source-page.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toContain('/docs/self-hosting/friendly-address')
    }
  })

  it('has a local-to-Supabase-Cloud page that matches the repo', () => {
    const page = getDocPage('self-hosting/local-to-supabase-cloud')!
    const body = text('self-hosting/local-to-supabase-cloud')
    for (const needle of [
      'npx supabase login', 'npx supabase link --project-ref your-project-ref', 'npx supabase db push --linked --dry-run', 'npx supabase db push --linked',
      'npx supabase db dump --local --data-only --use-copy -s auth,public,', '--single-transaction', 'ON_ERROR_STOP=1', 'session_replication_role = replica',
      'delete from public.oauth_clients; delete from app_realtime.listener_state; delete from app_cron.housekeeping_runs;',
      'npx supabase storage cp --experimental --local -r ss:///logos storage-backup/logos', 'npx supabase storage cp --experimental --linked -r storage-backup/logos ss:///logos',
      'fix-storage-urls.sql', 'ENCRYPTION_KEY', 'CRON_SECRET', 'npm run scheduler -- install-pg-cron --base-url https://tasks.yourcompany.com',
      'host.docker.internal', 'APP_URL', 'NEXT_PUBLIC_APP_URL', '/auth/callback', 'Site URL', 'Redirect URLs', 'NEXT_PUBLIC_SSO_MICROSOFT=1',
      'Platform self-test', 'npm run admin -- doctor', 'usertasks-admin switch database', '/docs/self-hosting/friendly-address', '/docs/self-hosting/install#docker-compose',
    ]) expect(body, needle).toContain(needle)

    // zsh-safe shell blocks: no comments, no unquoted <placeholders> (zsh reads `<x>` as a redirection).
    const blocks = parseMarkdown(page.body).filter((b) => b.kind === 'code')
    const shell = blocks.filter((b) => b.kind === 'code' && ['bash', 'sh', 'shell', 'zsh', 'console'].includes(b.lang))
    expect(shell.length).toBeGreaterThan(5)
    for (const b of shell) if (b.kind === 'code') {
      expect(b.code, b.code).not.toMatch(/(^|\s)#/m)
      expect(b.code.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""'), b.code).not.toMatch(/<[a-z]/i)
    }

    // What the commands rely on.
    const migrations = readFileSync('scripts/scheduler.ts', 'utf8')
    expect(migrations).toContain("install-pg-cron [--base-url URL]")
    expect(readFileSync('scripts/setup-local.ts', 'utf8')).toContain("const CRON_BASE_URL = 'http://host.docker.internal:3000'")
    expect(readFileSync('lib/admin/switch/database.ts', 'utf8')).toContain('Moving to another Supabase project is a Supabase dump / restore.')
    expect(readFileSync('supabase/migrations/20261023000000_oauth_first_party_cli.sql', 'utf8')).toMatch(/INSERT INTO public\.oauth_clients/)
    expect(readFileSync('supabase/migrations/20261105000000_realtime_notify.sql', 'utf8')).toContain('INSERT INTO app_realtime.listener_state')
    expect(readFileSync('supabase/migrations/20261109500000_instance_housekeeping.sql', 'utf8')).toContain('INSERT INTO app_cron.housekeeping_runs')
    const sql = blocks.find((b) => b.kind === 'code' && b.lang === 'sql')
    for (const col of STORAGE_URL_COLUMNS) expect(sql && sql.kind === 'code' ? sql.code : '', `${col.table}.${col.column}`).toContain(`('${col.table}', '${col.column}')`)
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts.admin).toBe('tsx packages/admin/src/bin.ts')

    for (const slug of ['self-hosting/quick-start', 'self-hosting/install', 'self-hosting/cli']) expect(text(slug), slug).toContain('/docs/self-hosting/local-to-supabase-cloud')
    for (const file of ['docs/self-hosting.md', 'README.md', 'components/marketing/open-source-page.tsx']) {
      expect(readFileSync(file, 'utf8'), file).toContain('/docs/self-hosting/local-to-supabase-cloud')
    }
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
