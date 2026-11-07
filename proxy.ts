import { NextResponse, type NextRequest } from "next/server"
import { contentSecurityPolicy } from "@/lib/csp"
import { configuredAppUrl } from "@/lib/config/bootstrap"
import { updateSession } from "@/lib/supabase/middleware"
import { FRAME_PATH_PREFIX } from "@/lib/forms/custom-controls/frame"
import { isFrameableFormPath } from "@/lib/forms/embed"
import {
  HOST_WORKSPACE_HEADER, INVALID_HOST_MARK, REQUEST_PATH_HEADER, WORKSPACE_HOP_PREFIX,
  baseDomainFromEnv, classifyHost, parseWorkspaceHop, workspaceOrigin,
} from "@/lib/workspace-address"

/** Public form links (lib/forms/anonymous.ts ANONYMOUS_PATH_PREFIX; kept literal so the proxy bundle stays small). */
const ANONYMOUS_PATH_PREFIX = "/p/"
/** Friendly form links (app/form/[name]): public to visitors only when the form opted in. */
const FRIENDLY_FORM_PREFIX = "/form/"
/** Any session cookie (Supabase or built-in, host-only or shared). */
const SESSION_COOKIE_RE = /^(sb-|__Secure-sb-|__Secure-ut_session|__Host-ut_session|ut_session)/

export async function proxy(request: NextRequest) {
  // Workspace addresses (lib/workspace-address.ts): tell the server which
  // workspace the Host names. Client-sent copies of these headers are
  // always dropped, so only the proxy sets them.
  const baseDomain = baseDomainFromEnv()
  const host = classifyHost(request.headers.get("host"), baseDomain)
  request.headers.delete(HOST_WORKSPACE_HEADER)
  request.headers.delete(REQUEST_PATH_HEADER)
  if (host.kind === "workspace") request.headers.set(HOST_WORKSPACE_HEADER, host.label)
  else if (host.kind === "invalid") request.headers.set(HOST_WORKSPACE_HEADER, INVALID_HOST_MARK)
  const search = new URLSearchParams(request.nextUrl.search)
  search.delete("_rsc")
  const query = search.toString()
  request.headers.set(REQUEST_PATH_HEADER, `${request.nextUrl.pathname}${query ? `?${query}` : ""}`)

  // /ws/<subdomain>/<path> on the apex: the hop back to a workspace address
  // after signing in (auth flows only carry same-origin paths). The target
  // is always <subdomain>.<base domain> — never another host.
  if (baseDomain && host.kind === "apex" && request.nextUrl.pathname.startsWith(WORKSPACE_HOP_PREFIX)) {
    const hop = parseWorkspaceHop(request.nextUrl.pathname, request.nextUrl.search)
    if (hop) {
      const origin = workspaceOrigin(hop.subdomain, baseDomain, configuredAppUrl())
      const response = NextResponse.redirect(`${origin}${hop.path}`, 307)
      response.headers.set("Cache-Control", "no-store")
      return response
    }
  }

  const response = await updateSession(request)
  // Custom form control frames carry their own (much stricter) CSP.
  if (request.nextUrl.pathname.startsWith(FRAME_PATH_PREFIX)) return response
  // Per-request CSP from the runtime config (replaces next.config's
  // build-time header on every proxied path).
  // Public form links (/p/<token>, and /form/<name> for a visitor without a
  // session): the same policy plus the bot-protection widget hosts (loaded
  // only when a workspace configured one); the URL never leaves in a
  // Referer header.
  const signedOut = !request.cookies.getAll().some((c) => SESSION_COOKIE_RE.test(c.name))
  const publicForm = request.nextUrl.pathname.startsWith(ANONYMOUS_PATH_PREFIX)
    || (signedOut && request.nextUrl.pathname.startsWith(FRIENDLY_FORM_PREFIX))
  // Form link pages (/f/<id>, /form/<name>, /p/<token>, /form-login) may be
  // embedded by any site (lib/forms/embed.ts: the page itself never uses a
  // session inside a frame from another origin); every other page: no framing.
  const frameable = isFrameableFormPath(request.nextUrl.pathname)
  response.headers.set("Content-Security-Policy", contentSecurityPolicy({ captcha: publicForm, frameAncestors: frameable ? "*" : "'none'" }))
  if (frameable) response.headers.delete("X-Frame-Options")
  else response.headers.set("X-Frame-Options", "DENY")
  if (publicForm || request.nextUrl.pathname.startsWith("/api/public/forms/")) {
    response.headers.set("Referrer-Policy", "no-referrer")
    response.headers.set("Cache-Control", "no-store")
  }
  return response
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
