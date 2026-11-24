/**
 * Between an app's pages: nothing here — the app's layout keeps its header and
 * navigation on screen and shows the switch in its content area. Having a
 * loading boundary lets Next commit the new address at once (and prefetch the
 * app's page routes) instead of holding the click until the server answers.
 */
export default function AppPageLoading() {
  return null
}
