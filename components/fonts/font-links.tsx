/**
 * Stylesheet links for self-hosted Google Fonts (lib/fonts/google.ts
 * googleFontHref: /fonts/g/… on this origin — never Google's hosts). No
 * `precedence`: a slow font must not hold up rendering; text shows in the
 * fallback stack and swaps in (font-display: swap). Server or client.
 */
export function FontLinks({ hrefs }: { hrefs: readonly string[] | null | undefined }) {
  if (!hrefs?.length) return null
  return <>{hrefs.map((href) => <link key={href} rel="stylesheet" href={href} data-font-link />)}</>
}
