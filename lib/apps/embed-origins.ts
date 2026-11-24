/**
 * App page embeds (Embed and Video widgets, pure; __tests__/apps-embed.test.ts).
 *
 * An Embed widget frames another site only when its origin is on the
 * workspace's list of sites app pages may embed (Settings → Embedding,
 * tenants.settings.apps.embed_origins; admins with settings.edit) — enforced
 * when the page is sent (lib/services/apps.ts drops the address otherwise).
 * Videos play from YouTube (privacy-enhanced host) and Vimeo players, or an
 * https:// video file. App pages' Content-Security-Policy allows https frames
 * (proxy.ts); which origins actually render is this list.
 */

/** Video players always allowed (the URLs are rewritten to these embed hosts). */
export const VIDEO_EMBED_ORIGINS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'] as const
export const MAX_APP_EMBED_ORIGINS = 30

export function originOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.origin.toLowerCase() : null
  } catch { return null }
}

/** Does an origin list allow this URL? Entries may use a leading *. wildcard (https://*.example.com). */
export function embedAllowed(url: string, origins: readonly string[]): boolean {
  const origin = originOf(url)
  if (!origin) return false
  const host = new URL(origin).host
  return origins.some((o) => {
    const entry = o.toLowerCase().replace(/\/+$/, '')
    if (entry === origin) return true
    const m = /^https:\/\/\*\.(.+)$/.exec(entry)
    return !!m && host.endsWith(`.${m[1]}`)
  })
}

/** A video URL → how to play it: a player frame (YouTube / Vimeo) or a file. Null when unsupported. */
export function videoSource(url: string): { kind: 'frame'; src: string } | { kind: 'file'; src: string } | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  const id = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{6,20}$/.test(s) ? s : null)
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    const v = id(u.searchParams.get('v')) ?? id(u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1])
    return v ? { kind: 'frame', src: `https://www.youtube-nocookie.com/embed/${v}` } : null
  }
  if (host === 'youtu.be') { const v = id(u.pathname.slice(1)); return v ? { kind: 'frame', src: `https://www.youtube-nocookie.com/embed/${v}` } : null }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const v = u.pathname.match(/(\d{5,12})/)?.[1]
    return v ? { kind: 'frame', src: `https://player.vimeo.com/video/${v}` } : null
  }
  if (/\.(mp4|webm|ogg|mov)$/i.test(u.pathname)) return { kind: 'file', src: u.toString() }
  return null
}
