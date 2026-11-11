import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // @user-tasks/sdk, commander and yaml stay external (runtime dependencies).
})
