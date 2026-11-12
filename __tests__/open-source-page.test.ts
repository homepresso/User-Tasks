/**
 * /open-source: licence, repository, the beginner's step-by-step guide, the
 * two ways to run UserTasks locally and the optional CLI. The commands must
 * match README.md and package.json scripts.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { OpenSourcePage } from '@/components/marketing/open-source-page'

describe('/open-source', () => {
  vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', 'https://github.com/homepresso/User-Tasks')
  afterAll(() => { vi.unstubAllEnvs() })
  const html = renderToStaticMarkup(createElement(OpenSourcePage))
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
  const readme = readFileSync('README.md', 'utf8')

  it('shows the repository, the licence, both ways to run it and the optional CLI', () => {
    expect(html).toContain('github.com/homepresso/User-Tasks')
    expect(html).toContain('Apache-2.0')
    expect(html).toContain('git clone')
    expect(html).toContain('Two ways to run it')
    expect(html).not.toContain('Three ways to run it')
    expect(html).toContain('npm run setup:local')
    expect(html).toContain('.usertasks-first-login')
    expect(html).toContain('GB of memory for Docker')
    expect(html).toContain('Prefer to do it by hand?')
    expect(html).toContain('npx supabase status -o env')
    expect(html).toContain('npm run stack -- up')
    // The CLI is optional and installs nothing.
    expect(html).toContain('Then drive it from the terminal')
    expect(html).toContain('doesn&#x27;t install a server, a database or Supabase')
    expect(html).toContain('npm install -g @user-tasks/cli')
    expect(html).toContain('usertasks login')
    expect(html).toContain('http://localhost:3000')
  })

  it('uses commands that exist', () => {
    for (const script of ['dev', 'stack', 'setup-code', 'bootstrap', 'setup:local']) expect(scripts[script], script).toBeTruthy()
    expect(scripts['setup:local']).toBe('tsx scripts/setup-local.ts')
    expect(readme).toContain('npm run setup:local')
    expect(readme).toContain('npx supabase status -o env')
    expect(readme).toContain('cp .env.example .env.local')
  })

  it('explains the first sign-in with the setup code, and has one h1 plus HowTo / FAQ data', () => {
    expect(html).toContain('Create your admin account')
    expect(html).toContain('UserTasks setup code: XXXX-XXXX-XXXX')
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1)
    expect(html).toContain('"@type":"HowTo"')
    expect(html).toContain('"@type":"FAQPage"')
    expect(html).not.toMatch(/retiring|going open source/i)
  })

  it('has a beginner guide with every step, one command per snippet, and what you\'ll see', () => {
    expect(html).toContain('id="first-time"')
    expect(html).toContain('Never done this before? Follow these steps')
    for (const title of ['Install three things', 'Open a terminal', 'Copy UserTasks to your computer', 'Set everything up', 'Start it', 'Open http://localhost:3000 in your browser', 'You&#x27;re in', 'Stopping and starting again']) {
      expect(html, title).toContain(title)
    }
    for (const link of ['https://git-scm.com/downloads', 'https://nodejs.org/', 'https://www.docker.com/products/docker-desktop/', '/docs/self-hosting/troubleshooting', '/docs/self-hosting/quick-start', '/gallery', '/docs/self-hosting/invite-people']) {
      expect(html, link).toContain(`href="${link}"`)
    }
    for (const needle of ['WSL 2', 'PowerShell', 'Terminal', 'Ctrl+C', 'npm run setup-code', 'Could not read package.json', 'Docker Desktop']) expect(html, needle).toContain(needle)
    expect(html.match(/What you’ll see:|What you&rsquo;ll see:/g)?.length).toBe(8)
    // Each beginner snippet is a single command (one copy button, one thing).
    const codes = [...html.matchAll(/<code class="font-mono">([^<]*)<\/code>/g)].map((m) => m[1])
    for (const command of ['git clone https://github.com/homepresso/User-Tasks.git usertasks', 'cd usertasks', 'npm run setup:local', 'npm run dev', 'npx supabase stop', 'npx supabase start']) {
      expect(codes, command).toContain(command)
    }
  })

  it('describes the beginner steps in the HowTo data, and the CLI in the FAQ', () => {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)![1])
    const howTo = ld['@graph'].find((node: { '@type': string }) => node['@type'] === 'HowTo')
    expect(howTo.name).toBe('Install and start UserTasks on your computer')
    expect(howTo.tool).toContain('Docker Desktop')
    const steps = howTo.step.map((step: { name: string; text: string }) => step.name)
    expect(steps).toEqual(['Install three things', 'Open a terminal', 'Copy UserTasks to your computer', 'Set everything up', 'Start it', 'Create your admin account', 'Stop and start again'])
    expect(JSON.stringify(howTo)).toContain('npm run setup:local')
    expect(JSON.stringify(howTo)).not.toContain('db reset')
    const faq = ld['@graph'].find((node: { '@type': string }) => node['@type'] === 'FAQPage')
    const cli = faq.mainEntity.find((q: { name: string }) => q.name === 'Does the CLI install UserTasks?')
    expect(cli.acceptedAnswer.text).toMatch(/^No\./)
  })

  it('hides repository links while NEXT_PUBLIC_REPOSITORY_URL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', '')
    const bare = renderToStaticMarkup(createElement(OpenSourcePage))
    expect(bare).not.toMatch(/github\.com/i)
    expect(bare).toContain('git clone &lt;repository-url&gt;.git usertasks')
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', 'https://github.com/homepresso/User-Tasks')
  })
})
