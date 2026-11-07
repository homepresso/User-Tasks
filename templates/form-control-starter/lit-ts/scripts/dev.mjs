/**
 * npm run dev → rebuilds on save and serves the harness with live reload:
 * open http://localhost:5180/harness/
 * The dev build (unminified, inline source map) is served from memory and
 * never written to dist/, so npm run package always ships the real build.
 */
import * as esbuild from 'esbuild'
import { readManifest } from './checks.mjs'
import { esbuildOptions } from './options.mjs'

const manifest = readManifest()
const ctx = await esbuild.context({ ...esbuildOptions(manifest, { dev: true }), write: false })
await ctx.watch()
const port = Number(process.env.PORT) || 5180
await ctx.serve({ servedir: '.', port, host: '127.0.0.1' })
console.log(`Harness: http://localhost:${port}/harness/  (edit src/, the page reloads)`)
