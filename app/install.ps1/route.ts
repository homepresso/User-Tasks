import { installScriptResponse } from '@/lib/install-scripts/serve'

// Read from deploy/install/ when the route is prerendered.
export const dynamic = 'force-static'

/** GET /install.ps1: the one-line installer for Windows (`irm …/install.ps1 | iex`). */
export function GET() {
  return installScriptResponse('install.ps1')
}
