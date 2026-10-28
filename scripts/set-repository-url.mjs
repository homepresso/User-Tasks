#!/usr/bin/env node
// Points the repository at its public URL, in one step, once it is known:
//
//   node scripts/set-repository-url.mjs https://github.com/<owner>/<repo> [--dry-run]
//
// - packages/sdk and packages/cli package.json: `repository`, `homepage`, `bugs`
//   (npm provenance needs repository.url to match the repo the release runs in)
// - README.md: the clone URL and a badge row (CI, npm versions, licence)
// - SECURITY.md: report through GitHub private vulnerability reporting
// - .github/ISSUE_TEMPLATE/config.yml: the security contact link
// It is idempotent (run it again to change the URL) and prints the hosted
// deployment's NEXT_PUBLIC_REPOSITORY_URL to set. See docs/launch-checklist.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = ['sdk', 'cli']
const BADGES_START = '<!-- badges:start -->'
const BADGES_END = '<!-- badges:end -->'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const input = args.find((arg) => !arg.startsWith('--'))
if (!input || args.includes('--help') || args.includes('-h')) {
  console.error('usage: node scripts/set-repository-url.mjs https://github.com/<owner>/<repo> [--dry-run]')
  process.exit(input ? 0 : 2)
}

const match = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(input.trim())
if (!match || match[2] === '.' || match[2] === '..') {
  console.error(`Not a GitHub repository URL: ${input}\nExpected https://github.com/<owner>/<repo>`)
  process.exit(2)
}
const [, owner, repo] = match
const REPO = `https://github.com/${owner}/${repo}`
const SLUG = `${owner}/${repo}`

const changed = []
function update(rel, transform) {
  const file = path.join(ROOT, rel)
  if (!existsSync(file)) {
    console.warn(`skip ${rel} (missing)`)
    return
  }
  const before = readFileSync(file, 'utf8')
  const after = transform(before)
  if (after === before) return
  changed.push(rel)
  if (!dryRun) writeFileSync(file, after)
}

// ── npm package metadata ───────────────────────────────────────────────────
for (const name of PACKAGES) {
  update(`packages/${name}/package.json`, (text) => {
    const pkg = JSON.parse(text)
    const meta = {
      repository: { type: 'git', url: `git+${REPO}.git`, directory: `packages/${name}` },
      homepage: `${REPO}/tree/main/packages/${name}#readme`,
      bugs: { url: `${REPO}/issues` },
    }
    // Keep a stable key order: the metadata goes right after "license".
    const out = {}
    for (const [key, value] of Object.entries(pkg)) {
      if (key in meta) continue
      out[key] = value
      if (key === 'license') Object.assign(out, meta)
    }
    if (!('repository' in out)) Object.assign(out, meta)
    return `${JSON.stringify(out, null, 2)}\n`
  })
}

// ── README: clone URL and badges ───────────────────────────────────────────
update('README.md', (text) => {
  let out = text.replace(/git clone (?:<this repo>|https:\/\/github\.com\/[^\s]+?)(?= )/g, `git clone ${REPO}.git`)
  const badges = [
    BADGES_START,
    `[![CI](${REPO}/actions/workflows/ci.yml/badge.svg?branch=main)](${REPO}/actions/workflows/ci.yml)`,
    `[![@usertasks/sdk](https://img.shields.io/npm/v/@usertasks/sdk?label=%40usertasks%2Fsdk)](https://www.npmjs.com/package/@usertasks/sdk)`,
    `[![@usertasks/cli](https://img.shields.io/npm/v/@usertasks/cli?label=%40usertasks%2Fcli)](https://www.npmjs.com/package/@usertasks/cli)`,
    `[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)`,
    BADGES_END,
  ].join('\n')
  const existing = new RegExp(`${BADGES_START}[\\s\\S]*?${BADGES_END}`)
  if (existing.test(out)) return out.replace(existing, badges)
  if (/^# UserTasks\s*$/m.test(out)) return out.replace(/^# UserTasks\s*$/m, `# UserTasks\n\n${badges}`)
  console.warn('README.md: no "# UserTasks" heading, badges not added')
  return out
})

// ── SECURITY.md ────────────────────────────────────────────────────────────
const ADVISORY = `${REPO}/security/advisories/new`
update('SECURITY.md', (text) => {
  const paragraph = [
    'Please report security vulnerabilities privately, through GitHub\'s',
    `[private vulnerability reporting](${ADVISORY}) (the repository's`,
    '**Security** tab → **Report a vulnerability**). If you cannot use GitHub,',
    'use the contact form at <https://usertasks.com/contact> and start the',
    'message with "Security". Do not report a suspected vulnerability in a',
    'public issue, pull request, discussion or forum post.',
  ].join('\n')
  return text.replace(/(## Reporting a vulnerability\n\n)Please report security vulnerabilities privately[\s\S]*?\n\n/, `$1${paragraph}\n\n`)
})

// ── Issue template contact link ────────────────────────────────────────────
update('.github/ISSUE_TEMPLATE/config.yml', (text) =>
  text.replace(/(- name: Report a security vulnerability\n\s+url: )\S+/, `$1${ADVISORY}`),
)

console.log(`${dryRun ? 'Would update' : 'Updated'} for ${REPO}:`)
for (const rel of changed) console.log(`  ${rel}`)
if (changed.length === 0) console.log('  (nothing to change)')
console.log(`
Next:
  - Review and commit:   git diff && git commit -am "Launch: repository URL ${SLUG}"
  - Hosted deployment (build-time variable, then redeploy):
      NEXT_PUBLIC_REPOSITORY_URL=${REPO}
      e.g. printf '%s' '${REPO}' | vercel env add NEXT_PUBLIC_REPOSITORY_URL production
  - GitHub: enable Settings → Code security → Private vulnerability reporting,
    and add the NPM_TOKEN secret before tagging sdk-v* / cli-v*.`)
