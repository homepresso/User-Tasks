// esbuild plugin for the CLIs bundled into the Docker image next to the
// Next.js standalone server (worker.cjs, admin.cjs). The standalone
// node_modules only holds what the server's traced files load — Next bundles
// most packages (zod, jose, supabase-js, next/headers, …) into its own chunks —
// so a package stays external only when it resolves from that directory;
// everything else is bundled from the repository's node_modules. A package
// that resolves from neither (an optional driver left out of the image)
// stays external and fails only if it is ever loaded.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export function standaloneExternals(standaloneDir, { bundleAlways = [] } = {}) {
  const standaloneModules = path.join(path.resolve(standaloneDir), 'node_modules')
  const repoModules = path.join(process.cwd(), 'node_modules')
  const fromRepo = createRequire(path.join(process.cwd(), 'noop.js'))
  const resolveFromRepo = (id) => {
    try {
      return fromRepo.resolve(id)
    } catch {
      return null
    }
  }
  /**
   * The file `id` resolves to in the repository, found at the same place in
   * the standalone node_modules. (Node's own lookup from the standalone
   * directory would walk up into the repository's node_modules at build time.)
   */
  const inStandalone = (file) => {
    if (!file || !path.isAbsolute(file)) return Boolean(file)
    const rel = path.relative(repoModules, file)
    return !rel.startsWith('..') && existsSync(path.join(standaloneModules, rel))
  }
  return {
    name: 'standalone-externals',
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, (args) => {
        if (args.path.startsWith('@/') || args.path.startsWith('@usertasks/')) return undefined
        if (args.path.startsWith('node:')) return { path: args.path, external: true }
        if (bundleAlways.some((p) => args.path === p || args.path.startsWith(`${p}/`))) return undefined
        const file = resolveFromRepo(args.path)
        if (!file) return { path: args.path, external: true }
        // Built-ins resolve to their bare name.
        if (!path.isAbsolute(file)) return { path: args.path, external: true }
        return inStandalone(file) ? { path: args.path, external: true } : undefined
      })
    },
  }
}

/**
 * esbuild options for bundling ESM packages into a CommonJS file: their
 * `import.meta.url` (e.g. `createRequire(import.meta.url)` in
 * @azure/storage-common) becomes the bundle's own file URL.
 */
export const importMetaUrlShim = {
  define: { 'import.meta.url': '__bundle_import_meta_url' },
  banner: { js: "const __bundle_import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
}
