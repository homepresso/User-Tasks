# Release notes: apps feel like applications

Apps now behave like applications rather than a set of web pages.

## New

- **The UserTasks menu folds inside apps.** Opening an app collapses the
  UserTasks side menu to its icon rail straight away, so the app gets the
  room — in the builder (`?edit=1`) too. The expand button at the bottom of
  the rail brings it back for that visit; leaving the app restores the menu
  exactly as you had it, and the next visit folds it again. Phones keep their
  menu button; full screen and embedded apps have no UserTasks menu.
- **App setting: Collapse the UserTasks menu in this app** (App settings →
  Navigation, on by default) for apps that want the full menu beside them.
  Also in the API, CLI and config as code (`nav.collapse_shell_menu`).
- **Static app navigation.** Moving between an app's pages no longer
  redraws the whole screen: the app's header, tabs, top bar, sidebar or
  drawer stay exactly where they are and only the page content changes —
  the chosen tab highlights at once, the content fades in (no motion with
  *reduce motion*) and a thin progress line shows while the next page
  loads; the content scrolls back to the top, not the window.
- **Page entries are real links.** The app's menu entries for pages are
  links: Next.js prefetches them and the page's data is warmed on hover, so
  most switches are instant; Ctrl / ⌘-click opens a page in a new tab. Back
  and Forward move between pages with their filters and panels.
- **Full screen and embedded apps** (`/embed/apps/<slug>`) work the same way.

## Unchanged

- Every page is still read and checked on the server as it opens: the
  app's audience, the page's lowest app role, published version for the
  audience, draft for the builder and Preview.
- Page filters (`?f.<id>=`), parameters, panels (`?panel=`), Preview and
  `?as=` behave as before.

## Under the hood

- The app's view is drawn by the app's layout
  (`app/(dashboard)/apps/[slug]/layout.tsx`, `app/embed/apps/[slug]/layout.tsx`),
  which Next keeps mounted across the app's pages; the page routes render
  nothing. The dashboard frame no longer remounts its content per address
  inside an app (`shellContentKey`).
- While the next page loads the previous one stays on screen
  (React Query placeholder, same app and mode only); page data shares its
  cache keys with panels and hover prefetch.
- The collapse rules are in `lib/apps/shell-collapse.ts`; the visit override
  is session-only (`stores/app-shell-store.ts`) and never changes the
  person's saved sidebar preference.
