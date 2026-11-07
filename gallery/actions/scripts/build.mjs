#!/usr/bin/env node
/**
 * Build the official workflow actions: <slug>/src/action.ts → <slug>/dist/action.js
 * (one self-contained ES module per action, no imports left, readable output).
 *
 *   node gallery/actions/scripts/build.mjs              build every action
 *   node gallery/actions/scripts/build.mjs ut-slug …    build some
 *   node gallery/actions/scripts/build.mjs --check      rebuild in memory, fail if dist/ differs (CI)
 *
 * Uses the repository's esbuild (no dependencies of its own). Imports an action
 * may use: relative files, `@usertasks/action` (packages/action/src) and `@/…`
 * (repository files, e.g. lib/documents/pii/validators.ts). `node:crypto` is
 * replaced by a stub that throws (the sandbox has no Node APIs; use ctx.crypto).
 * Anything else is an error: actions bundle their code and have no npm deps.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const actionsDir = path.resolve(here, '..')
const repoDir = path.resolve(actionsDir, '..', '..')
const MAX_BYTES = 200 * 1024

const { build } = await import('esbuild')

const args = process.argv.slice(2)
const check = args.includes('--check')
const wanted = args.filter((a) => !a.startsWith('--'))

const slugs = readdirSync(actionsDir)
  .filter((name) => existsSync(path.join(actionsDir, name, 'manifest.json')) && existsSync(path.join(actionsDir, name, 'src', 'action.ts')))
  .filter((name) => wanted.length === 0 || wanted.includes(name))
  .sort()

for (const name of wanted) {
  if (!slugs.includes(name)) {
    console.error(`No action folder "${name}" (expected gallery/actions/${name}/manifest.json and src/action.ts)`)
    process.exit(1)
  }
}

function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Resolve the few allowed import specifiers; refuse everything else. */
const sandboxImports = {
  name: 'usertasks-action-imports',
  setup(b) {
    b.onResolve({ filter: /^node:crypto$|^crypto$/ }, () => ({ path: 'node-crypto-stub', namespace: 'ut-stub' }))
    b.onLoad({ filter: /.*/, namespace: 'ut-stub' }, () => ({
      contents: "const unavailable = () => { throw new Error('node:crypto is not available in the action sandbox (use ctx.crypto)') }\nexport const createHash = unavailable\nexport default { createHash: unavailable }\n",
      loader: 'js',
    }))
    b.onResolve({ filter: /^@usertasks\/action$/ }, () => ({ path: path.join(repoDir, 'packages', 'action', 'src', 'index.ts') }))
    b.onResolve({ filter: /^@\// }, (a) => {
      const file = resolveTs(path.join(repoDir, a.path.slice(2)))
      return file ? { path: file } : { errors: [{ text: `Cannot resolve ${a.path}` }] }
    })
    b.onResolve({ filter: /^[^./]/ }, (a) => ({ errors: [{ text: `"${a.path}" is not allowed: an action bundles its own code (relative imports, @usertasks/action and @/… only)` }] }))
  },
}

let failed = false
for (const slug of slugs) {
  const dir = path.join(actionsDir, slug)
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  const banner = `/*! UserTasks action ${manifest.key} ${manifest.version} */`
  let code
  try {
    const result = await build({
      entryPoints: [path.join(dir, 'src', 'action.ts')],
      // File comments in the output are relative to this: stable on every machine.
      absWorkingDir: repoDir,
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      minify: false,
      legalComments: 'inline',
      charset: 'utf8',
      treeShaking: true,
      banner: { js: banner },
      plugins: [sandboxImports],
      logLevel: 'silent',
    })
    code = result.outputFiles[0].text
  } catch (error) {
    console.error(`${slug}: build failed\n${error.message ?? error}`)
    failed = true
    continue
  }
  if (!code.startsWith(`${banner}\n`)) {
    console.error(`${slug}: the banner must be the first line`)
    failed = true
  }
  if (/^\s*import[\s{*"']|\bimport\s*\(|^\s*export\s[^;]*\sfrom\s/m.test(code)) {
    console.error(`${slug}: the bundle still contains an import (an action must be one self-contained module)`)
    failed = true
  }
  const bytes = Buffer.byteLength(code, 'utf8')
  if (bytes > MAX_BYTES) {
    console.error(`${slug}: ${bytes} bytes is over the ${MAX_BYTES} byte budget`)
    failed = true
  }
  const out = path.join(dir, 'dist', 'action.js')
  if (check) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : null
    if (current !== code) {
      console.error(`${slug}: dist/action.js is out of date (run node gallery/actions/scripts/build.mjs ${slug})`)
      failed = true
    } else {
      console.log(`${slug}: up to date (${(bytes / 1024).toFixed(1)} KB)`)
    }
  } else {
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, code)
    console.log(`${slug}: dist/action.js ${(bytes / 1024).toFixed(1)} KB`)
  }
}

if (slugs.length === 0) console.warn('No actions found')
if (failed) process.exit(1)
