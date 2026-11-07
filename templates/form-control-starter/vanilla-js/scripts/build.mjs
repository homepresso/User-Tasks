/**
 * "Build" for the vanilla control: the source file already is the ES module
 * you upload. This checks the manifest and the module and copies the module
 * to dist/ — no dependencies, nothing to install.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { checkModule, readManifest } from './checks.mjs'

const manifest = readManifest()
const entry = manifest.entry ?? 'index.js'
const code = readFileSync(entry, 'utf8')
const bytes = checkModule(code, manifest.tag)
mkdirSync('dist', { recursive: true })
copyFileSync(entry, `dist/${entry}`)
console.log(`dist/${entry}  ${(bytes / 1024).toFixed(1)} KB  <${manifest.tag}> ${manifest.version}`)
