/**
 * Where the gallery build (scripts/gallery-build.ts) publishes the signed
 * packages and index: public/gallery. Its own module, free of other imports,
 * so a route that only reads the published files (the control preview,
 * lib/gallery/control-preview.ts) does not import lib/gallery/source.ts,
 * whose source-tree reads Turbopack (Next 16.4) traces as the whole project.
 * Statically scoped, so the route's trace holds public/gallery and nothing else.
 */
import { join } from 'node:path'

export const GALLERY_OUTPUT_DIR = join(process.cwd(), 'public', 'gallery')
