// Bundles the CLI into one CommonJS file (dist/admin.cjs, or the path given),
// for the Docker image and `npx`. For `npx`, `pg` and the cloud SDKs stay
// external; in the image, see standaloneExternals below.
//
//   node packages/admin/scripts/build.mjs [outfile]
import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importMetaUrlShim, standaloneExternals } from '../../../scripts/standalone-externals.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outfile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist/admin.cjs')

// Next to a Next.js standalone server (the Docker image): external only what
// its node_modules can load (scripts/standalone-externals.mjs).
const standaloneDir = path.dirname(outfile)
const inStandalone = existsSync(path.join(standaloneDir, 'server.js'))

await build({
  entryPoints: [path.join(root, 'src/bin.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  // The cloud SDKs (DATABASE_AUTH=azure|gcp, and the optional storage / email /
  // secrets SDKs the providers load on first use) come from the app's node_modules.
  ...(inStandalone ? { plugins: [standaloneExternals(standaloneDir, { bundleAlways: ['next'] })], ...importMetaUrlShim } : {}),
  external: inStandalone ? [] : ['pg', 'pg-native', '@azure/*', '@aws-sdk/*', '@smithy/*', '@google-cloud/*', 'google-auth-library', 'googleapis', 'nodemailer'],
  logLevel: 'warning',
})
console.log(`usertasks-admin bundled to ${outfile}`)
