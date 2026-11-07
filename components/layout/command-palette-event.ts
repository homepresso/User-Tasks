// The command palette's open event, apart from the palette itself: the 404 /
// error states (components/layout/route-states.tsx) open the palette, and are
// rendered by the root not-found page that every public route's server
// function includes. Importing global-search.tsx there pulled its server
// action (app/actions/search.ts) and everything behind it into each of those
// functions.

/** Window event that opens the palette (detail: optional starting query). */
export const OPEN_COMMAND_EVENT = "usertasks:open-command"

export function openCommandPalette(query?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_EVENT, { detail: { query } }))
}
