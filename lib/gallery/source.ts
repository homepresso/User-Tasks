/**
 * Reading gallery package sources (gallery/packages/<slug>/) from disk.
 * Node only (fs); used by the build script, the tests and the verifier.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { filesToManifest, type FilesToManifestError, type RepoFile } from '@/lib/github-sync/layout'
import type { GalleryMeta } from './types'

export const GALLERY_ROOT = resolve(process.cwd(), 'gallery')
export const GALLERY_PACKAGES_DIR = join(GALLERY_ROOT, 'packages')
export const GALLERY_OUTPUT_DIR = resolve(process.cwd(), 'public', 'gallery')
export const GALLERY_CATALOG_FILE = resolve(process.cwd(), 'lib', 'gallery', 'catalog.json')
export const GALLERY_SIGNING_FILE = join(GALLERY_ROOT, 'signing.json')

export interface GallerySource {
  dir: string
  slug: string
  meta: GalleryMeta
  readme: string
  /** Asset files relative to assets/ (config-as-code layout). */
  files: RepoFile[]
  /** filesToManifest of `files`: sections plus `table_rows`. */
  manifest: Record<string, any>
  /** Source path of every asset, parallel to manifest[section]. */
  paths: Record<string, string[]>
  errors: Array<FilesToManifestError | { path: string; error: string }>
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

/** Slugs of every package folder, sorted. */
export function listGallerySlugs(root = GALLERY_PACKAGES_DIR): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory() && existsSync(join(root, name, 'gallery.json'))).sort()
}

export function readGallerySource(slug: string, root = GALLERY_PACKAGES_DIR): GallerySource {
  const dir = join(root, slug)
  const errors: GallerySource['errors'] = []
  let meta: GalleryMeta
  try {
    meta = JSON.parse(readFileSync(join(dir, 'gallery.json'), 'utf8'))
  } catch (error) {
    throw new Error(`${slug}/gallery.json: ${(error as Error).message}`)
  }
  const readmePath = join(dir, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : ''
  if (!readme.trim()) errors.push({ path: `${slug}/README.md`, error: 'README.md is missing or empty' })

  const assetsDir = join(dir, 'assets')
  const files: RepoFile[] = existsSync(assetsDir)
    ? walk(assetsDir).filter((path) => path.endsWith('.json')).map((path) => ({ path: relative(assetsDir, path).split(sep).join('/'), content: readFileSync(path, 'utf8') }))
    : []
  if (!files.length) errors.push({ path: `${slug}/assets`, error: 'No asset files' })
  const parsed = filesToManifest(files, '')
  errors.push(...parsed.errors.map((error) => ({ path: `${slug}/assets/${error.path}`, error: error.error })))
  return { dir, slug, meta, readme, files, manifest: parsed.manifest, paths: parsed.paths, errors }
}

export function readAllGallerySources(root = GALLERY_PACKAGES_DIR): GallerySource[] {
  return listGallerySlugs(root).map((slug) => readGallerySource(slug, root))
}

export interface GallerySigningConfig {
  key_name: string
  /** Public values only: the maintainer pins the gallery key here once it exists. */
  fingerprint: string | null
  public_key: string | null
}

export function readGallerySigningConfig(path = GALLERY_SIGNING_FILE): GallerySigningConfig {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return { key_name: String(raw.key_name ?? 'UserTasks Gallery'), fingerprint: raw.fingerprint ?? null, public_key: raw.public_key ?? null }
}
