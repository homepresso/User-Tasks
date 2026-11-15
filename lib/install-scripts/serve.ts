import { readFileSync } from 'fs'
import path from 'path'

/**
 * The one-line installers served by the app (GET /install.sh, /install.ps1):
 * the files in deploy/install/, read when the route is prerendered. The same
 * files are attached to every GitHub release (scripts/release-bundle.ts).
 */
export const INSTALL_SCRIPTS = {
  'install.sh': { file: 'deploy/install/install.sh', type: 'text/x-shellscript; charset=utf-8' },
  'install.ps1': { file: 'deploy/install/install.ps1', type: 'text/plain; charset=utf-8' },
} as const

export type InstallScriptName = keyof typeof INSTALL_SCRIPTS

export function readInstallScript(name: InstallScriptName): string {
  return readFileSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ process.cwd(), INSTALL_SCRIPTS[name].file), 'utf8')
}

export function installScriptResponse(name: InstallScriptName): Response {
  return new Response(readInstallScript(name), {
    headers: {
      'Content-Type': INSTALL_SCRIPTS[name].type,
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
