/**
 * Sanitizer for user-uploaded SVG icons rendered inline (workflow node
 * icons). Strips script vectors while keeping ordinary vector markup:
 * <script>/<foreignObject>/<use xlink> elements, on* event handlers, and
 * javascript:/data: URLs in attributes.
 */
export function sanitizeSvg(raw: string): string | null {
  const input = String(raw ?? '').trim()
  if (!input) return null
  // Must be a single <svg> document.
  if (!/^<svg[\s>]/i.test(input) || !/<\/svg>\s*$/i.test(input)) return null
  if (input.length > 50_000) return null

  let svg = input
  // Remove comment blocks first (they can hide payloads from the tag regexes).
  svg = svg.replace(/<!--[\s\S]*?-->/g, '')
  // Drop dangerous elements entirely (with their content).
  svg = svg.replace(/<(script|foreignObject|iframe|object|embed|style)[\s\S]*?<\/\1\s*>/gi, '')
  svg = svg.replace(/<(script|foreignObject|iframe|object|embed|style)[^>]*\/?>/gi, '')
  // <use> can pull external content via href.
  svg = svg.replace(/<use[^>]*>/gi, '')
  // Strip event handlers and scriptable URLs from attributes.
  svg = svg.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  svg = svg.replace(/\s(href|xlink:href|src)\s*=\s*("(?:javascript|data):[^"]*"|'(?:javascript|data):[^']*')/gi, '')

  return svg.trim() || null
}
