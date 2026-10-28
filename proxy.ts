import { type NextRequest } from "next/server"
import { contentSecurityPolicy } from "@/lib/csp"
import { updateSession } from "@/lib/supabase/middleware"

export async function proxy(request: NextRequest) {
  const response = await updateSession(request)
  // Per-request CSP from the runtime config (replaces next.config's
  // build-time header on every proxied path).
  response.headers.set("Content-Security-Policy", contentSecurityPolicy())
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
