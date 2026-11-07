/**
 * Builds public/downloads/action-starter.zip from templates/action-starter
 * (both variants, without node_modules, dist/, release/, .harness/ or lock
 * files). Deterministic: entries sorted, fixed
 * dates, so the committed zip only changes when the template does.
 *
 *   npm run action-starter:build            write the zip
 *   npm run action-starter:build -- --check exit 1 if the committed zip is stale
 *
 * __tests__/action-starter.test.ts fails when the zip and the
 * template drift apart.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'

const ROOT = process.cwd()
const STARTER_DIR = path.join(ROOT, 'templates/action-starter')
const STARTER_ZIP = path.join(ROOT, 'public/downloads/action-starter.zip')
/** Folder name inside the zip. */
const ZIP_PREFIX = 'action-starter/'

const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', '.harness'])
const SKIP_FILES = new Set(['.DS_Store', 'package-lock.json'])

/** Template files, relative and sorted (POSIX separators). */
function listStarterFiles(dir = STARTER_DIR, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...listStarterFiles(full, rel))
    } else if (!SKIP_FILES.has(name)) {
      out.push(rel)
    }
  }
  return out.sort()
}

function buildStarterZip(): Buffer {
  const zip = new PizZip()
  // Local-time constructor: the DOS date fields pizzip writes are the same in every time zone.
  const date = new Date(2026, 0, 1, 0, 0, 0)
  for (const rel of listStarterFiles()) {
    zip.file(`${ZIP_PREFIX}${rel}`, readFileSync(path.join(STARTER_DIR, rel)), { date, createFolders: false, binary: true })
  }
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' })
}

function main(): void {
  const zip = buildStarterZip()
  const rel = path.relative(ROOT, STARTER_ZIP)
  if (process.argv.includes('--check')) {
    const current = existsSync(STARTER_ZIP) ? readFileSync(STARTER_ZIP) : null
    if (!current || !current.equals(zip)) {
      console.error(`${rel} is stale: run npm run action-starter:build`)
      process.exit(1)
    }
    console.log(`${rel} is up to date`)
    return
  }
  mkdirSync(path.dirname(STARTER_ZIP), { recursive: true })
  writeFileSync(STARTER_ZIP, zip)
  console.log(`${rel}  ${(zip.length / 1024).toFixed(1)} KB  ${listStarterFiles().length} files`)
}

main()
