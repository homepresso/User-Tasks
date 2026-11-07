// Imported by next.config.ts and scripts/function-size.ts: keep it free of
// other imports.
//
// Server functions ship only the files their build trace lists. Code that
// reads repository files through a runtime path marks the read
// `/*turbopackIgnore: true*/` (otherwise Turbopack traces the whole project
// into every function), so those files are added back here, to the routes
// that read them. Keys are route globs, values are globs from the project root
// (https://nextjs.org/docs/app/api-reference/config/next-config-js/output).

/**
 * The QuickJS sandbox (lib/custom-actions/sandbox.ts) loads these
 * serverExternalPackages from node_modules (bundling them broke the embedded
 * WebAssembly string). They are traced wherever the sandbox is imported;
 * listing them for every route (about 3 MB with the source maps Turbopack adds) keeps any function that can run
 * a workflow — pages with server actions, the workflow, cron, activity, MCP
 * and v1 API routes — able to run custom actions whatever the import graph.
 */
const QUICKJS_RUNTIME_FILES = [
  'node_modules/quickjs-emscripten-core/package.json',
  'node_modules/quickjs-emscripten-core/dist/index.js',
  'node_modules/quickjs-emscripten-core/dist/*.mjs',
  'node_modules/@jitl/quickjs-singlefile-cjs-release-sync/package.json',
  'node_modules/@jitl/quickjs-singlefile-cjs-release-sync/dist/index.js',
  'node_modules/@jitl/quickjs-singlefile-cjs-release-sync/dist/ffi.js',
  'node_modules/@jitl/quickjs-singlefile-cjs-release-sync/dist/emscripten-module.cjs',
  'node_modules/@jitl/quickjs-ffi-types/package.json',
  'node_modules/@jitl/quickjs-ffi-types/dist/index.js',
  'node_modules/@jitl/quickjs-ffi-types/dist/index.mjs',
]

export const OUTPUT_FILE_TRACING_INCLUDES: Record<string, string[]> = {
  '/**': [
    ...QUICKJS_RUNTIME_FILES,
    // lib/providers/db/pg-auth.ts: the Amazon RDS CA bundle for
    // DATABASE_AUTH=aws (the Docker image also copies it to certs/).
    'deploy/aws/rds-global-bundle.pem',
  ],
  // lib/docs/generated.ts: the env var reference and the Markdown pages the
  // docs include (the docs are prerendered; listed for on-demand renders).
  '/docs/**': ['.env.example', 'docs/**/*.md'],
  // lib/admin/switch (Settings → Infrastructure provider switching) applies
  // the migrations to the target database.
  '/settings/**': ['supabase/migrations/*.sql'],
}

/**
 * OCR (lib/documents/ocr.ts, DOCUMENT_OCR_PROVIDER=tesseract): tesseract.js
 * runs its recognizer in a worker thread started from a file path, so the
 * tracer sees the worker entry but none of what it loads: the rest of the
 * worker script, its dependencies and the WebAssembly core (the LSTM builds;
 * the app always asks for OEM 1, LSTM only). next.config.ts adds these to the
 * standalone output (the Docker image, built with INCLUDE_OCR=true) when
 * tesseract.js is installed. Serverless deploys leave them out (about 9 MB
 * per function); OCR there needs a cloud provider
 * (DOCUMENT_OCR_PROVIDER=azure_document_intelligence).
 */
export const TESSERACT_WORKER_FILES = [
  'node_modules/tesseract.js/package.json',
  'node_modules/tesseract.js/src/**/*.js',
  'node_modules/tesseract.js/node_modules/**/*.{js,json}',
  'node_modules/tesseract.js-core/package.json',
  'node_modules/tesseract.js-core/index.js',
  'node_modules/tesseract.js-core/tesseract-core{,-simd,-relaxedsimd}-lstm.{js,wasm}',
  'node_modules/wasm-feature-detect/package.json',
  'node_modules/wasm-feature-detect/dist/cjs/**/*',
  'node_modules/bmp-js/**/*.{js,json}',
  'node_modules/zlibjs/package.json',
  'node_modules/zlibjs/bin/node-zlib.js',
  'node_modules/is-url/**/*.{js,json}',
  'node_modules/regenerator-runtime/**/*.{js,json}',
]

/**
 * Files that must be in the traced output of matching functions; checked by
 * scripts/function-size.ts after a build. `routes` is a regular expression on
 * the app path without route groups (e.g. `/tasks/[id]/page`, `/api/v1/me/route`).
 */
export const REQUIRED_TRACED_FILES: { routes: RegExp; files: string[]; why: string }[] = [
  {
    routes: /^\/(api\/(workflows|cron|mcp|v1)\/|[^/]*\/?.*\/page$|page$)/,
    files: [
      'node_modules/@jitl/quickjs-singlefile-cjs-release-sync/dist/index.js',
      'node_modules/quickjs-emscripten-core/dist/index.mjs',
      'node_modules/@jitl/quickjs-ffi-types/dist/index.mjs',
    ],
    why: 'functions that can run a workflow run custom actions in the QuickJS sandbox',
  },
  {
    routes: /^\/form-controls\/frame\/gallery\//,
    files: ['gallery/controls/chart/manifest.json', 'gallery/controls/chart/dist/ut-chart.js'],
    why: 'official form controls are served from gallery/controls',
  },
  {
    routes: /^\/docs\/\[\.\.\.slug\]\/page$/,
    files: ['.env.example', 'docs/self-hosting.md'],
    why: 'the docs read these repository files',
  },
  {
    routes: /^\/settings\/infrastructure\/page$/,
    files: ['supabase/migrations/20261015000000_baseline.sql'],
    why: 'provider switching applies the migrations',
  },
  {
    routes: /^\//,
    files: ['deploy/aws/rds-global-bundle.pem'],
    why: 'DATABASE_AUTH=aws verifies the database with the RDS CA bundle',
  },
]
