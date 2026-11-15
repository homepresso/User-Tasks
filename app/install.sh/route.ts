import { installScriptResponse } from '@/lib/install-scripts/serve'

// Read from deploy/install/ when the route is prerendered.
export const dynamic = 'force-static'

/** GET /install.sh: the one-line installer for Linux and macOS (`curl -fsSL …/install.sh | sh`). */
export function GET() {
  return installScriptResponse('install.sh')
}
