import path from 'node:path'
import { defineConfig } from 'tsup'

/**
 * One self-contained ESM file (Node 20+, no runtime dependencies): the
 * gateway reuses core's Windows authentication transport
 * (lib/integrations/windows-auth) and the shared protocol (lib/gateway/
 * protocol.ts), bundled from the repository. The transport's egress guard
 * import is swapped for the gateway's own allowlist (src/egress-shim.ts):
 * on the customer's network the policy is "only the configured targets".
 * The optional `kerberos` package stays external (installed next to the
 * gateway when Kerberos is wanted).
 */
export default defineConfig({
  entry: { 'usertasks-gateway': 'src/main.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outExtension: () => ({ js: '.mjs' }),
  clean: true,
  sourcemap: true,
  external: ['kerberos'],
  banner: { js: '#!/usr/bin/env node' },
  esbuildPlugins: [{
    name: 'gateway-egress-shim',
    setup(build: { onResolve: (o: { filter: RegExp }, cb: () => { path: string }) => void }) {
      build.onResolve({ filter: /^@\/lib\/egress-guard$/ }, () => ({ path: path.resolve(__dirname, 'src/egress-shim.ts') }))
    },
  }],
})
