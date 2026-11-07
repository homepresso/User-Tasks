import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['quickjs-emscripten-core', '@jitl/quickjs-singlefile-cjs-release-sync'],
})
