/** esbuild options shared by build and dev: ONE self-contained ES module. */
export const ENTRY = 'src/ut-star-rating.ts'

export function esbuildOptions(manifest, { dev = false } = {}) {
  return {
    entryPoints: [ENTRY],
    outfile: `dist/${manifest.entry ?? 'index.js'}`,
    bundle: true, // lit and everything else inlined: the frame cannot load other files
    format: 'esm',
    splitting: false,
    platform: 'browser',
    target: 'es2022',
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    legalComments: 'eof',
    metafile: true,
    logLevel: 'info',
  }
}
