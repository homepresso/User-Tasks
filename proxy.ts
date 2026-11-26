import { NextResponse, type NextRequest } from "next/server"
import { APP_FRAME_SRC, contentSecurityPolicy, isAppPagePath } from "@/lib/csp"
import { configuredAppUrl } from "@/lib/config/bootstrap"
import { updateSession } from "@/lib/supabase/middleware"
import { FRAME_PATH_PREFIX } from "@/lib/forms/custom-controls/frame"
import { isFrameableFormPath } from "@/lib/forms/embed"
import { embedFrameAncestors, framedSessionsEnabled, getEmbedPolicy, isEmbedPath, sessionCookiesAllowed, workspaceEmbeddingEnabled } from "@/lib/embedding"
import { EMBED_TOKEN_PARAM, verifyEmbedToken } from "@/lib/embedding-token"
import { authCookieSecure } from "@/lib/providers/auth/cookies"
import { embedFrameSrc, readSsoFrameSources } from "@/lib/providers/auth/sso/frame-sources"
import { isDesignerEmbedPath } from "@/lib/embed/designers"
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id"
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

/** The registry front (app/v2: `docker pull usertasks.com/editions/…`). */
const REGISTRY_PREFIX = "/v2"

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  // Registry API: no session, no CSP, and `/v2/` keeps its trailing slash
  // (Docker's version check). next.config sets skipTrailingSlashRedirect,
  // so every other path gets Next's usual redirect to the slash-less form here.
  if (pathname === REGISTRY_PREFIX || pathname.startsWith(`${REGISTRY_PREFIX}/`)) return NextResponse.next()
  if (pathname.length > 1 && pathname.endsWith("/")) {
    // Same origin as the request (Next's proxy runtime needs an absolute Location). Leading
    // slashes collapse to one, so `//evil.example/` can never resolve to another host.
    const target = `${pathname.replace(/\/+$/, "").replace(/^\/{2,}/, "/") || "/"}${request.nextUrl.search}`
    return NextResponse.redirect(new URL(target, new URL(request.url).origin), 308)
  }

  // Correlation id (lib/request-id.ts): forwarded to the server, echoed on the response.
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER))
  request.headers.set(REQUEST_ID_HEADER, requestId)

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

  // Trusted embedding (lib/embedding.ts): with framed sessions on, session
  // cookies are SameSite=None, so drop them from the cross-site requests
  // SameSite=Lax would have kept them from (CSRF stays as before).
  const embedPolicy = getEmbedPolicy()
  if (framedSessionsEnabled(authCookieSecure(), embedPolicy) && !sessionCookiesAllowed({
    method: request.method,
    pathname: request.nextUrl.pathname,
    get: (name) => request.headers.get(name),
  })) {
    for (const c of request.cookies.getAll()) if (SESSION_COOKIE_RE.test(c.name)) request.cookies.delete(c.name)
  }

  const response = await updateSession(request)
  response.headers.set(REQUEST_ID_HEADER, requestId)
  // Custom form control frames carry their own (much stricter) CSP.
  if (request.nextUrl.pathname.startsWith(FRAME_PATH_PREFIX)) return response
  // Stored files (/files/<bucket>/<key>, lib/storage/serve.ts) carry their own
  // sandboxing CSP; Next keeps a header the proxy already set over the route's,
  // so the app policy (inline scripts allowed) must not be set here.
  if (request.nextUrl.pathname.startsWith("/files/")) return response
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
  // Embeddable routes (/embed/…): only the approved sites (trusted embedding):
  // the instance list, plus — per-workspace lists on — the origins a signed
  // token names for this workspace's own address (no database lookup here).
  const embedPath = isEmbedPath(request.nextUrl.pathname)
  const workspaceOrigins = embedPath && host.kind === "workspace" && workspaceEmbeddingEnabled()
    ? verifyEmbedToken(request.nextUrl.searchParams.get(EMBED_TOKEN_PARAM), host.label)
    : []
  const embeddable = embedPath && (embedPolicy.origins.length > 0 || workspaceOrigins.length > 0)
  response.headers.set("Content-Security-Policy", contentSecurityPolicy({
    captcha: publicForm,
    frameAncestors: frameable ? "*" : embeddable ? embedFrameAncestors(embedPolicy, workspaceOrigins) : "'none'",
    // Automatic sign-in's hidden frame goes to the identity provider (lib/providers/auth/sso/frame-sources.ts).
    ...(embeddable && readSsoFrameSources().length ? { frameSrc: embedFrameSrc() } : isAppPagePath(request.nextUrl.pathname) ? { frameSrc: APP_FRAME_SRC } : {}),
  }))
  if (frameable || embeddable) response.headers.delete("X-Frame-Options")
  else response.headers.set("X-Frame-Options", "DENY")
  // Embedded designers always show the latest saved draft: never from an HTTP / back-forward cache.
  if (isDesignerEmbedPath(request.nextUrl.pathname)) response.headers.set("Cache-Control", "private, no-store, max-age=0")
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

