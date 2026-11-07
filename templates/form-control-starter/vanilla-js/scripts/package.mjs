/**
 * Makes release/<tag>-<version>.zip — manifest.json and the module at the
 * root of the zip — ready to upload in Extensibility → Form controls.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ZIP_BYTES, checkModule, readManifest } from './checks.mjs'
import { makeZip } from './zip.mjs'

const manifest = readManifest()
const entry = manifest.entry ?? 'index.js'
const modulePath = `dist/${entry}`
if (!existsSync(modulePath)) throw new Error(`${modulePath} is missing: run npm run build first`)
const code = readFileSync(modulePath)
checkModule(code.toString('utf8'), manifest.tag)

const zip = makeZip([
  { name: 'manifest.json', data: readFileSync('manifest.json') },
  { name: entry, data: code },
])
if (zip.length > ZIP_BYTES) throw new Error(`zip is ${zip.length} bytes; the limit is ${ZIP_BYTES}`)
mkdirSync('release', { recursive: true })
const out = `release/${manifest.tag}-${manifest.version}.zip`
writeFileSync(out, zip)
console.log(`${out}  ${(zip.length / 1024).toFixed(1)} KB — upload it in Extensibility → Form controls`)
